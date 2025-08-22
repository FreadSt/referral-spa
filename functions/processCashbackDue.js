const { onSchedule } = require("firebase-functions/v2/scheduler");
const admin = require("firebase-admin");
const stripeLib = require("stripe");
const { defineSecret } = require("firebase-functions/params");

const STRIPE_SECRET_KEY = defineSecret("STRIPE_SECRET_KEY");

const CASHBACK_DELAY_MS = 1 * 60 * 1000; // тест

exports.processCashbackDue = onSchedule({
  schedule: "every 1 minutes",
  secrets: [STRIPE_SECRET_KEY],
}, async () => {
  console.log("📅 processCashbackDue started at", new Date().toISOString());
  const now = Date.now();
  const thresholdMillis = now - CASHBACK_DELAY_MS;
  const thresholdTimestamp = admin.firestore.Timestamp.fromMillis(thresholdMillis);

  try {
    const referralsSnap = await admin.firestore().collection("referrals").get();

    const stripe = stripeLib(STRIPE_SECRET_KEY.value());

    let processed = 0;
    for (const d of referralsSnap.docs) {
      const referral = d.data();
      const referralCode = d.id;
      const referrerEmail = referral.email;

      // Fetch connectedAccountId from users by email
      const usersQuery = await admin.firestore().collection("users")
        .where("email", "==", referrerEmail)
        .limit(1)
        .get();
      if (usersQuery.empty) continue;
      const connectedAccountId = usersQuery.docs[0].data().connectedAccountId;
      if (!connectedAccountId) {
        console.warn("⚠️ No connected account for email:", referrerEmail);
        continue;
      }

      // Subcollection query
      const cashbacksSnap = await d.ref.collection("cashbacks")
        .where("pending", "==", true)
        .where("pendingAt", "<=", thresholdTimestamp)
        .get();

      if (cashbacksSnap.empty) continue;

      for (const cbDoc of cashbacksSnap.docs) {
        const cb = cbDoc.data();
        const buyerPaymentId = cb.buyerPaymentId;

        const buyerPI = await stripe.paymentIntents.retrieve(buyerPaymentId);
        if (buyerPI.amount_refunded > 0) {
          console.log("⚠️ Skipping: buyer refunded for PI:", buyerPaymentId);
          await cbDoc.ref.update({
            pending: false,
            skipped: true,
            skippedReason: "buyer_refunded",
            skippedAt: admin.firestore.FieldValue.serverTimestamp(),
          });
          continue;
        }

        // Fixed 50 uah = 5000 kopiyky
        let transferAmount = 5000;
        if (transferAmount <= 0) continue;

        const transfer = await stripe.transfers.create({
          amount: transferAmount,
          currency: "uah",
          destination: connectedAccountId,
          description: `Cashback for referral ${referralCode} from buyer ${cb.buyerEmail}`,
          metadata: {
            type: "referral_cashback",
            referral_code: referralCode,
            buyer_payment: buyerPaymentId,
            buyer_email: cb.buyerEmail,
          },
        });

        await cbDoc.ref.update({
          pending: false,
          sent: true,
          amount: transferAmount,
          sentAt: admin.firestore.FieldValue.serverTimestamp(),
          transferId: transfer.id,
        });

        processed += 1;
      }
    }

    console.log("✅ Processed", processed, "cashbacks");
  } catch (e) {
    console.error("🔥 Error:", e);
  }
});
