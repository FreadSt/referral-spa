require("dotenv").config();
const functions = require("firebase-functions");
const { onSchedule } = require("firebase-functions/v2/scheduler");
const { onCall } = require("firebase-functions/v2/https");
const admin = require("firebase-admin");
const stripeKey = process.env.STRIPE_SECRET_KEY;
if (!stripeKey) {
  throw new Error("STRIPE_SECRET_KEY is not set in environment variables");
}
const stripe = require("stripe")(stripeKey);
const axios = require("axios");
const sendgrid = require("@sendgrid/mail");

if (!process.env.SENDGRID_API_KEY) {
  throw new Error("SENDGRID_API_KEY is not set in environment variables");
}
if (!process.env.NOVAPOSHTA_KEY) {
  throw new Error("NOVAPOSHTA_API_KEY is not set in environment variables");
}
if (!process.env.APP_URL) {
  throw new Error("APP_URL is not set in environment variables");
}

admin.initializeApp();
sendgrid.setApiKey(process.env.SENDGRID_API_KEY);

// Generate a random referral code
const generateReferralCode = () => {
  return Math.random().toString(36).substring(2, 10).toUpperCase();
};

// Send order confirmation email
const sendOrderConfirmationEmail = async (email, name, phone, address, ttn) => {
  const msg = {
    to: "your-email@example.com",
    from: "no-reply@yourdomain.com",
    subject: "New Order Received",
    text: `New order from ${name}\nEmail: ${email}\nPhone: ${phone}\nAddress: ${address}\nTTN: ${ttn}`,
  };
  await sendgrid.send(msg);
};

// Send referral email
const sendReferralEmail = async (email, referralCode) => {
  const msg = {
    to: email,
    from: "no-reply@yourdomain.com",
    subject: "Your Referral Link",
    text: `Thank you for your purchase! Share this link: ${process.env.APP_URL}/?code=${referralCode}`,
  };
  await sendgrid.send(msg);
};

// Create Stripe Checkout Session
exports.createCheckoutSession = onCall({ timeoutSeconds: 300, memory: "256MiB" }, async (data, context) => {
  try {
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ["card"],
      line_items: [{
        price: data.data.price,
        quantity: data.data.quantity,
      }],
      customer_email: data.data.customer_email,
      mode: "payment",
      success_url: `${process.env.APP_URL}/success`,
      cancel_url: `${process.env.APP_URL}/product`,
      metadata: {
        referralCode: data.data.referralCode || "",
      },
    });

    await admin.firestore().collection("orders").doc(data.data.email).set({
      sessionId: session.id,
      email: data.data.customer_email,
      name: data.data.name,
      phone: data.data.phone,
      address: data.data.address,
      referralCode: data.data.referralCode || null,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      status: "pending",
    });

    return { sessionId: session.id };
  } catch (error) {
    console.error("Error creating checkout session:", error);
    throw new functions.https.HttpsError("internal", error.message);
  }
});

// Create Nova Poshta Shipment
exports.createNovaPoshtaShipment = onCall({ timeoutSeconds: 300, memory: "256MiB" }, async (data, context) => {
  try {
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
  } catch (error) {
    console.error("Error creating shipment:", error);
    throw new functions.https.HttpsError("internal", error.message);
  }
});

// Check Shipment Status (Cron Job)
exports.checkShipmentStatus = onSchedule({
  schedule: "every 24 hours",
  timeoutSeconds: 300,
  memory: "256MiB"
}, async () => {
  const ttnsSnapshot = await admin.firestore().collection("ttns").where("status", "==", "pending").get();

  for (const ttnDoc of ttnsSnapshot.docs) {
    const ttnData = ttnDoc.data();
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

// Send Referral Links (Cron Job)
exports.sendReferralLinks = onSchedule({
  schedule: "every 24 hours",
  timeoutSeconds: 300,
  memory: "256MiB"
}, async () => {
  const seventeenDaysAgo = new Date();
  seventeenDaysAgo.setDate(seventeenDaysAgo.getDate() - 17);

  const ttnsSnapshot = await admin.firestore().collection("ttns")
    .where("status", "==", "delivered")
    .where("deliveredAt", "<=", seventeenDaysAgo)
    .get();

  for (const ttnDoc of ttnsSnapshot.docs) {
    const ttnData = ttnDoc.data();
    const referralCode = generateReferralCode();
    await admin.firestore().collection("referrals").doc(referralCode).set({
      email: ttnData.email,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    await sendReferralEmail(ttnData.email, referralCode);
  }
});
