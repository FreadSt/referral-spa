const { onDocumentCreated } = require("firebase-functions/v2/firestore");
const admin = require("firebase-admin");
const sendgrid = require("@sendgrid/mail");
const { defineSecret } = require("firebase-functions/params");

const SENDGRID_API_KEY = defineSecret("SENDGRID_API_KEY");
const MAIL_FROM = defineSecret("MAIL_FROM");

if (!admin.apps.length) {
  admin.initializeApp();
}

const sendReferralOrderNotification = async (referrerEmail, buyerEmail) => {
  try {
    const msg = {
      to: referrerEmail,
      from: MAIL_FROM.value() || "no-reply@yourdomain.com",
      subject: "🎉 Новый заказ от вашего реферала!",
      html: `
        <h2>Поздравляем!</h2>
        <p>Ваш реферал (${buyerEmail}) только что оформил заказ по вашей ссылке.</p>
        <p>После получения посылки и истечения периода возврата вы получите кешбек.</p>
      `,
    };
    await sendgrid.send(msg);
  } catch (error) {
    console.error("🔥 Referral order notification email error:", error?.response?.body || error);
  }
};

exports.cashbackPayment = onDocumentCreated({
  document: "customers/{uid}/payments/{paymentId}",
  secrets: [SENDGRID_API_KEY, MAIL_FROM],
}, async (event) => {
  const payment = event.data.data();
  if (!payment) return;

  console.log("💳 Processing payment for cashback:", event.params.paymentId);

  if (payment.status !== "succeeded") {
    console.log("⏭️ Skipping: not a successful payment");
    return;
  }

  if (payment.cashbackProcessed) {
    console.log("ℹ️ Cashback already processed for payment:", event.params.paymentId);
    return;
  }

  const metadata = payment.metadata || {};
  const email = metadata.email;
  if (!email) {
    console.log("ℹ️ No email in payment metadata");
    return;
  }

  const referralCode = metadata.referralCode;
  if (!referralCode) {
    console.log("ℹ️ No referral code in metadata");
    return;
  }

  console.log("🔗 Marking referral as pending cashback:", referralCode);

  try {
    const referralRef = admin.firestore().collection("referrals").doc(referralCode);
    const referralSnap = await referralRef.get();

    if (!referralSnap.exists) {
      console.warn("⚠️ Invalid referral code:", referralCode);
      return;
    }

    const referral = referralSnap.data();
    if (referral.cashbackPending || referral.cashbackSent) {
      console.log("ℹ️ Cashback already pending or sent for referral:", referralCode);
      return;
    }

    await referralRef.update({
      cashbackPending: true,
      cashbackPendingAt: admin.firestore.FieldValue.serverTimestamp(),
      buyerPayment: event.params.paymentId,
      buyerEmail: email,
      buyerUid: event.params.uid,
      orderNotificationSent: true,
    });

    await event.data.ref.update({
      cashbackPending: true,
      cashbackPendingAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    // Send notification to referrer
    const sgKey = SENDGRID_API_KEY.value();
    if (sgKey) {
      sendgrid.setApiKey(sgKey);
      await sendReferralOrderNotification(referral.email, email);
    } else {
      console.warn("⚠️ SendGrid API key not configured, skipping email");
    }

    console.log("✅ Cashback marked as pending and notification sent for:", { referralCode, buyerEmail: email });
  } catch (e) {
    console.error("🔥 Error marking cashback pending or sending notification:", e);
  }
});
