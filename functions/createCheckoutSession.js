// functions/checkouts/createCheckoutSession.js
const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { defineSecret } = require("firebase-functions/params");
const admin = require("firebase-admin");
const stripeLib = require("stripe");

// Инициализация Admin SDK (без дубликатов)
if (!admin.apps.length) {
  admin.initializeApp();
}

const STRIPE_SECRET_KEY = defineSecret("STRIPE_SECRET_KEY");

exports.createCheckoutSession = onCall(
  {
    secrets: [STRIPE_SECRET_KEY],
  },
  async (request) => {
    const data = request.data;

    if (!request.auth) {
      throw new HttpsError("unauthenticated", "Authentication required");
    }
    const uid = request.auth.uid;

    if (!data?.line_items || !data?.customer_email) {
      throw new HttpsError("invalid-argument", "Missing required fields");
    }

    const stripeClient = stripeLib(STRIPE_SECRET_KEY.value());

    // ✅ Как было — вручную создаём Customer, чтобы экстеншн использовал его
    let customer;
    try {
      customer = await stripeClient.customers.create({
        email: data.customer_email,
        name: data.metadata?.name,
        phone: data.metadata?.phone,
        address: data.metadata?.address ? { line1: data.metadata.address } : undefined,
        metadata: { source: "checkout" },
      });
    } catch (error) {
      console.error("🔥 Error creating Stripe Customer:", error);
      throw new HttpsError("internal", "Failed to create customer");
    }

    // ✅ Метаданные (email + рефкод, если есть)
    const metadata = {
      ...data.metadata,
      email: data.customer_email || data.metadata?.email || null,
    };

    if (data.referralCode) {
      metadata.referralCode = data.referralCode;
      console.log("🔗 Adding referral code to session:", data.referralCode);
    }

    // ✅ Документ для Stripe Extension (как у тебя было)
    const sessionRef = admin.firestore().collection(`customers/${uid}/checkout_sessions`).doc();

    await sessionRef.set({
      mode: data.mode || "payment",
      line_items: data.line_items,
      success_url: data.success_url,
      cancel_url: data.cancel_url,
      customer: customer.id,           // ВАЖНО: используем созданного выше Customer
      customer_email: data.customer_email, // оставляем для обратной совместимости
      metadata: metadata,

      // техслужебное — как было
      emailSent: false,
      emailSending: false,
      emailError: null,
    });

    // ✅ Ждём url от экстеншна (как было)
    return new Promise((resolve, reject) => {
      const unsubscribe = sessionRef.onSnapshot((snap) => {
        const sessionData = snap.data();
        if (sessionData?.url) {
          unsubscribe();
          resolve({ url: sessionData.url });
        }
        if (sessionData?.error) {
          unsubscribe();
          reject(new HttpsError("internal", sessionData.error.message || "Stripe session error"));
        }
      });

      setTimeout(() => {
        unsubscribe();
        reject(new HttpsError("deadline-exceeded", "Timeout waiting for checkout URL"));
      }, 17000);
    });
  }
);
