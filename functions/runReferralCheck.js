// functions/referrals/runReferralCheck.js
const { onCall } = require("firebase-functions/v2/https");
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

exports.runReferralCheck = onCall({
  secrets: [SENDGRID_API_KEY, APP_URL],
}, async (request) => {
  const testSeconds = Number(request.data?.testSeconds) || null;
  const now = Date.now();
  const thresholdMillis = testSeconds ? now - testSeconds * 1000 : now - 30 * 1000;
  const thresholdTimestamp = admin.firestore.Timestamp.fromMillis(thresholdMillis);

  const ttnCol = admin.firestore().collection("ttns");
  const snap = await ttnCol
    .where("receivedAt", "<=", thresholdTimestamp)
    .where("referralSent", "==", false)
    .get();
  if (snap.empty) return { updated: 0, message: "No due received TTNs" };

  const sgKey = SENDGRID_API_KEY.value();
  if (!sgKey) {
    throw new functions.https.HttpsError("failed-precondition", "SendGrid API key not configured");
  }
  sendgrid.setApiKey(sgKey);

  let sent = 0;
  for (const d of snap.docs) {
    const data = d.data();
    try {
      // Находим referrerUid по email
      const ordersQuery = await admin.firestore()
        .collection("orders")
        .where("email", "==", data.email)
        .orderBy("createdAt", "desc")
        .limit(1)
        .get();

      if (ordersQuery.empty) {
        console.warn("⚠️ No order found for email:", data.email);
        continue;
      }

      const referrerUid = ordersQuery.docs[0].data().userId;

      const referralCode = generateReferralCode();
      await admin.firestore().collection("referrals").doc(referralCode).set({
        email: data.email,
        ttn: d.id,
        referrerUid,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      await sendReferralEmail(data.email, referralCode, APP_URL.value());

      await ttnCol.doc(d.id).update({
        referralSent: true,
        referralSentAt: admin.firestore.FieldValue.serverTimestamp(),
        referralCode,
      });

      sent += 1;
    } catch (e) {
      console.error("🔥 runReferralCheck failed for TTN:", d.id, e);
    }
  }

  return { updated: sent };
});
