// functions/shipments/checkShipmentStatus.js
const { onSchedule } = require("firebase-functions/v2/scheduler");
const admin = require("firebase-admin");
const axios = require("axios");
const sendgrid = require("@sendgrid/mail");
const { defineSecret } = require("firebase-functions/params");

const NOVAPOSHTA_KEY = defineSecret("NOVAPOSHTA_KEY");
const SENDGRID_API_KEY = defineSecret("SENDGRID_API_KEY");
const MAIL_FROM = defineSecret("MAIL_FROM");

const sendReferralPickupNotification = async (referrerEmail, buyerEmail) => {
  try {
    const msg = {
      to: referrerEmail,
      from: MAIL_FROM.value() || "no-reply@yourdomain.com",
      subject: "📦 Ваш реферал забрал посылку!",
      html: `
        <h2>Обновление по рефералу</h2>
        <p>Ваш реферал (${buyerEmail}) забрал посылку из отделения.</p>
        <p>Кешбек будет начислен после истечения периода возврата.</p>
      `,
    };
    await sendgrid.send(msg);
  } catch (error) {
    console.error("🔥 Referral pickup notification email error:", error?.response?.body || error);
  }
};

exports.checkShipmentStatus = onSchedule({
  schedule: "every 60 minutes",
  secrets: [NOVAPOSHTA_KEY, SENDGRID_API_KEY, MAIL_FROM],
}, async () => {
  const ttnCol = admin.firestore().collection("ttns");
  const snapshot = await ttnCol.where("status", "==", "pending").get();

  const sgKey = SENDGRID_API_KEY.value();
  if (sgKey) sendgrid.setApiKey(sgKey);

  for (const doc of snapshot.docs) {
    const ttnData = doc.data();

    try {
      const response = await axios.post("https://api.novaposhta.ua/v2.0/json/", {
        apiKey: NOVAPOSHTA_KEY.value(),
        modelName: "TrackingDocument",
        calledMethod: "getStatusDocuments",
        methodProperties: {
          Documents: [{ DocumentNumber: ttnData.ttn }],
        },
      });

      const statusRaw = response.data.data?.[0]?.Status || response.data.data?.[0]?.StatusCode || "unknown";
      const status = (typeof statusRaw === "string") ? statusRaw : String(statusRaw);

      if (status.toLowerCase().includes("отриман") || status.toLowerCase().includes("received") || status.toLowerCase().includes("delivered")) {
        // mark delivered/received
        await ttnCol.doc(ttnData.ttn).set({
          status,
          lastCheckedAt: admin.firestore.FieldValue.serverTimestamp(),
        }, { merge: true });

        const snapNow = await ttnCol.doc(ttnData.ttn).get();
        const docData = snapNow.exists ? snapNow.data() : {};
        if (!docData?.receivedAt) {
          await ttnCol.doc(ttnData.ttn).set({
            receivedAt: admin.firestore.FieldValue.serverTimestamp(),
            referralSent: false,
          }, { merge: true });

          // Check if this is a referral buyer and notify referrer
          const buyerEmail = ttnData.email;
          if (buyerEmail) {
            const referralsQuery = await admin.firestore().collection("referrals")
              .where("buyerEmail", "==", buyerEmail)
              .limit(1)
              .get();

            if (!referralsQuery.empty) {
              const referralDoc = referralsQuery.docs[0];
              const referralData = referralDoc.data();
              if (!referralData.pickupNotificationSent) {
                await sendReferralPickupNotification(referralData.email, buyerEmail);
                await referralDoc.ref.update({
                  pickupNotificationSent: true,
                  pickupNotificationAt: admin.firestore.FieldValue.serverTimestamp(),
                });
              }
            }
          }
        }
      } else {
        await ttnCol.doc(ttnData.ttn).set({
          status,
          lastCheckedAt: admin.firestore.FieldValue.serverTimestamp(),
        }, { merge: true });

        // if moved away from received and referral not sent - cancel
        const snapNow = await ttnCol.doc(ttnData.ttn).get();
        const docData = snapNow.exists ? snapNow.data() : {};
        if (docData?.receivedAt && !docData?.referralSent) {
          await ttnCol.doc(ttnData.ttn).update({
            receivedAt: admin.firestore.FieldValue.delete(),
          });
        }
      }
    } catch (error) {
      console.error("🔥 Error checking TTN status:", ttnData.ttn, error);
    }
  }
});
