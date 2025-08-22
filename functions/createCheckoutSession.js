// createCheckoutSession.js (додане створення connected account)
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

    // Створення customer
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

    // Додане: Створення connected account (якщо немає)
    let connectedAccountId;
    const userRef = admin.firestore().collection("users").doc(uid);
    const userSnap = await userRef.get();
    connectedAccountId = userSnap.data()?.connectedAccountId;

    if (!connectedAccountId) {
      try {
        const account = await stripeClient.accounts.create({
          type: 'express', // Для UA; перевірте країни
          country: 'UA',
          email: data.customer_email,
          capabilities: {
            card_payments: { requested: true },
            transfers: { requested: true },
          },
        });
        connectedAccountId = account.id;
        await userRef.update({ connectedAccountId });
        // Для referral - оновіть при генерації, або тут якщо потрібно
      } catch (error) {
        console.error("🔥 Error creating connected account:", error);
        // Не блокуємо, якщо не критичний
      }
    }

    const metadata = {
      ...data.metadata,
      email: data.customer_email || data.metadata?.email || null,
    };

    if (data.referralCode) {
      metadata.referralCode = data.referralCode;
      console.log("🔗 Adding referral code to session:", data.referralCode);
    }

    const sessionRef = admin.firestore().collection(`customers/${uid}/checkout_sessions`).doc();

    await sessionRef.set({
      mode: data.mode || "payment",
      line_items: data.line_items,
      success_url: data.success_url,
      cancel_url: data.cancel_url,
      customer: customer.id,
      customer_email: data.customer_email,
      metadata: metadata,
      emailSent: false,
      emailSending: false,
      emailError: null,
    });

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
