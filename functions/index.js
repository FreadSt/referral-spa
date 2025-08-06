const {defineSecret} = require("firebase-functions/params");
const {onRequest, onCall} = require("firebase-functions/v2/https");
const {onSchedule} = require("firebase-functions/v2/scheduler");
const admin = require("firebase-admin");
const express = require("express");
const axios = require("axios");
const sendgrid = require("@sendgrid/mail");
const Stripe = require("stripe");

// 🔐 Secrets
const STRIPE_SECRET_KEY = defineSecret("STRIPE_SECRET_KEY");
const STRIPE_WEBHOOK_SECRET = defineSecret("STRIPE_WEBHOOK_SECRET");
const SENDGRID_API_KEY = defineSecret("SENDGRID_API_KEY");
const NOVAPOSHTA_KEY = defineSecret("NOVAPOSHTA_KEY");
const APP_URL = defineSecret("APP_URL");

// 🔧 Init
admin.initializeApp();

// ✅ Stripe Webhook Handler - надежная реализация с Express
const webhookApp = express();

// Настройка Express для получения raw body
webhookApp.use("/webhook", express.raw({type: "application/json"}));

webhookApp.post("/webhook", async (req, res) => {
  const sig = req.headers["stripe-signature"];
  let event;

  const stripe = new Stripe(STRIPE_SECRET_KEY.value());

  // Логирование для отладки
  console.log("=== Stripe Webhook Request ===");
  console.log("Stripe-Signature Header:", sig);
  console.log("Request Content-Type:", req.headers["content-type"]);
  console.log("Body Type:", Buffer.isBuffer(req.body) ? "Buffer" : typeof req.body);
  console.log("Body Length:", req.body ? req.body.length : 0);
  console.log("Body content preview:", req.body ? req.body.toString().substring(0, 100) : "No body");
  console.log("=== End of Webhook Request ===");

  try {
    event = stripe.webhooks.constructEvent(
        req.body,
        sig,
        STRIPE_WEBHOOK_SECRET.value(),
    );
    console.log("✅ Webhook event verified successfully, type:", event.type);
  } catch (err) {
    console.error("⚠️ Webhook signature verification failed:", err.message);
    console.error("⚠️ Error details:", err);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  // Проверка на идемпотентность
  const webhookRef = admin.firestore().collection("webhook_events").doc(event.id);
  const webhookDoc = await webhookRef.get();
  if (webhookDoc.exists) {
    console.log("Webhook already processed:", event.id);
    return res.json({received: true});
  }

  // Обработка события checkout.session.completed
  if (event.type === "checkout.session.completed") {
    const session = event.data.object;

    // Получаем email из разных возможных источников
    const email = session.customer_email ||
                     (session.customer_details && session.customer_details.email) ||
                     null;

    console.log("📧 Email sources:", {
      customer_email: session.customer_email,
      customer_details_email: session.customer_details && session.customer_details.email,
      final_email: email,
    });

    // Проверка наличия email
    if (!email) {
      console.error("🔥 No email found in session:", session.id);
      console.error("🔥 Session data:", JSON.stringify(session, null, 2));
      await webhookRef.set({
        eventId: event.id,
        status: "failed",
        error: "Missing email",
        processedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
      return res.status(400).send("Missing email");
    }

    const orderRef = admin.firestore().collection("orders").doc(email);
    const orderDoc = await orderRef.get();

    if (!orderDoc.exists) {
      console.error("🔥 Order not found for:", email);
      await webhookRef.set({
        eventId: event.id,
        status: "failed",
        error: "Order not found",
        processedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
      return res.status(404).send("Order not found");
    }

    const orderData = orderDoc.data();

    if (orderData.status === "paid") {
      console.log("Order already processed for:", email);
      await webhookRef.set({
        eventId: event.id,
        status: "skipped",
        reason: "Already processed",
        processedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
      return res.json({received: true});
    }

    // Отправка email подтверждения
    sendgrid.setApiKey(SENDGRID_API_KEY.value());
    try {
      await sendOrderConfirmationEmail(email, orderData.name, orderData.phone, orderData.address, "Ще без TTN");
      console.log("✅ Order confirmation email sent to:", email);
    } catch (err) {
      console.error("🔥 SendGrid error:", (err.response && err.response.body) || err.message);
    }

    // Обновление статуса заказа
    await orderRef.update({
      status: "paid",
      paidAt: admin.firestore.FieldValue.serverTimestamp(),
      stripeSessionId: session.id,
    });

    await webhookRef.set({
      eventId: event.id,
      status: "success",
      sessionId: session.id,
      customerEmail: email,
      processedAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    console.log("✅ Order processed successfully for:", email);
  }

  res.json({received: true});
});

// Экспорт функции с Express app
exports.stripeWebhook = onRequest(
    {
      secrets: [STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, SENDGRID_API_KEY],
      timeoutSeconds: 120,
      memory: "256MiB",
    },
    webhookApp,
);

// ✅ Create Checkout Session
exports.createCheckoutSession = onCall({
  secrets: [STRIPE_SECRET_KEY, APP_URL, SENDGRID_API_KEY, NOVAPOSHTA_KEY],
  timeoutSeconds: 300,
  memory: "256MiB",
}, async (data, context) => {
  const {customer_email, referralCode, name, phone, address} = data.data || {};
  const stripe = new Stripe(STRIPE_SECRET_KEY.value());

  const session = await stripe.checkout.sessions.create({
    payment_method_types: ["card"],
    line_items: [{price: "price_1RnK1iQbiHOSieT9wsaQ8nOK", quantity: 1}],
    customer_email,
    mode: "payment",
    success_url: `${APP_URL.value()}/success`,
    cancel_url: `${APP_URL.value()}/product`,
    metadata: {referralCode: referralCode || ""},
  });

  await admin.firestore().collection("orders").doc(customer_email).set({
    sessionId: session.id,
    email: customer_email,
    name,
    phone,
    address,
    referralCode: referralCode || null,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    status: "pending",
  });

  return {sessionId: session.id};
});

// ✅ Create NovaPoshta Shipment
exports.createNovaPoshtaShipment = onCall({
  secrets: [NOVAPOSHTA_KEY, SENDGRID_API_KEY],
}, async (data, context) => {
  const response = await axios.post("https://api.novaposhta.ua/v2.0/json/", {
    apiKey: NOVAPOSHTA_KEY.value(),
    modelName: "InternetDocument",
    calledMethod: "save",
    methodProperties: {
      PayerType: "Sender",
      PaymentMethod: "Cash",
      DateTime: new Date().toISOString().split("T")[0],
      CargoType: "Cargo",
      Weight: "1",
      SeatsAmount: "1",
      RecipientCityName: data.data.address.split(",")[0].trim(),
      RecipientAddressName: data.data.address,
      RecipientName: data.data.name,
      RecipientPhone: data.data.phone,
    },
  });

  const ttn = response.data.data[0].IntDocNumber;

  await admin.firestore().collection("ttns").doc(ttn).set({
    email: data.data.email,
    ttn,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    status: "pending",
  });

  sendgrid.setApiKey(SENDGRID_API_KEY.value());
  await sendOrderConfirmationEmail(data.data.email, data.data.name, data.data.phone, data.data.address, ttn);

  return {ttn};
});

// ✅ Check Shipment Status
exports.checkShipmentStatus = onSchedule({
  schedule: "every 24 hours",
  secrets: [NOVAPOSHTA_KEY],
}, async () => {
  const snapshot = await admin.firestore().collection("ttns").where("status", "==", "pending").get();

  for (const doc of snapshot.docs) {
    const ttnData = doc.data();
    const response = await axios.post("https://api.novaposhta.ua/v2.0/json/", {
      apiKey: NOVAPOSHTA_KEY.value(),
      modelName: "TrackingDocument",
      calledMethod: "getStatusDocuments",
      methodProperties: {
        Documents: [{DocumentNumber: ttnData.ttn}],
      },
    });

    const status = response.data.data[0].Status;
    if (status === "Delivered") {
      await admin.firestore().collection("ttns").doc(ttnData.ttn).update({
        status: "delivered",
        deliveredAt: admin.firestore.FieldValue.serverTimestamp(),
      });
    }
  }
});

// ✅ Send Referral Links
exports.sendReferralLinks = onSchedule({
  schedule: "every 24 hours",
  secrets: [APP_URL, SENDGRID_API_KEY],
}, async () => {
  const dateLimit = new Date();
  dateLimit.setDate(dateLimit.getDate() - 17);

  const snapshot = await admin.firestore()
      .collection("ttns")
      .where("status", "==", "delivered")
      .where("deliveredAt", "<=", dateLimit)
      .get();

  for (const doc of snapshot.docs) {
    const ttnData = doc.data();
    const referralCode = generateReferralCode();

    await admin.firestore().collection("referrals").doc(referralCode).set({
      email: ttnData.email,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    sendgrid.setApiKey(SENDGRID_API_KEY.value());
    await sendReferralEmail(ttnData.email, referralCode, APP_URL.value());
  }
});

// --- Helpers ---
const generateReferralCode = () => Math.random().toString(36).substring(2, 10).toUpperCase();

const sendOrderConfirmationEmail = async (email, name, phone, address, ttn) => {
  const msg = {
    to: "kholiawkodev@gmail.com",
    from: "thiswolfram@gmail.com",
    subject: "New Order Received",
    text: `New order from ${name}\nEmail: ${email}\nPhone: ${phone}\nAddress: ${address}\nTTN: ${ttn}`,
  };
  await sendgrid.send(msg);
};

const sendReferralEmail = async (email, referralCode, appUrl) => {
  const msg = {
    to: email,
    from: "thiswolfram@gmail.com",
    subject: "Your Referral Link",
    text: `Thank you for your purchase! Share this link: ${appUrl}/?code=${referralCode}`,
  };
  await sendgrid.send(msg);
};
