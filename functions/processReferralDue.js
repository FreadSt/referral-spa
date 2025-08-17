const { onSchedule } = require("firebase-functions/v2/scheduler");
const admin = require("firebase-admin");
const sendgrid = require("@sendgrid/mail");
const { defineSecret } = require("firebase-functions/params");

const SENDGRID_API_KEY = defineSecret("SENDGRID_API_KEY");
const APP_URL = defineSecret("APP_URL");

const generateReferralCode = () => Math.random().toString(36).substring(2, 10).toUpperCase();

const sendReferralEmail = async (email, referralCode, appUrl) => {
  try {
    const msg = {
      to: email,
      from: "thiswolfram@gmail.com",
      subject: "🎁 Ваша реферальная ссылка готова!",
      html: `
        <h2>Спасибо за покупку!</h2>
        <p>Поделитесь этой ссылкой с друзьями и получите кешбек на карту</p>
        <p><strong><a href="${appUrl}/?code=${referralCode}">${appUrl}/?code=${referralCode}</a></strong></p>
      `,
    };
    await sendgrid.send(msg);
  } catch (error) {
    console.error("🔥 Referral email error:", error?.response?.body || error);
  }
};

exports.processReferralDue = onSchedule({
  schedule: "every 1 minutes",
  secrets: [SENDGRID_API_KEY, APP_URL],
}, async () => {
  console.log("📅 processReferralDue started at", new Date().toISOString());
  const ttnCol = admin.firestore().collection("ttns");
  const now = Date.now();
  const thresholdMillis = now - 30 * 1000; // 30 seconds
  const thresholdTimestamp = admin.firestore.Timestamp.fromMillis(thresholdMillis);

  try {
    const snap = await ttnCol
      .where("status", "==", "Відправлення отримано")
      .where("referralSent", "==", false)
      .where("receivedAt", "<=", thresholdTimestamp)
      .get();
    console.log("🔍 Found", snap.size, "eligible TTNs");

    if (snap.empty) return;

    const sgKey = SENDGRID_API_KEY.value();
    if (!sgKey) {
      console.error("❌ SENDGRID_API_KEY not configured");
      return;
    }
    sendgrid.setApiKey(sgKey);

    let sent = 0;
    for (const d of snap.docs) {
      const data = d.data();
      console.log("📦 Processing TTN:", d.id, "receivedAt:", data.receivedAt?.toDate());
      try {
        const referralCode = generateReferralCode();
        await admin.firestore().collection("referrals").doc(referralCode).set({
          email: data.email,
          ttn: d.id,
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
          cashbackSent: false, // Добавлено
        });

        await sendReferralEmail(data.email, referralCode, APP_URL.value());

        await ttnCol.doc(d.id).update({
          referralSent: true,
          referralSentAt: admin.firestore.FieldValue.serverTimestamp(),
          referralCode,
        });

        sent += 1;
      } catch (e) {
        console.error("🔥 Failed to send referral for TTN:", d.id, e);
      }
    }
    console.log("✅ Processed", sent, "referrals");
    return { sent };
  } catch (e) {
    console.error("🔥 Query or processing error:", e);
  }
});
