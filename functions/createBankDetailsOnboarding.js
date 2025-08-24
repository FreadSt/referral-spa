// functions/createBankDetailsOnboarding.js (без изменений)
const { onCall, HttpsError } = require("firebase-functions/v2/https");
const admin = require("firebase-admin");

if (!admin.apps.length) admin.initializeApp();

exports.createBankDetailsOnboarding = onCall(async (ctx) => {
  if (!ctx.auth) throw new HttpsError("unauthenticated", "Auth required");
  const { email, iban, bic, name } = ctx.data;
  if (!email || !iban || !name) throw new HttpsError("invalid-argument", "Required fields missing");

  const userQuery = await admin.firestore().collection("users").where("email", "==", email).limit(1).get();
  let userRef = userQuery.empty ? admin.firestore().collection("users").doc() : userQuery.docs[0].ref;

  await userRef.set({
    email,
    bankDetails: { iban, bic, name },
  }, { merge: true });

  return { success: true };
});
