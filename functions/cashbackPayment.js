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

  // Проверяем, что это успешный payment (не subscription)
  if (payment.mode !== "payment" || payment.payment_status !== "paid") return; // Адаптируйте под поля расширения (обычно payment_status: "paid")

  const metadata = payment.metadata || {};
  const email = metadata.email; // Из metadata, как в вашем коде
  if (!email) {
    console.error("🔥 No email in metadata for payment:", event.params.paymentId);
    return;
  }

  // Создаем документ в "orders"
  try {
    const orderRef = admin.firestore().collection("orders").doc();
    await orderRef.set({
      uid: event.params.uid,
      email,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      pi_id: event.params.paymentId, // pi_xxx от расширения
      amount: payment.amount, // amount_total в cents
      currency: payment.currency || "usd",
      metadata, // Для полноты
    });
    console.log("✅ Order created for payment:", event.params.paymentId);
  } catch (e) {
    console.error("🔥 Error creating order:", e);
    return;
  }

  // Обработка реферала и кешбека
  const referralCode = metadata.referralCode;
  if (!referralCode) return;

  try {
    const referralRef = admin.firestore().collection("referrals").doc(referralCode);
    const referralSnap = await referralRef.get();
    if (!referralSnap.exists) {
      console.warn("⚠️ Invalid referral code:", referralCode);
      return;
    }

    const referral = referralSnap.data();
    if (referral.cashbackSent) {
      console.log("ℹ️ Cashback already sent for referral:", referralCode);
      return;
    }

    const referrerEmail = referral.email;
    // Находим самый свежий order реферера по email
    const ordersQuery = await admin.firestore().collection("orders")
      .where("email", "==", referrerEmail)
      .orderBy("createdAt", "desc")
      .limit(1)
      .get();

    if (ordersQuery.empty) {
      console.warn("⚠️ No order found for referrer email:", referrerEmail);
      return;
    }

    const referrerOrder = ordersQuery.docs[0].data();
    const referrerPiId = referrerOrder.pi_id;
    const stripe = stripeLib(STRIPE_SECRET_KEY.value());

    // Получаем PI реферера
    const pi = await stripe.paymentIntents.retrieve(referrerPiId);
    const chargedAmount = pi.amount; // в cents

    // Рассчитываем кешбек: 10% от оригинальной суммы (адаптируйте)
    let refundAmount = Math.floor(chargedAmount * 0.1);
    if (refundAmount <= 0) return;

    // Проверяем уже refunded сумму
    const refundsList = await stripe.refunds.list({ payment_intent: referrerPiId });
    const alreadyRefunded = refundsList.data.reduce((sum, r) => sum + r.amount, 0);

    if (chargedAmount - alreadyRefunded < refundAmount) {
      refundAmount = chargedAmount - alreadyRefunded; // Не больше оставшегося
    }
    if (refundAmount <= 0) {
      console.log("ℹ️ No remaining amount to refund for PI:", referrerPiId);
      return;
    }

    // Выдаем refund
    await stripe.refunds.create({
      payment_intent: referrerPiId,
      amount: refundAmount,
      reason: "requested_by_customer", // Или "duplicate" для кешбека
    });

    // Обновляем referral
    await referralRef.update({
      cashbackSent: true,
      cashbackAmount: refundAmount,
      cashbackAt: admin.firestore.FieldValue.serverTimestamp(),
      cashbackToPayment: referrerPiId,
    });

    console.log("💰 Cashback refunded:", refundAmount, "for referral:", referralCode);
  } catch (e) {
    console.error("🔥 Error processing cashback for payment:", event.params.paymentId, e);
  }
});
