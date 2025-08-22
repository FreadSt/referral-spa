const { onDocumentCreated } = require("firebase-functions/v2/firestore");
const { defineSecret } = require("firebase-functions/params");
const admin = require("firebase-admin");
const stripeLib = require("stripe");

const STRIPE_SECRET_KEY = defineSecret("STRIPE_SECRET_KEY");

exports.cashbackPayment = onDocumentCreated({
  document: "customers/{uid}/payments/{paymentId}",
  secrets: [STRIPE_SECRET_KEY],
}, async (event) => {
  const payment = event.data.data();
  if (!payment) return;

  console.log("💳 Processing payment for cashback:", event.params.paymentId);

  if (payment.status !== "succeeded" && payment.payment_status !== "paid") {
    console.log("⏭️ Skipping: not a successful payment");
    return;
  }

  const stripe = stripeLib(STRIPE_SECRET_KEY.value());

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

  const referralCode = metadata.referralCode;
  if (!referralCode) {
    console.log("ℹ️ No referral code in metadata");
    return;
  }

  console.log("🔗 Adding pending cashback for referral:", referralCode);

  try {
    const referralRef = admin.firestore().collection("referrals").doc(referralCode);
    const referralSnap = await referralRef.get();

    if (!referralSnap.exists) {
      console.warn("⚠️ Invalid referral code:", referralCode);
      return;
    }


    // Subcollection cashbacks
    const cashbackDoc = referralRef.collection("cashbacks").doc(event.params.paymentId);
    await cashbackDoc.set({
      buyerEmail: email,
      buyerPaymentId: event.params.paymentId,
      pending: true,
      pendingAt: admin.firestore.FieldValue.serverTimestamp(),
      sent: false,
    });

    console.log("✅ Pending cashback added for:", { referralCode, buyerEmail: email });
  } catch (e) {
    console.error("🔥 Error adding pending cashback:", e);
  }
});
