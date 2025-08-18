const { onDocumentCreated } = require("firebase-functions/v2/firestore");
const { defineSecret } = require("firebase-functions/params");
const admin = require("firebase-admin");
const stripeLib = require("stripe");

// Инициализация Admin SDK (без дубликатов)
if (!admin.apps.length) {
  admin.initializeApp();
}

const STRIPE_SECRET_KEY = defineSecret("STRIPE_SECRET_KEY");

exports.cashbackPayment = onDocumentCreated({
  document: "customers/{uid}/payments/{paymentId}",
  secrets: [STRIPE_SECRET_KEY],
}, async (event) => {
  const payment = event.data.data();
  if (!payment) return;

  console.log("💳 Processing payment for cashback:", event.params.paymentId);

  // Проверяем, что это успешный payment (учитываем структуру от Run Payments Extension)
  if (payment.status !== "succeeded" && payment.payment_status !== "paid") {
    console.log("⏭️ Skipping: not a successful payment");
    return;
  }

  // Проверяем, что кешбек еще не обработан
  if (payment.cashbackProcessed) {
    console.log("ℹ️ Cashback already processed for payment:", event.params.paymentId);
    return;
  }

  // Получаем Stripe client
  const stripe = stripeLib(STRIPE_SECRET_KEY.value());

  // Получаем PaymentIntent для доступа к metadata
  let paymentIntent;
  try {
    paymentIntent = await stripe.paymentIntents.retrieve(event.params.paymentId, {
      expand: ["latest_charge"]
    });
  } catch (error) {
    console.error("🔥 Failed to retrieve PaymentIntent:", error);
    return;
  }

  const metadata = paymentIntent.metadata || {};
  const email = metadata.email;
  if (!email) {
    console.log("ℹ️ No email in payment metadata");
    return;
  }

  // Обработка реферала и кешбека
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

    // Помечаем referral как pending
    await referralRef.update({
      cashbackPending: true,
      cashbackPendingAt: admin.firestore.FieldValue.serverTimestamp(),
      buyerPayment: event.params.paymentId,
      buyerEmail: email,
    });

    // Помечаем payment как pending для кешбека
    await event.data.ref.update({
      cashbackPending: true,
      cashbackPendingAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    console.log("✅ Cashback marked as pending for:", { referralCode, buyerEmail: email });
  } catch (e) {
    console.error("🔥 Error marking cashback pending:", e);
  }
});
