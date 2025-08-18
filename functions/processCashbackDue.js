const { onSchedule } = require("firebase-functions/v2/scheduler");
const admin = require("firebase-admin");
const stripeLib = require("stripe");
const { defineSecret } = require("firebase-functions/params");

const STRIPE_SECRET_KEY = defineSecret("STRIPE_SECRET_KEY");

const CASHBACK_DELAY_MS = 1 * 60 * 1000; // 3 мин для теста; в проде: 17 * 24 * 60 * 60 * 1000 (17 дней)

exports.processCashbackDue = onSchedule({
  schedule: "every 1 minutes", // Или every 5 minutes для экономии
  secrets: [STRIPE_SECRET_KEY],
}, async () => {
  console.log("📅 processCashbackDue started at", new Date().toISOString());
  const now = Date.now();
  const thresholdMillis = now - CASHBACK_DELAY_MS;
  const thresholdTimestamp = admin.firestore.Timestamp.fromMillis(thresholdMillis);

  try {
    // Находим referral с cashbackPending: true и cashbackPendingAt <= threshold
    const referralsSnap = await admin.firestore().collection("referrals")
      .where("cashbackPending", "==", true)
      .where("cashbackPendingAt", "<=", thresholdTimestamp)
      .get();

    console.log("🔍 Found", referralsSnap.size, "pending cashbacks");

    if (referralsSnap.empty) return;

    const stripe = stripeLib(STRIPE_SECRET_KEY.value());

    let processed = 0;
    for (const d of referralsSnap.docs) {
      const referral = d.data();
      const referralCode = d.id;
      const buyerPaymentId = referral.buyerPayment;
      const referrerEmail = referral.email;

      try {
        // Проверяем, не было ли refund на покупку (buyerPaymentId)
        const buyerPI = await stripe.paymentIntents.retrieve(buyerPaymentId);
        if (buyerPI.amount_refunded > 0) {
          console.log("⚠️ Skipping cashback: buyer refunded for PI:", buyerPaymentId);
          await d.ref.update({
            cashbackPending: false,
            cashbackSkipped: true, // Для логов
            cashbackSkippedReason: "buyer_refunded",
            cashbackSkippedAt: admin.firestore.FieldValue.serverTimestamp(),
          });
          continue;
        }

        // Находим заказ реферера
        const referrerOrdersQuery = await admin.firestore().collection("orders")
          .where("email", "==", referrerEmail)
          .orderBy("createdAt", "desc")
          .limit(1)
          .get();

        if (referrerOrdersQuery.empty) {
          console.warn("⚠️ No order found for referrer:", referrerEmail);
          continue;
        }

        const referrerOrder = referrerOrdersQuery.docs[0].data();
        const referrerPiId = referrerOrder.paymentId;

        // Рассчёт и создание refund (как раньше)
        const referrerPI = await stripe.paymentIntents.retrieve(referrerPiId);
        const referrerChargedAmount = referrerPI.amount;

        const currentOrderAmount = buyerPI.amount;

        let refundAmount = Math.floor(currentOrderAmount * 0.1);
        if (refundAmount <= 0) continue;

        const refundsList = await stripe.refunds.list({ payment_intent: referrerPiId });
        const alreadyRefunded = refundsList.data.reduce((sum, r) => sum + r.amount, 0);

        if (referrerChargedAmount - alreadyRefunded < refundAmount) {
          refundAmount = referrerChargedAmount - alreadyRefunded;
        }

        if (refundAmount <= 0) continue;

        const refund = await stripe.refunds.create({
          payment_intent: referrerPiId,
          amount: refundAmount,
          reason: "requested_by_customer",
          metadata: {
            type: "referral_cashback",
            referral_code: referralCode,
            buyer_payment: buyerPaymentId,
            buyer_email: referral.buyerEmail,
          },
        });

        // Обновляем referral
        await d.ref.update({
          cashbackPending: false,
          cashbackSent: true,
          cashbackAmount: refundAmount,
          cashbackAt: admin.firestore.FieldValue.serverTimestamp(),
          cashbackToPayment: referrerPiId,
          refundId: refund.id,
        });

        // Обновляем payment покупателя
        const buyerPaymentRef = admin.firestore().doc(`customers/${buyerPI.customer}/payments/${buyerPaymentId}`);
        await buyerPaymentRef.update({
          cashbackPending: false,
          cashbackProcessed: true,
          cashbackAmount: refundAmount,
          cashbackRefundId: refund.id,
          cashbackProcessedAt: admin.firestore.FieldValue.serverTimestamp(),
        });

        processed += 1;
      } catch (e) {
        console.error("🔥 Failed to process cashback for referral:", referralCode, e);
      }
    }

    console.log("✅ Processed", processed, "cashbacks");
  } catch (e) {
    console.error("🔥 Query or processing error:", e);
  }
});
