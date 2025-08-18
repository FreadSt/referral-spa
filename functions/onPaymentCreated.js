// functions/payments/onPaymentCreated.js
const { onDocumentCreated } = require("firebase-functions/v2/firestore");
const { defineSecret } = require("firebase-functions/params");
const admin = require("firebase-admin");
const sendgrid = require("@sendgrid/mail");
const stripeLib = require("stripe");

// Инициализация Admin SDK (без дубликатов)
if (!admin.apps.length) {
  admin.initializeApp();
}

// Секреты
const SENDGRID_API_KEY = defineSecret("SENDGRID_API_KEY");
const STRIPE_SECRET_KEY = defineSecret("STRIPE_SECRET_KEY");
// ОБЯЗАТЕЛЬНО: установи это на адрес с твоего домена, верифицированного в SendGrid.
// Пример: noreply@yourdomain.com (НЕ gmail.com!)
const MAIL_FROM = defineSecret("MAIL_FROM"); // например, noreply@myshop.ua

const isPaymentSucceeded = (data) => data && data.status === "succeeded";

// Простая маскировка email, чтобы почтовики не вырезали адрес из тела письма
const obfuscateEmail = (e) => {
  if (!e || typeof e !== "string") return "Не указан";
  // Превращаем user@example.com -> user [at] example [dot] com
  return e.replace(/@/g, " [at] ").replace(/\./g, " [dot] ");
};

// Лог: ограничим шум
const maybeLogPaymentDebug = async ({ uid, paymentId, paymentData }) => {
  try {
    const ref = admin.firestore().doc("debug/paymentLogs");
    await admin.firestore().runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      let remaining = 2;
      if (snap.exists) {
        const d = snap.data();
        remaining = typeof d.remaining === "number" ? d.remaining : 2;
      }
      if (remaining <= 0) return;

      const summary = {
        uid,
        paymentId,
        status: paymentData?.status,
        presentation_amount: paymentData?.presentation_amount,
        presentation_currency: paymentData?.presentation_currency,
        customer: paymentData?.customer,
        metadata: paymentData?.metadata || null,
        created: paymentData?.created || null,
      };
      console.log("🧪 DEBUG payment doc (limited):", JSON.stringify(summary, null, 2));

      tx.set(ref, { remaining: remaining - 1 }, { merge: true });
    });
  } catch (e) {
    console.warn("⚠️ Failed debug logging (non-fatal):", e?.message || e);
  }
};

// Достаём контактные поля с приоритетом metadata → session → customer → charge
const extractCustomerFields = async ({ stripeClient, paymentIntent, checkoutSession }) => {
  let customer = null;
  if (paymentIntent?.customer) {
    try {
      customer = await stripeClient.customers.retrieve(paymentIntent.customer);
    } catch (_) {}
  }

  const latestCharge =
    paymentIntent?.latest_charge && typeof paymentIntent.latest_charge === "object"
      ? paymentIntent.latest_charge
      : null;
  const charge = latestCharge || paymentIntent?.charges?.data?.[0] || null;

  // E-mail: ставим приоритет на metadata (мы туда клали с клиента)
  const email =
    paymentIntent?.metadata?.email ||
    checkoutSession?.metadata?.email ||
    customer?.email ||
    checkoutSession?.customer_details?.email ||
    checkoutSession?.customer_email ||
    charge?.billing_details?.email ||
    null;

  const name =
    paymentIntent?.metadata?.name ||
    checkoutSession?.metadata?.name ||
    customer?.name ||
    checkoutSession?.customer_details?.name ||
    charge?.billing_details?.name ||
    "Не указано";

  const phone =
    paymentIntent?.metadata?.phone ||
    checkoutSession?.metadata?.phone ||
    customer?.phone ||
    checkoutSession?.customer_details?.phone ||
    charge?.billing_details?.phone ||
    "Не указан";

  // Адрес: line1 достаточно для наших нужд
  const address =
    paymentIntent?.metadata?.address ||
    checkoutSession?.metadata?.address ||
    customer?.address?.line1 ||
    checkoutSession?.customer_details?.address?.line1 ||
    charge?.billing_details?.address?.line1 ||
    "Не указан";

  // Для отладки источника email
  let emailSource = "unknown";
  if (paymentIntent?.metadata?.email) emailSource = "paymentIntent.metadata.email";
  else if (checkoutSession?.metadata?.email) emailSource = "checkoutSession.metadata.email";
  else if (customer?.email) emailSource = "customer.email";
  else if (checkoutSession?.customer_details?.email) emailSource = "checkoutSession.customer_details.email";
  else if (checkoutSession?.customer_email) emailSource = "checkoutSession.customer_email";
  else if (charge?.billing_details?.email) emailSource = "charge.billing_details.email";
  console.log(`📧 Email source: ${emailSource}; value: ${email || "null"}`);

  return { email, name, phone, address };
};

exports.onPaymentCreated = onDocumentCreated(
  {
    document: "customers/{uid}/payments/{paymentId}",
    secrets: [SENDGRID_API_KEY, STRIPE_SECRET_KEY, MAIL_FROM],
  },
  async (event) => {
    try {
      const data = event.data.data();
      const uid = event.params.uid;
      const paymentId = event.params.paymentId;
      const ref = event.data.ref;

      await maybeLogPaymentDebug({ uid, paymentId, paymentData: data });

      if (!isPaymentSucceeded(data)) {
        return;
      }

      // Идемпотентность
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

      const stripeClient = stripeLib(STRIPE_SECRET_KEY.value());

      // Тянем PaymentIntent
      let paymentIntent;
      try {
        paymentIntent = await stripeClient.paymentIntents.retrieve(paymentId, {
          expand: ["latest_charge", "charges.data", "customer"],
        });
      } catch (err) {
        console.error("🔥 Stripe PI retrieve error:", err?.message || err);
        await ref.update({
          emailSending: false,
          emailError: `Stripe PI retrieve error: ${err?.message || err}`,
          lastEmailAttempt: admin.firestore.FieldValue.serverTimestamp(),
        });
        return;
      }

      // Пробуем притянуть Checkout Session (если его id записала экстеншн)
      const sessionId = data.sessionId || data.checkoutSessionId || null;
      let checkoutSession = null;
      if (sessionId) {
        try {
          checkoutSession = await stripeClient.checkout.sessions.retrieve(sessionId);
        } catch (err) {
          console.warn("⚠️ Could not retrieve Checkout Session:", err?.message || err);
        }
      }

      // Контакты
      const { email, name, phone, address } = await extractCustomerFields({
        stripeClient,
        paymentIntent,
        checkoutSession,
      });

      if (!email) {
        console.error("🔥 No customer email found for payment:", paymentId);
        await ref.update({
          emailSending: false,
          emailError: "No customer email found",
          lastEmailAttempt: admin.firestore.FieldValue.serverTimestamp(),
        });
        return;
      }

      // Сумма
      const amountCents = paymentIntent?.amount_received ?? paymentIntent?.amount ?? data?.presentation_amount ?? 0;
      const amount = (amountCents / 100).toFixed(2);
      const currency = (paymentIntent?.currency || data?.presentation_currency || "uah").toUpperCase();

      // SendGrid
      const sgKey = SENDGRID_API_KEY.value();
      if (!sgKey) {
        await ref.update({ emailSending: false, emailError: "SendGrid API key not configured" });
        return;
      }
      sendgrid.setApiKey(sgKey);

      const fromEmail = MAIL_FROM.value() || "no-reply@invalid.local";
      // Подскажем в логах, если оставили gmail.com (это вызывает dmarc=fail)
      if (/@gmail\.com$/i.test(fromEmail)) {
        console.warn(
          "⚠️ MAIL_FROM использует gmail.com — это вызовет DMARC fail и спам. Задай почту своего домена, верифицированного в SendGrid!"
        );
      }

      // Письмо владельцу (с reply_to на клиента и маскировкой email в теле)
      const ownerHtml = `
        <h2>Новый заказ</h2>
        <p><b>Имя:</b> ${name}</p>
        <p><b>Телефон:</b> ${phone}</p>
        <p><b>Адрес:</b> ${address}</p>
        <p><b>Сумма:</b> ${amount} ${currency}</p>
        <p><b>Email клиента:</b> ${obfuscateEmail(email)}</p>
      `;

      // Письмо клиенту
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
        // Владельцу
        await sendgrid.send({
          to: email,
          from: fromEmail,
          subject: "🎉 Новый заказ — платеж успешен",
          html: ownerHtml,
          replyTo: { email },
        });

        // Клиенту
        await sendgrid.send({
          to: email,
          from: fromEmail,
          subject: "Спасибо за заказ!",
          html: customerHtml,
          // Ответы клиента прилетят тебе
          replyTo: { email: "support@" + (fromEmail.split("@")[1] || "example.com") },
        });
      } catch (sgError) {
        console.error("🔥 SendGrid error:", sgError?.response?.body || sgError);
        await ref.update({
          emailSending: false,
          emailError: sgError?.response?.body?.errors?.[0]?.message || sgError.message || "Unknown SendGrid error",
          lastEmailAttempt: admin.firestore.FieldValue.serverTimestamp(),
        });
        return;
      }

      // Сохраняем заказ
      try {
        const orderRef = admin.firestore().collection("orders").doc(paymentId);
        const orderData = {
          email,
          userId: uid,
          paymentId,
          amount: amountCents,
          currency,
          status: "paid",
          paidAt: admin.firestore.FieldValue.serverTimestamp(),
          name,
          phone,
          address,
          stripeCustomerId: paymentIntent?.customer || data?.customer || null,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        };

        const orderDoc = await orderRef.get();
        if (!orderDoc.exists) {
          await orderRef.set({ ...orderData, createdAt: admin.firestore.FieldValue.serverTimestamp() });
        } else {
          await orderRef.update(orderData);
        }

        await ref.update({
          emailSent: true,
          emailSending: false,
          email,
          name,
          phone,
          address,
          currency,
          amount: amountCents,
          emailSentAt: admin.firestore.FieldValue.serverTimestamp(),
          orderCreated: true,
        });
      } catch (orderErr) {
        console.error("🔥 Error writing order to Firestore:", orderErr);
        await ref.update({
          emailSending: false,
          emailError: `Order save failed: ${orderErr.message}`,
          lastEmailAttempt: admin.firestore.FieldValue.serverTimestamp(),
        });
      }
    } catch (error) {
      console.error("🔥 Error processing payment:", error);
      try {
        const ref = event?.data?.ref;
        if (ref) {
          await ref.update({
            emailSending: false,
            emailError: error.message,
            lastEmailAttempt: admin.firestore.FieldValue.serverTimestamp(),
          });
        }
      } catch (e) {
        console.error("Failed to clear emailSending flag", e);
      }
    }
  }
);
