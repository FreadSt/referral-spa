// import * as admin from "../server/lib/firebase-admin";
// import nodemailer from "nodemailer";
//
// const db = admin.firestore();
//
// const transporter = nodemailer.createTransport({
//   service: "gmail",
//   auth: {
//     user: process.env.EMAIL_USER,
//     pass: process.env.EMAIL_PASS,
//   },
// });
//
// export const sendReferralLinks = async () => {
//   const seventeenDaysAgo = Date.now() - 17 * 24 * 60 * 60 * 1000;
//
//   const snapshot = await db
//     .collection("orders")
//     .where("received", "==", true)
//     .where("createdAt", "<=", seventeenDaysAgo)
//     .where("referralLinkSent", "==", false)
//     .get();
//
//   for (const doc of snapshot.docs) {
//     const order = doc.data();
//     const customerEmail = order.customer_email;
//
//     const referralSnapshot = await db
//       .collection("referrals")
//       .where("userId", "==", customerEmail)
//       .get();
//
//     if (!referralSnapshot.empty) {
//       const referralCode = referralSnapshot.docs[0].data().referralCode;
//       const referralLink = `http://localhost:8080/product?ref=${referralCode}`;
//
//       await transporter.sendMail({
//         from: process.env.EMAIL_USER,
//         to: customerEmail,
//         subject: "Ваша реферальна посилання",
//         text: `Вітаємо! Ось ваше реферальне посилання: ${referralLink}. Поділіться ним з друзями та отримуйте 1000 грн за кожного, хто купить туфлі!`,
//       });
//
//       await doc.ref.update({ referralLinkSent: true });
//     }
//   }
// };
