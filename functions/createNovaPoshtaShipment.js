const { onCall } = require("firebase-functions/v2/https");
const admin = require("firebase-admin");
const axios = require("axios");
const { defineSecret } = require("firebase-functions/params");

const NOVAPOSHTA_KEY = defineSecret("NOVAPOSHTA_KEY");
const SENDGRID_API_KEY = defineSecret("SENDGRID_API_KEY");

const sendOrderConfirmationEmail = async (email, name, phone, address, ttn) => {
  try {
    const msg = {
      to: email,
      from: "thiswolfram@gmail.com",
      subject: `Отправление создано — TTN ${ttn}`,
      html: `
        <h2>TTN для вашего заказа: ${ttn}</h2>
        <p><strong>Имя:</strong> ${name}</p>
        <p><strong>Телефон:</strong> ${phone}</p>
        <p><strong>Адрес:</strong> ${address}</p>
      `,
    };
    await sendgrid.send(msg);
  } catch (error) {
    console.error("🔥 sendOrderConfirmationEmail error:", error?.response?.body || error);
  }
};

exports.createNovaPoshtaShipment = onCall({
  secrets: [NOVAPOSHTA_KEY, SENDGRID_API_KEY],
}, async (data, context) => {
  if (!context.auth) {
    throw new Error("Unauthenticated");
  }

  const { email, name, phone, address } = data.data || {};

  if (!email || !name || !phone || !address) {
    throw new Error("Missing required fields");
  }

  try {
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
        RecipientCityName: (address || "").split(",")[0].trim(),
        RecipientAddressName: address,
        RecipientName: name,
        RecipientPhone: phone,
      },
    });

    const ttn = response.data.data?.[0]?.IntDocNumber;

    await admin.firestore().collection("ttns").doc(ttn).set({
      email,
      ttn,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      status: "pending",
      userId: context.auth.uid,
    });

    await sendOrderConfirmationEmail(email, name, phone, address, ttn);

    return { ttn };
  } catch (error) {
    console.error("🔥 NovaPoshta error:", error?.response?.data || error);
    throw new Error("Failed to create shipment");
  }
});
