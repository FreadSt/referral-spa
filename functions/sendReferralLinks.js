const { onSchedule } = require("firebase-functions/v2/scheduler");
const admin = require("firebase-admin");
const { defineSecret } = require("firebase-functions/params");

const APP_URL = defineSecret("APP_URL");
const SENDGRID_API_KEY = defineSecret("SENDGRID_API_KEY");

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

exports.sendReferralLinks = onSchedule({
  schedule: "every 24 hours",
  secrets: [APP_URL, SENDGRID_API_KEY],
}, async () => {
  const dateLimit = new Date();
  dateLimit.setDate(dateLimit.getDate() - 17);

  const snapshot = await admin
    .firestore()
    .collection("ttns")
    .where("status", "==", "delivered")
    .where("deliveredAt", "<=", dateLimit)
    .get();

  for (const doc of snapshot.docs) {
    const ttnData = doc.data();
    if (ttnData.referralSent) continue;

    const referralCode = generateReferralCode();

    try {
      await admin.firestore().collection("referrals").doc(referralCode).set({
        email: ttnData.email,
        ttn: ttnData.ttn,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      await sendReferralEmail(ttnData.email, referralCode, APP_URL.value());

      await admin
        .firestore()
        .collection("ttns")
        .doc(ttnData.ttn)
        .update({
          referralSent: true,
          referralSentAt: admin.firestore.FieldValue.serverTimestamp(),
        });
    } catch (error) {
      console.error("🔥 Error sending referral for TTN:", ttnData.ttn, error);
    }
  }
});
