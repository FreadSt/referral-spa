// functions/checkouts/createCheckoutSession.js
const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { defineSecret } = require("firebase-functions/params");
const admin = require("firebase-admin");
const crypto = require("crypto");

if (!admin.apps.length) {
  admin.initializeApp();
}

const LIQPAY_PUBLIC_KEY = defineSecret("LIQPAY_PUBLIC_KEY");
const LIQPAY_PRIVATE_KEY = defineSecret("LIQPAY_PRIVATE_KEY");

// Привяжем регион к us-central1 (у тебя фронт тоже в таком регионе дергает Functions)
const REGION = "us-central1";

exports.createCheckoutSession = onCall(
  {
    region: REGION,
    secrets: [LIQPAY_PUBLIC_KEY, LIQPAY_PRIVATE_KEY],
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

    if (!Array.isArray(data.line_items) || data.line_items.length === 0) {
      throw new HttpsError("invalid-argument", "Invalid line_items");
    }

    const currency = (data.line_items[0].price_data?.currency || "uah").toUpperCase();
    const totalAmountInMinor = data.line_items.reduce(
      (sum, li) => sum + Number(li.price_data.unit_amount) * Number(li.quantity || 1),
      0
    );
    const amount = (totalAmountInMinor / 100).toFixed(2);
    const description = data.line_items
      .map((li) => li.price_data?.product_data?.name || "Item")
      .join(", ");

    // Метаданные (обязательно uid — пригодится вебхуку)
    const metadata = {
      ...data.metadata,
      email: data.customer_email || data.metadata?.email || null,
      uid,
    };
    if (data.referralCode) {
      metadata.referralCode = data.referralCode;
      console.log("🔗 Adding referral code to session:", data.referralCode);
    }

    // Создаём локальную "сессию" (для order_id и консистентности)
    const sessionRef = admin.firestore().collection(`customers/${uid}/checkout_sessions`).doc();
    const orderId = sessionRef.id;

    await sessionRef.set({
      mode: data.mode || "payment",
      line_items: data.line_items,
      success_url: data.success_url,
      cancel_url: data.cancel_url,
      customer_email: data.customer_email,
      metadata,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    // Сформируем корректный URL вебхука LiqPay → на нашу функцию
    const projectId =
      process.env.GCLOUD_PROJECT ||
      process.env.GCP_PROJECT ||
      (() => {
        try {
          return JSON.parse(process.env.FIREBASE_CONFIG || "{}").projectId;
        } catch {
          return null;
        }
      })();

    const serverUrl = `https://${REGION}-${projectId}.cloudfunctions.net/liqpayWebhook`;

    // Параметры LiqPay
    const params = {
      public_key: LIQPAY_PUBLIC_KEY.value(),
      version: "3",
      action: "pay",
      amount: amount, // строка с 2 знаками
      currency: currency, // UAH
      description: description,
      order_id: orderId,
      language: "uk",
      server_url: serverUrl, // наш вебхук
      result_url: data.success_url,
      sender_first_name: metadata.name?.split(" ")[0] || "",
      sender_last_name: metadata.name?.split(" ").slice(1).join(" ") || "",
      sender_phone: metadata.phone || "",
      sender_address: metadata.address || "",
      info: JSON.stringify(metadata), // сюда кладём uid, referralCode и т.д.
    };

    const jsonString = JSON.stringify(params);
    const dataBase64 = Buffer.from(jsonString).toString("base64");
    const privateKey = LIQPAY_PRIVATE_KEY.value();
    const signature = crypto.createHash("sha1").update(privateKey + dataBase64 + privateKey).digest("base64");

    return {
      data: dataBase64,
      signature: signature,
      liqpay_url: "https://www.liqpay.ua/api/3/checkout",
      order_id: orderId,
    };
  }
);
