// // functions/src/trackNovaPoshta.ts
// import * as functions from "firebase-functions";
// import * as admin from "../server/lib/firebase-admin";
// import fetch from "node-fetch";
//
// const db = admin.firestore();
//
// // export const trackNovaPoshta = functions.pubsub
// //   .schedule("every 60 minutes")
// //   .onRun(async () => {
// //     const snapshot = await db
// //       .collection("orders")
// //       .where("received", "==", false)
// //       .where("ttn", "!=", null)
// //       .get();
// //
// //     for (const doc of snapshot.docs) {
// //       const data = doc.data();
// //       const ttn = data.ttn;
// //
// //       const response = await fetch("https://api.novaposhta.ua/v2.0/json/", {
// //         method: "POST",
// //         headers: { "Content-Type": "application/json" },
// //         body: JSON.stringify({
// //           apiKey: functions.config().novaposhta.key,
// //           modelName: "TrackingDocument",
// //           calledMethod: "getStatusDocuments",
// //           methodProperties: {
// //             Documents: [{ DocumentNumber: ttn }],
// //           },
// //         }),
// //       });
// //
// //       const json = await response.json();
// //       const status = json?.data?.[0]?.Status;
// //
// //       if (status?.toLowerCase().includes("доставлен") || status?.toLowerCase().includes("вручено")) {
// //         await doc.ref.update({ received: true });
// //
// //         console.log(`Order ${doc.id} received via Nova Poshta`);
// //       }
// //     }
// //
// //     return null;
// //   });
// export const trackNovaPoshta = functions.https.onCall(async (data, context) => {
//   const { orderId } = data;
//
//   if (!orderId) {
//     throw new functions.https.HttpsError("invalid-argument", "No orderId provided");
//   }
//
//   const orderRef = db.collection("orders").doc(orderId);
//   const orderSnap = await orderRef.get();
//
//   if (!orderSnap.exists) {
//     throw new functions.https.HttpsError("not-found", "Order not found");
//   }
//
//   const orderData = orderSnap.data();
//   const buyerId = orderData?.userId;
//   const referrerId = orderData?.referrerId;
//
//   // 1. Обновляем статус заказа
//   await orderRef.update({ received: true });
//
//   // 2. Если был реферер, начисляем баллы
//   if (referrerId) {
//     const refUserRef = db.collection("users").doc(referrerId);
//     await db.runTransaction(async (t) => {
//       const refSnap = await t.get(refUserRef);
//       const prevPoints = refSnap.exists ? refSnap.data()?.refPoints || 0 : 0;
//       t.set(refUserRef, { refPoints: prevPoints + 1000 }, { merge: true });
//     });
//   }
//
//   // 3. Генерируем реферальную ссылку для покупателя
//   const referralCode = buyerId; // Можно использовать UID как код
//   await db.collection("referrals").doc(buyerId).set({
//     userId: buyerId,
//     referralCode,
//     createdAt: admin.firestore.FieldValue.serverTimestamp(),
//   });
//
//   return { success: true, referralCode };
// });
