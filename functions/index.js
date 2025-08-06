const {defineSecret} = require("firebase-functions/params");
const {onCall} = require("firebase-functions/v2/https");
const {onSchedule} = require("firebase-functions/v2/scheduler");
const {onDocumentCreated, onDocumentUpdated} = require("firebase-functions/v2/firestore");
const admin = require("firebase-admin");
const axios = require("axios");
const sendgrid = require("@sendgrid/mail");

// 🔐 Secrets
const SENDGRID_API_KEY = defineSecret("SENDGRID_API_KEY");
const NOVAPOSHTA_KEY = defineSecret("NOVAPOSHTA_KEY");
const APP_URL = defineSecret("APP_URL");

// 🔧 Init
admin.initializeApp();

// ✅ Обработка успешных платежей через Firestore триггер
// Срабатывает когда расширение создает новый документ в customers/{uid}/payments
exports.onPaymentCreated = onDocumentCreated(
  "customers/{uid}/payments/{paymentId}",
  async (event) => {
    const payment = event.data.data();
    const uid = event.params.uid;
    
    console.log("🎉 New payment received:", {
      uid,
      paymentId: event.params.paymentId,
      amount: payment.amount,
      currency: payment.currency,
      status: payment.status
    });

    // Проверяем что платеж успешен
    if (payment.status !== "succeeded") {
      console.log("Payment not succeeded, skipping processing");
      return;
    }

    // Получаем информацию о пользователе
    const userRecord = await admin.auth().getUser(uid);
    const email = userRecord.email;

    if (!email) {
      console.error("🔥 No email found for user:", uid);
      return;
    }

    // Получаем заказ из Firestore
    const orderRef = admin.firestore().collection("orders").doc(email);
    const orderDoc = await orderRef.get();

    if (!orderDoc.exists) {
      console.error("🔥 Order not found for:", email);
      return;
    }

    const orderData = orderDoc.data();

    // Проверяем что заказ еще не обработан
    if (orderData.status === "paid") {
      console.log("Order already processed for:", email);
      return;
    }

    try {
      // Отправляем email подтверждение
      sendgrid.setApiKey(SENDGRID_API_KEY.value());
      await sendOrderConfirmationEmail(
        email,
        orderData.name,
        orderData.phone,
        orderData.address,
        "Обрабатывается"
      );

      // Обновляем статус заказа
      await orderRef.update({
        status: "paid",
        paidAt: admin.firestore.FieldValue.serverTimestamp(),
        paymentId: event.params.paymentId,
        stripeCustomerId: payment.customer
      });

      console.log("✅ Order processed successfully for:", email);

    } catch (error) {
      console.error("🔥 Error processing payment:", error);
    }
  }
);

// ✅ Обработка изменений подписок
// Срабатывает когда расширение обновляет подписку в customers/{uid}/subscriptions
exports.onSubscriptionUpdated = onDocumentUpdated(
  "customers/{uid}/subscriptions/{subscriptionId}",
  async (event) => {
    const newData = event.data.after.data();
    const oldData = event.data.before.data();
    const uid = event.params.uid;

    console.log("📱 Subscription updated:", {
      uid,
      subscriptionId: event.params.subscriptionId,
      oldStatus: oldData.status,
      newStatus: newData.status
    });

    // Обрабатываем активацию подписки
    if (oldData.status !== "active" && newData.status === "active") {
      console.log("🎉 Subscription activated for user:", uid);
      
      const userRecord = await admin.auth().getUser(uid);
      if (userRecord.email) {
        // Отправляем welcome email для подписки
        sendgrid.setApiKey(SENDGRID_API_KEY.value());
        await sendSubscriptionWelcomeEmail(userRecord.email);
      }
    }

    // Обрабатываем отмену подписки
    if (newData.status === "canceled" || newData.status === "incomplete_expired") {
      console.log("❌ Subscription canceled for user:", uid);
      
      const userRecord = await admin.auth().getUser(uid);
      if (userRecord.email) {
        // Отправляем email об отмене
        sendgrid.setApiKey(SENDGRID_API_KEY.value());
        await sendSubscriptionCanceledEmail(userRecord.email);
      }
    }
  }
);

// ✅ Create NovaPoshta Shipment (обновлено для работы с новой структурой)
exports.createNovaPoshtaShipment = onCall({
  secrets: [NOVAPOSHTA_KEY, SENDGRID_API_KEY],
}, async (data, context) => {
  // Проверяем аутентификацию
  if (!context.auth) {
    throw new Error("Unauthenticated");
  }

  const {email, name, phone, address} = data.data || {};

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
        RecipientCityName: address.split(",")[0].trim(),
        RecipientAddressName: address,
        RecipientName: name,
        RecipientPhone: phone,
      },
    });

    const ttn = response.data.data[0].IntDocNumber;

    // Сохраняем TTN в Firestore
    await admin.firestore().collection("ttns").doc(ttn).set({
      email,
      ttn,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      status: "pending",
      userId: context.auth.uid
    });

    // Отправляем email с TTN
    sendgrid.setApiKey(SENDGRID_API_KEY.value());
    await sendOrderConfirmationEmail(email, name, phone, address, ttn);

    return {ttn};

  } catch (error) {
    console.error("🔥 NovaPoshta error:", error);
    throw new Error("Failed to create shipment");
  }
});

// ✅ Check Shipment Status (без изменений)
exports.checkShipmentStatus = onSchedule({
  schedule: "every 24 hours",
  secrets: [NOVAPOSHTA_KEY],
}, async () => {
  const snapshot = await admin.firestore()
    .collection("ttns")
    .where("status", "==", "pending")
    .get();

  for (const doc of snapshot.docs) {
    const ttnData = doc.data();
    
    try {
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
    } catch (error) {
      console.error("🔥 Error checking TTN status:", ttnData.ttn, error);
    }
  }
});

// ✅ Send Referral Links (обновлено)
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
    
    // Проверяем что реферальная ссылка еще не отправлялась
    if (ttnData.referralSent) {
      continue;
    }

    const referralCode = generateReferralCode();

    try {
      // Сохраняем реферальный код
      await admin.firestore().collection("referrals").doc(referralCode).set({
        email: ttnData.email,
        ttn: ttnData.ttn,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      // Отправляем email
      sendgrid.setApiKey(SENDGRID_API_KEY.value());
      await sendReferralEmail(ttnData.email, referralCode, APP_URL.value());

      // Помечаем что ссылка отправлена
      await admin.firestore().collection("ttns").doc(ttnData.ttn).update({
        referralSent: true,
        referralSentAt: admin.firestore.FieldValue.serverTimestamp()
      });

    } catch (error) {
      console.error("🔥 Error sending referral for TTN:", ttnData.ttn, error);
    }
  }
});

// --- Helper Functions ---

const generateReferralCode = () => 
  Math.random().toString(36).substring(2, 10).toUpperCase();

const sendOrderConfirmationEmail = async (email, name, phone, address, ttn) => {
  const msg = {
    to: "kholiawkodev@gmail.com", // Ваш email для получения уведомлений
    from: "thiswolfram@gmail.com",
    subject: "🎉 Новый заказ получен",
    html: `
      <h2>Новый заказ!</h2>
      <p><strong>Имя:</strong> ${name}</p>
      <p><strong>Email:</strong> ${email}</p>
      <p><strong>Телефон:</strong> ${phone}</p>
      <p><strong>Адрес:</strong> ${address}</p>
      <p><strong>TTN:</strong> ${ttn}</p>
      <hr>
      <p>Заказ успешно оплачен через Stripe! 🎊</p>
    `,
  };
  
  await sendgrid.send(msg);
};

const sendSubscriptionWelcomeEmail = async (email) => {
  const msg = {
    to: email,
    from: "thiswolfram@gmail.com",
    subject: "🎉 Добро пожаловать в подписку!",
    html: `
      <h2>Спасибо за подписку!</h2>
      <p>Ваша подписка успешно активирована.</p>
      <p>Теперь у вас есть доступ ко всем премиум функциям!</p>
    `,
  };
  
  await sendgrid.send(msg);
};

const sendSubscriptionCanceledEmail = async (email) => {
  const msg = {
    to: email,
    from: "thiswolfram@gmail.com",
    subject: "😢 Подписка отменена",
    html: `
      <h2>Ваша подписка была отменена</h2>
      <p>Мы сожалеем, что вы решили отменить подписку.</p>
      <p>Вы можете возобновить её в любое время в личном кабинете.</p>
    `,
  };
  
  await sendgrid.send(msg);
};

const sendReferralEmail = async (email, referralCode, appUrl) => {
  const msg = {
    to: email,
    from: "thiswolfram@gmail.com",
    subject: "🎁 Ваша реферальная ссылка готова!",
    html: `
      <h2>Спасибо за покупку!</h2>
      <p>Поделитесь этой ссылкой с друзьями и получите бонусы:</p>
      <p><strong><a href="${appUrl}/?code=${referralCode}">${appUrl}/?code=${referralCode}</a></strong></p>
      <p>За каждого привлеченного друга вы получите скидку на следующую покупку!</p>
    `,
  };
  
  await sendgrid.send(msg);
};
