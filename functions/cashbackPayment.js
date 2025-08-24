// functions/cashbackPayment.js (обновлено с buyerTTN)
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

  if (payment.status !== "succeeded" && payment.payment_status !== "paid") return;

  const stripe = stripeLib(STRIPE_SECRET_KEY.value());

  let paymentIntent;
  try {
    paymentIntent = await stripe.paymentIntents.retrieve(event.params.paymentId);
  } catch (error) {
    return;
  }

  const metadata = paymentIntent.metadata || {};
  const email = metadata.email;
  if (!email) return;

  const referralCode = metadata.referralCode;
  if (!referralCode) return;

  try {
    const referralRef = admin.firestore().collection("referrals").doc(referralCode);
    const referralSnap = await referralRef.get();
    if (!referralSnap.exists) return;

    const referrerEmail = referralSnap.data().email;

    const userQuery = await admin.firestore().collection("users").where("email", "==", referrerEmail).limit(1).get();
    if (userQuery.empty) return;

    const userBankDetails = userQuery.docs[0].data().bankDetails;
    if (!userBankDetails || !userBankDetails.iban) return;

    // Добавлено: Найти buyerTTN по buyerEmail (если TTN уже привязан)
    let buyerTTN = null;
    const ttnQuery = await admin.firestore().collection("ttns").where("email", "==", email).limit(1).get();
    if (!ttnQuery.empty) {
      buyerTTN = ttnQuery.docs[0].id; // ttn as doc id
    }

    const amount = Math.floor(paymentIntent.amount * 0.1);

    const cashbackDoc = referralRef.collection("cashbacks").doc(event.params.paymentId);
    await cashbackDoc.set({
      buyerEmail: email,
      buyerPaymentId: event.params.paymentId,
      buyerTTN, // Добавлено для будущей проверки
      pending: true,
      pendingAt: admin.firestore.FieldValue.serverTimestamp(),
      sent: false,
      amount,
      userBankDetails,
    });
  } catch (e) {
    console.error("Error:", e);
  }
});
