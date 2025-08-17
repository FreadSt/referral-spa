const { onCall } = require("firebase-functions/v2/https");
const admin = require("firebase-admin");
const axios = require("axios");
const { defineSecret } = require("firebase-functions/params");

const NOVAPOSHTA_KEY = defineSecret("NOVAPOSHTA_KEY");

exports.refreshShipmentStatus = onCall({
  secrets: [NOVAPOSHTA_KEY],
}, async (request) => {
  const { ttn, email } = request.data || {};

  let ttnDocs = [];
  const ttnCol = admin.firestore().collection("ttns");

  if (ttn) {
    const snap = await ttnCol.doc(ttn).get();
    if (snap.exists) ttnDocs.push({ id: snap.id, ...snap.data() });
  } else if (email) {
    const qs = await ttnCol.where("email", "==", email).get();
    ttnDocs = qs.docs.map((d) => ({ id: d.id, ...d.data() }));
  } else {
    const qs = await ttnCol.where("status", "==", "pending").get();
    ttnDocs = qs.docs.map((d) => ({ id: d.id, ...d.data() }));
  }

  if (ttnDocs.length === 0) return { updated: 0, message: "No TTNs to refresh" };

  const chunk = (arr, size) => arr.reduce((a, _, i) => (i % size ? a : [...a, arr.slice(i, i + size)]), []);
  const chunks = chunk(ttnDocs, 25);

  let updated = 0;
  for (const group of chunks) {
    try {
      const response = await axios.post("https://api.novaposhta.ua/v2.0/json/", {
        apiKey: NOVAPOSHTA_KEY.value(),
        modelName: "TrackingDocument",
        calledMethod: "getStatusDocuments",
        methodProperties: {
          Documents: group.map((g) => ({ DocumentNumber: g.id })),
        },
      });

      const rows = response?.data?.data || [];
      for (const row of rows) {
        const statusRaw = row?.Status || row?.StatusCode || "unknown";
        const status = (typeof statusRaw === "string") ? statusRaw : String(statusRaw);
        const id = row?.Number || row?.IntDocNumber;
        if (!id) continue;

        // Update base status and lastCheckedAt
        await ttnCol.doc(id).set(
          {
            status,
            lastCheckedAt: admin.firestore.FieldValue.serverTimestamp(),
          },
          { merge: true }
        );

        // If now received — set receivedAt (only once) and ensure referralSent:false
        const receivedNormalized = status.toLowerCase().includes("отриман") || status.toLowerCase().includes("received") || status.toLowerCase().includes("delivered");
        if (receivedNormalized) {
          const snap = await ttnCol.doc(id).get();
          const docData = snap.exists ? snap.data() : {};
          if (!docData?.receivedAt) {
            await ttnCol.doc(id).set({
              receivedAt: admin.firestore.FieldValue.serverTimestamp(),
              referralSent: false,
            }, { merge: true });
          }
        } else {
          // If status moved away from 'received' and referral not sent yet — remove receivedAt (cancel countdown)
          const snap = await ttnCol.doc(id).get();
          const docData = snap.exists ? snap.data() : {};
          if (docData?.receivedAt && !docData?.referralSent) {
            await ttnCol.doc(id).update({
              receivedAt: admin.firestore.FieldValue.delete(),
            });
          }
        }

        updated += 1;
      }
    } catch (err) {
      console.error("🔥 refreshShipmentStatus API error:", err?.response?.data || err?.message || err);
    }
  }

  return { updated };
});
