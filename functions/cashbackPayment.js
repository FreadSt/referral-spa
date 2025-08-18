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

  console.log("🔗 Processing referral:", referralCode);

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

    // Получаем email реферера (того, кто привлек покупателя)
    const referrerEmail = referral.email;
    console.log("👤 Referrer email:", referrerEmail);

    // Ищем последний заказ РЕФЕРЕРА для возврата ему кешбека
    const referrerOrdersQuery = await admin.firestore().collection("orders")
      .where("email", "==", referrerEmail)
      .orderBy("createdAt", "desc")
      .limit(1)
      .get();

    if (referrerOrdersQuery.empty) {
      console.warn("⚠️ No order found for referrer email:", referrerEmail);
      return;
    }

    // Получаем Payment Intent реферера для возврата
    const referrerOrder = referrerOrdersQuery.docs[0].data();
    const referrerPiId = referrerOrder.paymentId;  // ИСПРАВЛЕНО: было pi_id

    console.log("💰 Found referrer order:", referrerPiId);

    // Получаем PI реферера
    const referrerPI = await stripe.paymentIntents.retrieve(referrerPiId);
    const referrerChargedAmount = referrerPI.amount; // в cents

    // Получаем сумму текущего заказа (покупателя по реферальной ссылке)
    const currentOrderAmount = paymentIntent.amount; // в cents

    // Рассчитываем кешбек: 10% от суммы ТЕКУЩЕГО заказа
    let refundAmount = Math.floor(currentOrderAmount * 0.1);
    if (refundAmount <= 0) {
      console.log("ℹ️ Refund amount is zero");
      return;
    }

    console.log("💵 Calculated refund amount:", refundAmount, "cents from current order amount:", currentOrderAmount);

    // Проверяем уже возвращенную сумму по PI реферера
    const refundsList = await stripe.refunds.list({ payment_intent: referrerPiId });
    const alreadyRefunded = refundsList.data.reduce((sum, r) => sum + r.amount, 0);

    // Убеждаемся, что не возвращаем больше, чем было заплачено реферером
    if (referrerChargedAmount - alreadyRefunded < refundAmount) {
      refundAmount = referrerChargedAmount - alreadyRefunded;
    }

    if (refundAmount <= 0) {
      console.log("ℹ️ No remaining amount to refund for PI:", referrerPiId);
      return;
    }

    console.log("💸 Creating refund of", refundAmount, "cents to PI:", referrerPiId);

    // Выдаем refund реферу
    const refund = await stripe.refunds.create({
      payment_intent: referrerPiId,
      amount: refundAmount,
      reason: "requested_by_customer",
      metadata: {
        type: "referral_cashback",
        referral_code: referralCode,
        buyer_payment: event.params.paymentId,
        buyer_email: email,
      },
    });

    console.log("✅ Refund created:", refund.id);

    // Обновляем referral
    await referralRef.update({
      cashbackSent: true,
      cashbackAmount: refundAmount,
      cashbackAt: admin.firestore.FieldValue.serverTimestamp(),
      cashbackToPayment: referrerPiId,
      refundId: refund.id,
      buyerPayment: event.params.paymentId,
      buyerEmail: email,
    });

    // Помечаем payment как обработанный для кешбека
    await event.data.ref.update({
      cashbackProcessed: true,
      cashbackAmount: refundAmount,
      cashbackRefundId: refund.id,
      cashbackProcessedAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    console.log("💰 Cashback processed successfully:", {
      referralCode,
      refundAmount,
      refundId: refund.id,
      referrerEmail,
      buyerEmail: email,
    });

  } catch (e) {
    console.error("🔥 Error processing cashback for payment:", event.params.paymentId, e);
  }
});
