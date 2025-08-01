// import * as admin from "../server/lib/firebase-admin";
// import fetch from "node-fetch";
// import * as dotenv from "dotenv";
// import Stripe from "stripe";
//
// dotenv.config();
// admin.initializeApp();
// const db = admin.firestore();
// const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
//   apiVersion: "2025-06-30.basil",
// });
//
// const processRefund = async (orderId: string) => {
//   const doc = await db.collection("orders").doc(orderId).get();
//   const order = doc.data();
//   if (!order || !order.chargeId || !order.referrerId) return;
//
//   await stripe.refunds.create({
//     charge: order.chargeId,
//     amount: 100000, // 1000 грн в копейках
//   });
//
//   await doc.ref.update({ refunded: true });
//   console.log(`✅ Refunded 1000 грн for order ${orderId}`);
// };
//
// export const checkDeliveries = async () => {
//   const snap = await db
//     .collection("orders")
//     .where("received", "==", false)
//     .where("ttn", "!=", null)
//     .get();
//
//   for (const doc of snap.docs) {
//     const order = doc.data();
//     const ttn = order.ttn;
//
//     const response = await fetch("https://api.novaposhta.ua/v2.0/json/", {
//       method: "POST",
//       headers: { "Content-Type": "application/json" },
//       body: JSON.stringify({
//         apiKey: process.env.NOVAPOSHTA_KEY,
//         modelName: "TrackingDocument",
//         calledMethod: "getStatusDocuments",
//         methodProperties: { Documents: [{ DocumentNumber: ttn }] },
//       }),
//     });
//
//     const json = await response.json();
//     const status = json?.data?.[0]?.Status?.toLowerCase();
//
//     if (status?.includes("вручено") || status?.includes("доставлен")) {
//       console.log(`📦 Order ${doc.id} delivered`);
//       await doc.ref.update({ received: true });
//
//       // Через 10 сек делаем возврат
//       setTimeout(() => processRefund(doc.id), 10000);
//     }
//   }
// };
//
// checkDeliveries();
