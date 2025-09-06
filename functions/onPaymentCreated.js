// functions/payments/onPaymentCreated.js
const { onDocumentCreated } = require("firebase-functions/v2/firestore");
const { defineSecret } = require("firebase-functions/params");
const admin = require("firebase-admin");
const sendgrid = require("@sendgrid/mail");

if (!admin.apps.length) {
  admin.initializeApp();
}

const SENDGRID_API_KEY = defineSecret("SENDGRID_API_KEY");
const MAIL_FROM = defineSecret("MAIL_FROM");

const isPaymentSucceeded = (data) => data && data.status === "succeeded";

const obfuscateEmail = (e) => {
  if (!e || typeof e !== "string") return "Не указан";
  return e.replace(/@/g, " [at] ").replace(/\./g, " [dot] ");
};

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

exports.onPaymentCreated = onDocumentCreated(
  {
    document: "customers/{uid}/payments/{paymentId}",
    secrets: [SENDGRID_API_KEY, MAIL_FROM],
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

      // Extract from metadata (set by webhook)
      const metadata = data.metadata || {};
      const email = metadata.email || null;
      const name = metadata.name || "Не указано";
      const phone = metadata.phone || "Не указан";
      const address = metadata.address || "Не указан";
      const cashback_card = metadata.cashback_card || null;

      if (!email) {
        console.error("🔥 No customer email found for payment:", paymentId);
        await ref.update({
          emailSending: false,
          emailError: "No customer email found",
          lastEmailAttempt: admin.firestore.FieldValue.serverTimestamp(),
        });
        return;
      }

      // Amount
      const amountCents = data.presentation_amount ?? 0;
      const amount = (amountCents / 100).toFixed(2);
      const currency = (data.presentation_currency || "uah").toUpperCase();

      // SendGrid
      const sgKey = SENDGRID_API_KEY.value();
      if (!sgKey) {
        await ref.update({ emailSending: false, emailError: "SendGrid API key not configured" });
        return;
      }
      sendgrid.setApiKey(sgKey);

      const fromEmail = MAIL_FROM.value() || "no-reply@invalid.local";
      if (/@gmail\.com$/i.test(fromEmail)) {
        console.warn(
          "⚠️ MAIL_FROM использует gmail.com — это вызовет DMARC fail и спам. Задай почту своего домена, верифицированного в SendGrid!"
        );
      }

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
        await sendgrid.send({
          to: email,
          from: fromEmail,
          subject: "🎉 Новый заказ — платеж успешен",
          html: ownerHtml,
          replyTo: { email },
        });

        await sendgrid.send({
          to: email,
          from: fromEmail,
          subject: "Спасибо за заказ!",
          html: customerHtml,
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

      // Save order
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
          cashback_card,
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
