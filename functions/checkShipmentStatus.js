const { onSchedule } = require("firebase-functions/v2/scheduler");
const admin = require("firebase-admin");
const axios = require("axios");
const { defineSecret } = require("firebase-functions/params");

const NOVAPOSHTA_KEY = defineSecret("NOVAPOSHTA_KEY");

exports.checkShipmentStatus = onSchedule({
  schedule: "every 60 minutes",
  secrets: [NOVAPOSHTA_KEY],
}, async () => {
  const ttnCol = admin.firestore().collection("ttns");
  const snapshot = await ttnCol.where("status", "==", "pending").get();

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

      if (status === "Delivered" || status.toLowerCase().includes("отриман") || status.toLowerCase().includes("received") || status.toLowerCase().includes("delivered")) {
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
