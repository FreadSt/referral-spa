// functions/index.js
const { onCall, onRequest } = require("firebase-functions/v2/https");
const { onSchedule } = require("firebase-functions/v2/scheduler");
const { onDocumentUpdated } = require("firebase-functions/v2/firestore");
const { defineSecret } = require("firebase-functions/params");

const admin = require("firebase-admin");
admin.initializeApp();

const sgMail = require("@sendgrid/mail");
const axios = require("axios");
const crypto = require("crypto");

// Custom LiqPay implementation
class LiqPayCustom {
  constructor(publicKey, privateKey) {
    this.publicKey = publicKey;
    this.privateKey = privateKey;
  }

  createSignature(data) {
    const signString = this.privateKey + data + this.privateKey;
    return crypto.createHash('sha1').update(signString).digest('base64');
  }

  cnb_form(params) {
    const data = Buffer.from(JSON.stringify(params)).toString('base64');
    const signature = this.createSignature(data);

    return `
      <form method="POST" action="https://www.liqpay.ua/api/3/checkout" accept-charset="utf-8">
        <input type="hidden" name="data" value="${data}" />
        <input type="hidden" name="signature" value="${signature}" />
        <input type="submit" value="Оплатить" />
      </form>
    `;
  }

  async api(method, params) {
    const data = Buffer.from(JSON.stringify(params)).toString('base64');
    const signature = this.createSignature(data);

    try {
      const response = await axios.post('https://www.liqpay.ua/api/request', {
        data: data,
        signature: signature
      });
      return response.data;
    } catch (error) {
      console.error('LiqPay API error:', error);
      return { status: 'error', err_description: error.message };
    }
  }
}

const LIQPAY_PUBLIC_KEY = defineSecret("LIQPAY_PUBLIC_KEY");
const LIQPAY_PRIVATE_KEY = defineSecret("LIQPAY_PRIVATE_KEY");
const SENDGRID_API_KEY = defineSecret("SENDGRID_API_KEY");
const NOVA_POST_API_KEY = defineSecret("NOVA_POST_API_KEY");
const APP_URL = defineSecret("APP_URL");
const MAIL_FROM = defineSecret("MAIL_FROM");
const OWNER_EMAIL = defineSecret("OWNER_EMAIL"); // New for owner notifications
const db = admin.firestore();

// 1. Инициация чекаута LiqPay
exports.initiateCheckout = onCall(
  {
    secrets: [LIQPAY_PUBLIC_KEY, LIQPAY_PRIVATE_KEY, APP_URL],
  },
  async (request) => {
    try {
      const data = request.data;
      const orderId = db.collection("orders").doc().id;
      await db.collection("orders").doc(orderId).set({
        ...data.metadata,
        status: "pending",
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        referralCode: data.metadata.referralCode || null,
      });

      const liqpay = new LiqPayCustom(LIQPAY_PUBLIC_KEY.value(), LIQPAY_PRIVATE_KEY.value());

      // LiqPay parameters
      const params = {
        public_key: LIQPAY_PUBLIC_KEY.value(),
        version: "3",
        action: "pay",
        amount: data.price,
        currency: "UAH",
        description: `Покупка товара`,
        order_id: orderId,
        result_url: data.success_url,
        server_url: `https://us-central1-${process.env.GCLOUD_PROJECT}.cloudfunctions.net/liqpayWebhook`,
        info: JSON.stringify({ email: data.metadata.email }),
      };

      const htmlForm = liqpay.cnb_form(params);
      return { formHtml: htmlForm, orderId };
    } catch (error) {
      console.error("Error initiating checkout:", error);
      throw new functions.https.HttpsError("internal", "Не вдалося ініціювати оплату");
    }
  }
);

// 2. Webhook от LiqPay - Simplified, removed referral generation and detailed emails
exports.liqpayWebhook = onRequest(
  {
    secrets: [LIQPAY_PUBLIC_KEY, LIQPAY_PRIVATE_KEY, SENDGRID_API_KEY, MAIL_FROM, APP_URL],
  },
  async (req, res) => {
    try {
      const { data: base64Data, signature } = req.body;
      const liqpay = new LiqPayCustom(LIQPAY_PUBLIC_KEY.value(), LIQPAY_PRIVATE_KEY.value());
      const expectedSignature = liqpay.createSignature(base64Data);

      if (signature !== expectedSignature) {
        return res.status(400).send("Invalid signature");
      }

      const decodedData = JSON.parse(Buffer.from(base64Data, "base64").toString());
      const { order_id, status, amount, payment_id } = decodedData;

      if (status === "success") {
        const orderRef = db.collection("orders").doc(order_id);
        await orderRef.update({
          status: "paid",
          paymentId: payment_id,
          amount: amount * 100,
          paidAt: admin.firestore.FieldValue.serverTimestamp(),
        });

        // Save bankDetails in users (keep here)
        const orderSnap = await orderRef.get();
        const orderData = orderSnap.data();
        await db.collection("users").doc(orderData.email).set(
          {
            email: orderData.email,
            bankDetails: {
              iban: orderData.bankIban,
              bic: orderData.bankBic,
              name: orderData.bankHolderName,
            },
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          },
          { merge: true }
        );

        // Simple success email (optional, detailed in trigger)
        sgMail.setApiKey(SENDGRID_API_KEY.value());
        const info = JSON.parse(decodedData.info || "{}");
        await sgMail.send({
          to: info.email,
          from: MAIL_FROM.value(),
          subject: "Оплата успішна",
          text: `Ваша оплата за замовлення ${order_id} пройшла успішно.`,
        });
      } else if (status === "failure") {
        await db.collection("orders").doc(order_id).update({ status: "failed" });
      }

      res.sendStatus(200);
    } catch (error) {
      console.error("Webhook error:", error);
      res.status(500).send("Internal error");
    }
  }
);

// New: Trigger on order update to "paid" - adapted from onPaymentCreated
exports.onOrderPaid = onDocumentUpdated(
  {
    document: "orders/{orderId}",
    secrets: [SENDGRID_API_KEY, MAIL_FROM, OWNER_EMAIL],
  },
  async (event) => {
    try {
      const previousData = event.data.before.data();
      const data = event.data.after.data();
      const orderId = event.params.orderId;
      const ref = event.data.after.ref;

      if (previousData.status === "paid" || data.status !== "paid") {
        return;
      }

      const shouldProcess = await admin.firestore().runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        const docData = snap.data() || {};
        if (docData.emailSent) return false;
        if (docData.emailSending) return false;
        tx.update(ref, {
          emailSending: true,
          emailProcessStarted: admin.firestore.FieldValue.serverTimestamp(),
        });
        return true;
      });
      if (!shouldProcess) return;

      const email = data.email;
      const name = data.name || "Не указано";
      const phone = data.phone || "Не указан";
      const address = data.address || "Не указан";

      if (!email) {
        console.error("No customer email found for order:", orderId);
        await ref.update({
          emailSending: false,
          emailError: "No customer email found",
          lastEmailAttempt: admin.firestore.FieldValue.serverTimestamp(),
        });
        return;
      }

      const amountCents = data.amount || 0;
      const amount = (amountCents / 100).toFixed(2);
      const currency = data.currency || "UAH";

      const sgKey = SENDGRID_API_KEY.value();
      if (!sgKey) {
        await ref.update({ emailSending: false, emailError: "SendGrid API key not configured" });
        return;
      }
      sgMail.setApiKey(sgKey);

      const fromEmail = MAIL_FROM.value() || "no-reply@invalid.local";
      if (/@gmail\.com$/i.test(fromEmail)) {
        console.warn("MAIL_FROM gmail.com – DMARC fail. Use domain email!");
      }

      const obfuscateEmail = (e) => {
        if (!e || typeof e !== "string") return "Не указан";
        return e.replace(/@/g, " [at] ").replace(/\./g, " [dot] ");
      };

      const ownerHtml = `
        <h2>Новый заказ</h2>
        <p><b>Имя:</b> ${name}</p>
        <p><b>Телефон:</b> ${phone}</p>
        <p><b>Адрес:</b> ${address}</p>
        <p><b>Сумма:</b> ${amount} ${currency}</p>
        <p><b>Email клиента:</b> ${obfuscateEmail(email)}</p>
      `;

      const customerHtml = `
        <h2>Спасибо за заказ!</h2>
        <p>Мы получили вашу оплату на сумму <b>${amount} ${currency}</b>.</p>
        <p><b>Ваше имя:</b> ${name}</p>
        <p><b>Ваш email:</b> ${obfuscateEmail(email)}</p>
        <p><b>Ваш телефон:</b> ${phone}</p>
        <p><b>Адрес доставки:</b> ${address}</p>
        <p>Если данные неверны — просто ответьте на это письмо.</p>
      `;

      try {
        // To owner
        await sgMail.send({
          to: OWNER_EMAIL.value(),
          from: fromEmail,
          subject: "🎉 Новый заказ — платеж успешен",
          html: ownerHtml,
          replyTo: { email },
        });

        // To customer
        await sgMail.send({
          to: email,
          from: fromEmail,
          subject: "Спасибо за заказ!",
          html: customerHtml,
          replyTo: { email: "support@" + (fromEmail.split("@")[1] || "example.com") },
        });
      } catch (sgError) {
        console.error("SendGrid error:", sgError?.response?.body || sgError);
        await ref.update({
          emailSending: false,
          emailError: sgError?.response?.body?.errors?.[0]?.message || sgError.message || "Unknown SendGrid error",
          lastEmailAttempt: admin.firestore.FieldValue.serverTimestamp(),
        });
        return;
      }

      // [START] REFERRAL: create pending cashback event (idempotent)
      try {
        const referralCode = data.referralCode || null;
        if (referralCode) {
          const refDoc = await db.collection('referrals').doc(referralCode).get();
          if (!refDoc.exists) {
            console.warn('referralCode not found in Firestore:', referralCode);
          } else {
            const refData = refDoc.data();
            const referrerEmail = refData?.email || null;
            const buyerPaymentId = data.paymentId;
            const buyerAmount = amountCents;
            const buyerCurrency = currency.toLowerCase();

            const cbRef = refDoc.ref.collection('cashbacks').doc(buyerPaymentId);
            const cbSnap = await cbRef.get();
            if (!cbSnap.exists) {
              await cbRef.set({
                pending: true,
                pendingAt: admin.firestore.FieldValue.serverTimestamp(),
                buyerEmail: email,
                buyerPaymentId,
                buyerAmount,
                buyerCurrency,
                sent: false,
                amount: buyerAmount * 0.1, // 10% cashback
                transferId: null,
                sentAt: null,
                skipped: false,
                skippedReason: null,
                referrerEmail,
              });
              console.log('Pending cashback created', { referralCode, buyerPaymentId, referrerEmail });
            } else {
              console.log('Pending cashback already exists (idempotent)', { referralCode, buyerPaymentId });
            }
          }
        }
      } catch (e) {
        console.error('Failed to create pending cashback', e);
      }
      // [END] REFERRAL

      await ref.update({
        emailSent: true,
        emailSending: false,
        emailSentAt: admin.firestore.FieldValue.serverTimestamp(),
      });
    } catch (error) {
      console.error("Error processing order paid:", error);
      const ref = event.data.after.ref;
      await ref.update({
        emailSending: false,
        emailError: error.message,
        lastEmailAttempt: admin.firestore.FieldValue.serverTimestamp(),
      });
    }
  }
);

// 3. Сохранение/обновление bank details (if needed outside form)
exports.createBankDetailsOnboarding = onCall(async (request) => {
  try {
    const data = request.data;
    const { email, iban, bic, name } = data;
    if (!email || !iban || !name) {
      throw new functions.https.HttpsError("invalid-argument", "Недостатньо даних");
    }

    await db.collection("users").doc(email).set(
      {
        bankDetails: { iban, bic: bic || "", name },
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true }
    );

    return { success: true };
  } catch (error) {
    console.error("Error saving bank details:", error);
    throw new functions.https.HttpsError("internal", "Не вдалося зберегти банківські дані");
  }
});

// 4. Обновление статусов TTN (Nova Poshta)
exports.refreshShipmentStatus = onCall(
  {
    secrets: [NOVA_POST_API_KEY],
  },
  async (request) => {
    try {
      const data = request.data;
      const { ttn } = data;
      let updated = 0;

      if (ttn) {
        const status = await getNovaPostStatus(ttn);
        await db.collection("ttns").doc(ttn).update({
          status: status.Status || "pending",
          receivedAt: status.DateTimeRecipient
            ? admin.firestore.Timestamp.fromDate(
              new Date(
                status.DateTimeRecipient.replace(
                  /(\d{2})\.(\d{2})\.(\d{4})/,
                  "$3-$2-$1"
                )
              )
            )
            : null,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
        updated = 1;
      } else {
        const pendingTTNs = await db.collection("ttns").where("status", "==", "pending").get();
        for (const doc of pendingTTNs.docs) {
          const status = await getNovaPostStatus(doc.id);
          await doc.ref.update({
            status: status.Status || "pending",
            receivedAt: status.DateTimeRecipient
              ? admin.firestore.Timestamp.fromDate(
                new Date(
                  status.DateTimeRecipient.replace(
                    /(\d{2})\.(\d{2})\.(\d{4}) (\d{2}:\d{2}:\d{2})/,
                    "$3-$2-$1T$4"
                  )
                )
              )
              : null,
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          });
          updated++;
        }
      }
      console.log("TTN:", ttn, "Status:", status.Status);
      return { updated };
    } catch (error) {
      console.error("Error refreshing status:", error);
      throw new functions.https.HttpsError("internal", "Не вдалося оновити статуси");
    }
  }
);

// Alias for trackNovaPoshta
exports.trackNovaPoshta = exports.refreshShipmentStatus;

// Helper for Nova Poshta status
async function getNovaPostStatus(ttn) {
  try {
    const response = await axios.post("https://api.novaposhta.ua/v2.0/json/", {
      apiKey: NOVA_POST_API_KEY.value(),
      modelName: "TrackingDocument",
      calledMethod: "getStatusDocuments",
      methodProperties: {
        Documents: [{ DocumentNumber: ttn }],
      },
    });
    console.log("Nova Poshta response:", response.data);
    return response.data.data[0] || { Status: "error" };
  } catch (error) {
    console.error("Nova Post API error:", error);
    return { Status: "error" };
  }
}

// 5. Scheduled: Генерация реферальной ссылки после задержки - on ttns, with refund check
exports.generateReferral = onSchedule(
  {
    schedule: "every 5 minutes",
    secrets: [SENDGRID_API_KEY, APP_URL, MAIL_FROM],
  },
  async () => {
    console.log("Starting generateReferral function");

    try {
      const REFERRAL_DELAY_MS = 1 * 60 * 1000; // Test 1 min
      const now = Date.now();

      const ttns = await db.collection("ttns").where("receivedAt", "!=", null).where("referralSent", "==", false).get();

      console.log(`Found ${ttns.size} ttns with receivedAt without referral sent`);

      for (const doc of ttns.docs) {
        const data = doc.data();
        console.log(`Processing ttn: ${doc.id}, receivedAt: ${data.receivedAt}`);

        const receivedTime = data.receivedAt?.toDate()?.getTime();
        if (receivedTime && now - receivedTime >= REFERRAL_DELAY_MS) {
          // Check if associated order not refunded
          const orderQuery = await db.collection("orders").where("email", "==", data.email).limit(1).get();
          if (!orderQuery.empty && orderQuery.docs[0].data().status !== "refunded") {
            console.log(`Creating referral for ttn: ${doc.id}`);

            const referralCode = Math.random().toString(36).substring(2, 9).toUpperCase();
            await doc.ref.update({
              referralCode,
              referralSent: true,
              referralSentAt: admin.firestore.FieldValue.serverTimestamp(),
            });

            // Also set in referrals for consistency
            await db.collection("referrals").doc(data.email).set({
              email: data.email,
              createdAt: admin.firestore.FieldValue.serverTimestamp(),
              referralCode: referralCode,
            }, { merge: true });

            // Send email with referral link
            sgMail.setApiKey(SENDGRID_API_KEY.value());
            const appUrl = APP_URL.value();

            await sgMail.send({
              to: data.email,
              from: MAIL_FROM.value(),
              subject: "Ваша реферальна посилання",
              html: `
                <p>Дякуємо за ваше замовлення!</p>
                <p>Ваша реферальна посилання: ${appUrl}?ref=${referralCode}</p>
                <p>Поділіться нею з друзями та отримуйте знижки на наступні покупки!</p>
              `,
            });

            console.log(`Referral created for email: ${data.email}`);
          } else {
            console.log(`Skipped referral for ttn: ${doc.id} due to refunded order`);
          }
        }
      }
    } catch (error) {
      console.error("Error in generateReferral:", error);
    }
  }
);

// 6. Scheduled: Обработка выплат кешбека после задержки
exports.processCashbacks = onSchedule(
  {
    schedule: "every 5 minutes",
    secrets: [LIQPAY_PUBLIC_KEY, LIQPAY_PRIVATE_KEY, SENDGRID_API_KEY, MAIL_FROM],
  },
  async () => {
    try {
      const CASHBACK_DELAY_MS = 1 * 60 * 1000; // Test; prod: 17 days
      const liqpay = new LiqPayCustom(LIQPAY_PUBLIC_KEY.value(), LIQPAY_PRIVATE_KEY.value());

      const now = Date.now();
      const referrals = await db.collection("referrals").get();

      for (const refDoc of referrals.docs) {
        const cashbacks = await refDoc.ref.collection("cashbacks").where("pending", "==", true).where("sent", "==", false).get();

        for (const cbDoc of cashbacks.docs) {
          const cbData = cbDoc.data();
          const pendingTime = cbData.pendingAt?.toDate()?.getTime();
          if (pendingTime && now - pendingTime >= CASHBACK_DELAY_MS) {
            const buyerOrderQuery = await db.collection("orders").where("email", "==", cbData.buyerEmail).limit(1).get();
            if (!buyerOrderQuery.empty && buyerOrderQuery.docs[0].data().status !== "refunded") {
              const userSnap = await db.collection("users").doc(refDoc.id).get();
              const bankDetails = userSnap.data()?.bankDetails;
              if (!bankDetails) {
                await cbDoc.ref.update({ skipped: true, skippedReason: "No bank details" });
                continue;
              }

              // Payout request
              const payoutParams = {
                public_key: LIQPAY_PUBLIC_KEY.value(),
                version: "3",
                action: "p2pcredit", // Changed to p2pcredit as per doc
                amount: (cbData.amount / 100).toFixed(2),
                currency: "UAH",
                description: `Кешбек за реферала ${cbData.buyerEmail}`,
                order_id: `cb-${cbDoc.id}`,
                receiver_card: bankDetails.iban.startsWith('UA') ? undefined : bankDetails.iban, // If IBAN is card? Adapt if IBAN not supported, perhaps use card if available
                receiver_last_name: bankDetails.name.split(' ')[1] || '',
                receiver_first_name: bankDetails.name.split(' ')[0] || '',
                // If IBAN, perhaps add receiver_iban if supported, but per doc, it's receiver_card for card
              };

              const result = await liqpay.api("request", payoutParams);
              if (result.status === "success") {
                await cbDoc.ref.update({
                  pending: false,
                  sent: true,
                  sentAt: admin.firestore.FieldValue.serverTimestamp(),
                });

                sgMail.setApiKey(SENDGRID_API_KEY.value());
                await sgMail.send({
                  to: refDoc.data().email,
                  from: MAIL_FROM.value(),
                  subject: "Кешбек надіслано",
                  text: `Ви отримали ${(cbData.amount / 100).toFixed(2)} UAH за реферала ${cbData.buyerEmail}`,
                });
              } else {
                await cbDoc.ref.update({ skipped: true, skippedReason: result.err_description || "Payout failed" });
              }
            } else {
              await cbDoc.ref.update({ skipped: true, skippedReason: "Refunded order" });
            }
          }
        }
      }
    } catch (error) {
      console.error("Error in processCashbacks:", error);
    }
  }
);

// 7. Process refund (for LiqPay, partial possible)
exports.processRefund = onCall(
  {
    secrets: [LIQPAY_PUBLIC_KEY, LIQPAY_PRIVATE_KEY],
  },
  async (request) => {
    try {
      const data = request.data;
      const { orderId, amount } = data; // amount in UAH for partial
      if (!orderId) {
        throw new functions.https.HttpsError("invalid-argument", "Order ID required");
      }

      const liqpay = new LiqPayCustom(LIQPAY_PUBLIC_KEY.value(), LIQPAY_PRIVATE_KEY.value());
      const refundParams = {
        public_key: LIQPAY_PUBLIC_KEY.value(),
        version: "3",
        action: "refund",
        order_id: orderId,
        amount: amount ? amount.toFixed(2) : undefined, // If not specified — full refund
      };

      const result = await liqpay.api("request", refundParams);
      if (result.status === "success") {
        await db.collection("orders").doc(orderId).update({
          status: "refunded",
          refundedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
        return { success: true };
      } else {
        throw new functions.https.HttpsError("internal", result.err_description || "Refund failed");
      }
    } catch (error) {
      console.error("Error processing refund:", error);
      throw new functions.https.HttpsError("internal", "Не вдалося обробити повернення");
    }
  }
);

// 8. Create Nova Poshta shipment (stub, since manual)
exports.createNovaPoshtaShipment = onCall(
  {
    secrets: [NOVA_POST_API_KEY],
  },
  async (request) => {
    throw new functions.https.HttpsError("unimplemented", "TTN створюється вручну");
  }
);
