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

    // Создаём Customer (просто, без поиска по email — достаточно для текущей логики)
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

    // Документ для Stripe Extension
    const sessionRef = admin.firestore().collection(`customers/${uid}/checkout_sessions`).doc();

    await sessionRef.set({
      mode: data.mode || "payment",
      line_items: data.line_items,
      success_url: data.success_url,
      cancel_url: data.cancel_url,
      customer: customer.id,
      // Для обратной совместимости экстеншна
      customer_email: data.customer_email,
      // Кладём email в metadata, чтобы забрать его на вебхуке при любых раскладах
      metadata: {
        ...data.metadata,
        email: data.customer_email || data.metadata?.email || null,
      },
      // Техслужебные поля (не мешают экстеншну)
      emailSent: false,
      emailSending: false,
      emailError: null,
      // expires_at — по желанию (минимум 30 минут)
      // expires_at: Math.floor(Date.now() / 1000) + 1800,
    });

    // Ждём URL от экстеншна
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
