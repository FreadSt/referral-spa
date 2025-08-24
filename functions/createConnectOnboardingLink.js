const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { defineSecret } = require("firebase-functions/params");
const admin = require("firebase-admin");
const stripeLib = require("stripe");

if (!admin.apps.length) admin.initializeApp();

const STRIPE_SECRET_KEY = defineSecret("STRIPE_SECRET_KEY");
const APP_URL = defineSecret("APP_URL");

exports.createConnectOnboardingLink = onCall({ secrets: [STRIPE_SECRET_KEY, APP_URL] }, async (ctx) => {
  if (!ctx.auth) throw new HttpsError("unauthenticated", "Auth required");
  const email = ctx.data?.email;
  if (!email) throw new HttpsError("invalid-argument", "email required");

  const stripe = stripeLib(STRIPE_SECRET_KEY.value());

  const userQuery = await admin.firestore().collection("users").where("email", "==", email).limit(1).get();
  let userRef = userQuery.empty ? admin.firestore().collection("users").doc() : userQuery.docs[0].ref;
  let userData = userQuery.empty ? { email } : userQuery.docs[0].data();

  if (!userData.connectedAccountId) {
    const acct = await stripe.accounts.create({
      type: "express",
      country: "UA",
      email,
      capabilities: { transfers: { requested: true } },
    });
    await userRef.set({ email, connectedAccountId: acct.id }, { merge: true });
    userData.connectedAccountId = acct.id;
  }

  const link = await stripe.accountLinks.create({
    account: userData.connectedAccountId,
    refresh_url: `${APP_URL.value()}/onboarding/refresh`,
    return_url: `${APP_URL.value()}/onboarding/return`,
    type: "account_onboarding",
  });

  return { onboardingUrl: link.url, connectedAccountId: userData.connectedAccountId };
});
