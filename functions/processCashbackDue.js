// functions/payments/processCashbackDue.js
const { onSchedule } = require("firebase-functions/v2/scheduler");
const admin = require("firebase-admin");
const axios = require("axios");
const crypto = require("crypto");
const { defineSecret } = require("firebase-functions/params");

const LIQPAY_PUBLIC_KEY = defineSecret("LIQPAY_PUBLIC_KEY");
const LIQPAY_PRIVATE_KEY = defineSecret("LIQPAY_PRIVATE_KEY");
const CASHBACK_SIMULATE_PAYOUT = defineSecret("CASHBACK_SIMULATE_PAYOUT");

// ✅ Тоггл для тестовой симуляции выплат B2C (НЕ влияет на прод, пока не включите явно).
// Включить ТОЛЬКО для теста:
//   gcloud functions deploy ... --set-env-vars=CASHBACK_SIMULATE_PAYOUT=true
// Или в Firebase console → Environment variables.
// По умолчанию: false (безопасно для прод).

const SIMULATE_B2C = CASHBACK_SIMULATE_PAYOUT

// 1 минута для теста; в продакшн: 17 дней (17 * 24 * 60 * 60 * 1000) 1 * 60 * 1000;
const CASHBACK_DELAY_MS = 1 * 60 * 1000;

// ---- Вспомогательные функции (безопасны; ничего не ломают) ----
function isB2CNotDefinedError(payoutResult) {
  if (!payoutResult) return false;
  if (typeof payoutResult === "string") {
    return payoutResult.includes("B2C settings not defined");
  }
  const text =
    payoutResult.err_description ||
    payoutResult.message ||
    (payoutResult.status && !String(payoutResult.status).includes("success") && JSON.stringify(payoutResult)) ||
    "";
  return String(text).includes("B2C settings not defined");
}

async function simulatePayout({
                                referrerUid,
                                referrerCashbackCard,
                                referralCode,
                                usageId,
                                buyerPaymentRef,
                                d,
                                cashbackAmount,
                                payoutOrderId,
                              }) {
  const simPaymentId = `sim_${payoutOrderId}`;

  // Создаём запись cashback в payments реферера (пометка simulated)
  const cashbackPaymentRef = admin
    .firestore()
    .collection(`customers/${referrerUid}/payments`)
    .doc(simPaymentId);

  await cashbackPaymentRef.set({
    status: "succeeded",
    type: "cashback",
    amount: cashbackAmount,
    presentation_amount: cashbackAmount,
    presentation_currency: "UAH",
    description: `[SIMULATED] Referral cashback for ${referralCode} usage ${usageId}`,
    metadata: {
      referralCode,
      buyerPayment: buyerPaymentRef.id,
      type: "referral_cashback",
      simulated: true,
    },
    created: admin.firestore.FieldValue.serverTimestamp(),
  });

  // Обновляем usage
  await d.ref.update({
    cashbackPending: false,
    cashbackSent: true,
    cashbackAmount,
    cashbackAt: admin.firestore.FieldValue.serverTimestamp(),
    cashbackToCard: referrerCashbackCard,
    payoutId: simPaymentId,
    simulated: true,
  });

  // Обновляем платеж покупателя
  await buyerPaymentRef.update({
    cashbackPending: false,
    cashbackProcessed: true,
    cashbackAmount,
    cashbackPayoutId: simPaymentId,
    cashbackProcessedAt: admin.firestore.FieldValue.serverTimestamp(),
    cashbackSimulated: true,
  });

  console.warn(
    "🧪 Simulated cashback payout recorded (TEST MODE). PayoutId:",
    simPaymentId
  );
}

// ---- Основной шедулер ----
exports.processCashbackDue = onSchedule(
  {
    schedule: "every 1 minutes",
    secrets: [LIQPAY_PUBLIC_KEY, LIQPAY_PRIVATE_KEY],
  },
  async () => {
    console.log("📅 processCashbackDue started at", new Date().toISOString());

    const now = Date.now();
    const thresholdMillis = now - CASHBACK_DELAY_MS;
    const thresholdTimestamp = admin.firestore.Timestamp.fromMillis(
      thresholdMillis
    );

    try {
      // Используем collectionGroup для всех pendingCashbacks
      const usagesSnap = await admin
        .firestore()
        .collectionGroup("pendingCashbacks")
        .where("cashbackPending", "==", true)
        .where("cashbackPendingAt", "<=", thresholdTimestamp)
        .get();

      console.log("🔍 Found", usagesSnap.size, "pending cashback usages");
      if (usagesSnap.empty) return;

      const publicKey = LIQPAY_PUBLIC_KEY.value();
      const privateKey = LIQPAY_PRIVATE_KEY.value();

      let processed = 0;

      for (const d of usagesSnap.docs) {
        const usage = d.data();
        const usageId = d.id;
        const referralRef = d.ref.parent.parent; // referrals/{code}
        const referralSnap = await referralRef.get();
        if (!referralSnap.exists) continue;
        const referral = referralSnap.data();
        const referralCode = referralRef.id;
        const referrerUid = referral.referrerUid || usage.referrerUid;
        const buyerPaymentId = usage.buyerPayment;
        const buyerUid = usage.buyerUid;

        if (!referrerUid) {
          console.warn(
            "⚠️ No referrer UID for usage:",
            usageId,
            "in referral:",
            referralCode
          );
          continue;
        }

        const referrerEmail = referral.email || "";

        try {
          // Берём платеж реферера из orders
          const referrerOrdersQuery = await admin
            .firestore()
            .collection("orders")
            .where("userId", "==", referrerUid)
            .orderBy("createdAt", "desc")
            .limit(1)
            .get();

          if (referrerOrdersQuery.empty) {
            console.warn("⚠️ No order found for referrer:", referrerEmail);
            continue;
          }

          const referrerOrder = referrerOrdersQuery.docs[0].data();
          const referrerCashbackCard = referrerOrder.cashback_card;

          if (!referrerCashbackCard) {
            console.warn("⚠️ No cashback card for referrer:", referrerEmail);
            continue;
          }

          // Fetch buyer payment doc to get liqpay.order_id
          const buyerPaymentRef = admin
            .firestore()
            .doc(`customers/${buyerUid}/payments/${buyerPaymentId}`);
          const buyerPaymentSnap = await buyerPaymentRef.get();
          if (!buyerPaymentSnap.exists) {
            console.warn("⚠️ Buyer payment doc not found:", buyerPaymentId);
            continue;
          }
          const buyerPayment = buyerPaymentSnap.data();
          const liqpayOrderId =
            buyerPayment.liqpay?.order_id || buyerPaymentId; // fallback

          // Получаем статус платежа покупателя через LiqPay
          const statusParams = {
            public_key: publicKey,
            action: "status",
            version: "3",
            order_id: liqpayOrderId,
          };
          const statusJson = JSON.stringify(statusParams);
          const statusData = Buffer.from(statusJson).toString("base64");
          const statusSig = crypto
            .createHash("sha1")
            .update(privateKey + statusData + privateKey)
            .digest("base64");

          const formDataStatus = new URLSearchParams();
          formDataStatus.append("data", statusData);
          formDataStatus.append("signature", statusSig);

          const statusResponse = await axios.post(
            "https://www.liqpay.ua/api/request",
            formDataStatus.toString(),
            {
              headers: {
                "Content-Type": "application/x-www-form-urlencoded",
              },
            }
          );

          const statusResult = statusResponse.data;

          if (statusResult.err_code) {
            console.error(
              "🔥 LiqPay status error:",
              statusResult.err_description,
              "full:",
              statusResult
            );
            continue;
          }

          if (
            (typeof statusResult.status === "string" &&
              statusResult.status.includes("refund")) ||
            (statusResult.refund_amount && statusResult.refund_amount > 0)
          ) {
            console.log(
              "⚠️ Skipping cashback: buyer refunded for order:",
              buyerPaymentId
            );
            await d.ref.update({
              cashbackPending: false,
              cashbackSkipped: true,
              cashbackSkippedReason: "buyer_refunded",
              cashbackSkippedAt: admin.firestore.FieldValue.serverTimestamp(),
            });
            continue;
          }

          // Вычисляем сумму кешбека (10% от суммы покупки)
          const currentOrderAmount = parseFloat(statusResult.amount);
          const cashbackAmount = Math.floor(currentOrderAmount * 0.1 * 100); // в копейках
          if (!Number.isFinite(cashbackAmount) || cashbackAmount <= 0) continue;

          const payoutOrderId = `cashback_${referralCode}_${usageId}_${Date.now()}`;

          // P2P кредит LiqPay
          const payoutParams = {
            public_key: publicKey,
            action: "p2pcredit",
            version: "3",
            amount: (cashbackAmount / 100).toFixed(2),
            currency: "UAH",
            description: `Cashback for referral ${referralCode} usage ${usageId}`,
            order_id: payoutOrderId,
            receiver_card: referrerCashbackCard,
            receiver_first_name: referrerOrder.name?.split(" ")[0] || "",
            receiver_last_name:
              referrerOrder.name?.split(" ").slice(1).join(" ") || "",
            info: JSON.stringify({
              type: "referral_cashback",
              referral_code: referralCode,
              buyer_payment: buyerPaymentId,
            }),
          };

          const payoutJson = JSON.stringify(payoutParams);
          const payoutData = Buffer.from(payoutJson).toString("base64");
          const payoutSig = crypto
            .createHash("sha1")
            .update(privateKey + payoutData + privateKey)
            .digest("base64");

          const formDataPayout = new URLSearchParams();
          formDataPayout.append("data", payoutData);
          formDataPayout.append("signature", payoutSig);

          const payoutResponse = await axios.post(
            "https://www.liqpay.ua/api/request",
            formDataPayout.toString(),
            {
              headers: {
                "Content-Type": "application/x-www-form-urlencoded",
              },
            }
          );

          const payoutResult = payoutResponse.data;

          // ---- Обработка успеха/ошибки выплаты ----
          if (
            payoutResult.err_code ||
            !(typeof payoutResult.status === "string" &&
              payoutResult.status.includes("success"))
          ) {
            const errText =
              payoutResult.err_description ||
              (typeof payoutResult === "string"
                ? payoutResult
                : JSON.stringify(payoutResult));
            console.error("🔥 LiqPay payout error:", errText);

            // 🧪 ТОЛЬКО ДЛЯ ТЕСТА: симулировать выплату, если B2C не настроен в LiqPay
            // Чтобы включить, задайте переменную окружения CASHBACK_SIMULATE_PAYOUT=true
            if (SIMULATE_B2C && isB2CNotDefinedError(payoutResult)) {
              console.warn(
                "🧪 Simulating cashback payout due to 'B2C settings not defined' (TEST MODE)."
              );
              await simulatePayout({
                referrerUid,
                referrerCashbackCard,
                referralCode,
                usageId,
                buyerPaymentRef,
                d,
                cashbackAmount,
                payoutOrderId,
              });
              processed += 1;
              continue; // к следующему usage
            }

            // В проде просто пропускаем, как и раньше
            continue;
          }

          // ✅ Реальная успешная выплата
          const cashbackPaymentRef = admin
            .firestore()
            .collection(`customers/${referrerUid}/payments`)
            .doc(payoutResult.payment_id || payoutOrderId);

          await cashbackPaymentRef.set({
            status: "succeeded",
            type: "cashback",
            amount: cashbackAmount,
            presentation_amount: cashbackAmount,
            presentation_currency: "UAH",
            description: `Referral cashback for ${referralCode} usage ${usageId}`,
            metadata: {
              referralCode,
              buyerPayment: buyerPaymentId,
              type: "referral_cashback",
              simulated: false,
            },
            created: admin.firestore.FieldValue.serverTimestamp(),
          });

          await d.ref.update({
            cashbackPending: false,
            cashbackSent: true,
            cashbackAmount,
            cashbackAt: admin.firestore.FieldValue.serverTimestamp(),
            cashbackToCard: referrerCashbackCard,
            payoutId: payoutResult.payment_id || payoutOrderId,
            simulated: false,
          });

          await buyerPaymentRef.update({
            cashbackPending: false,
            cashbackProcessed: true,
            cashbackAmount,
            cashbackPayoutId: payoutResult.payment_id || payoutOrderId,
            cashbackProcessedAt: admin.firestore.FieldValue.serverTimestamp(),
            cashbackSimulated: false,
          });

          processed += 1;
        } catch (e) {
          console.error(
            "🔥 Failed to process cashback for usage:",
            usageId,
            "in referral:",
            referralCode,
            e
          );
        }
      }

      console.log("✅ Processed", processed, "cashbacks");
    } catch (e) {
      console.error("🔥 Query or processing error:", e);
    }
  }
);
