const { defineSecret } = require("firebase-functions/params");

const STRIPE_SECRET_KEY = defineSecret("STRIPE_SECRET_KEY");
const SENDGRID_API_KEY = defineSecret("SENDGRID_API_KEY");
const NOVAPOSHTA_KEY = defineSecret("NOVAPOSHTA_API_KEY");
const APP_URL = defineSecret("APP_URL");

const functions = require("firebase-functions");
const { onSchedule } = require("firebase-functions/v2/scheduler");
const { onCall } = require("firebase-functions/v2/https");
const admin = require("firebase-admin");
const axios = require("axios");
const sendgrid = require("@sendgrid/mail");

admin.initializeApp();

// --- HELPERS ---

const generateReferralCode = () => Math.random().toString(36).substring(2, 10).toUpperCase();

const sendOrderConfirmationEmail = async (email, name, phone, address, ttn) => {
  const msg = {
    to: "thiswolfram@gmail.com",
    from: "no-reply@yourdomain.com",
    subject: "New Order Received",
    text: `New order from ${name}\nEmail: ${email}\nPhone: ${phone}\nAddress: ${address}\nTTN: ${ttn}`,
  };
  await sendgrid.send(msg);
};

const sendReferralEmail = async (email, referralCode, appUrl) => {
  const msg = {
    to: email,
    from: "no-reply@yourdomain.com",
    subject: "Your Referral Link",
    text: `Thank you for your purchase! Share this link: ${appUrl}/?code=${referralCode}`,
  };
  await sendgrid.send(msg);
};

// --- FUNCTIONS ---

exports.createCheckoutSession = onCall({
  timeoutSeconds: 300,
  memory: "256MiB",
  secrets: [STRIPE_SECRET_KEY, SENDGRID_API_KEY, NOVAPOSHTA_KEY, APP_URL]
}, async (data, context) => {
  try {

    if (!data || !data.data) {
      throw new functions.https.HttpsError("invalid-argument", "Missing data payload");
    }

    const { customer_email, referralCode, name, phone, address } = data.data;


    const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ["card"],
      line_items: [{
        price: 'price_1RnK1iQbiHOSieT9wsaQ8nOK',
        quantity: 1,
      }],
      customer_email,
      mode: "payment",
      success_url: `${process.env.APP_URL}/success`,
      cancel_url: `${process.env.APP_URL}/product`,
      metadata: {
        referralCode: referralCode || "",
      },
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

    return { sessionId: session.id };
  } catch (error) {
    console.error("🔥 Stripe error:", error.message);
    console.error("🔥 Stack trace:", error.stack);
    throw new functions.https.HttpsError("internal", error.message || "Unknown error");
  }

});



exports.createNovaPoshtaShipment = onCall({ timeoutSeconds: 300, memory: "256MiB" }, async (data, context) => {
  const response = await axios.post("https://api.novaposhta.ua/v2.0/json/", {
    apiKey: process.env.NOVAPOSHTA_KEY,
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

  await sendOrderConfirmationEmail(data.data.email, data.data.name, data.data.phone, data.data.address, ttn);

  return { ttn };
});

exports.checkShipmentStatus = onSchedule({
  schedule: "every 24 hours",
  timeoutSeconds: 300,
  memory: "256MiB"
}, async () => {
  const snapshot = await admin.firestore().collection("ttns").where("status", "==", "pending").get();

  for (const doc of snapshot.docs) {
    const ttnData = doc.data();
    const response = await axios.post("https://api.novaposhta.ua/v2.0/json/", {
      apiKey: process.env.NOVAPOSHTA_KEY,
      modelName: "TrackingDocument",
      calledMethod: "getStatusDocuments",
      methodProperties: {
        Documents: [{ DocumentNumber: ttnData.ttn }],
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

exports.sendReferralLinks = onSchedule({
  schedule: "every 24 hours",
  timeoutSeconds: 300,
  memory: "256MiB"
}, async () => {
  const appUrl = process.env.APP_URL;

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

    await sendReferralEmail(ttnData.email, referralCode, appUrl);
  }
});
