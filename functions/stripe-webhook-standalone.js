const express = require('express');
const admin = require('firebase-admin');
const Stripe = require('stripe');

// Инициализация Firebase Admin SDK
admin.initializeApp();

const app = express();
const PORT = process.env.PORT || 8080;

// КРИТИЧЕСКИ ВАЖНО: Stripe webhook должен получать raw body
app.use('/webhook', express.raw({type: 'application/json'}));

// Все остальные маршруты могут использовать JSON парсер
app.use(express.json());

// Stripe webhook handler
app.post('/webhook', async (req, res) => {
  const sig = req.headers['stripe-signature'];
  const stripeSecretKey = process.env.STRIPE_SECRET_KEY;
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  
  if (!stripeSecretKey || !webhookSecret) {
    console.error('Missing required environment variables');
    return res.status(500).send('Server configuration error');
  }

  const stripe = new Stripe(stripeSecretKey);

  // Логирование для отладки
  console.log("=== Stripe Webhook Request ===");
  console.log("Stripe-Signature Header:", sig);
  console.log("Request Content-Type:", req.headers["content-type"]);
  console.log("Body Type:", Buffer.isBuffer(req.body) ? "Buffer" : typeof req.body);
  console.log("Body Length:", req.body ? req.body.length : 0);
  console.log("Body preview:", req.body ? req.body.toString().substring(0, 100) : "No body");
  console.log("=== End of Webhook Request ===");

  let event;
  try {
    event = stripe.webhooks.constructEvent(req.body, sig, webhookSecret);
    console.log("✅ Webhook event verified successfully, type:", event.type);
  } catch (err) {
    console.error("⚠️ Webhook signature verification failed:", err.message);
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

    // Отправка email подтверждения (если нужно)
    try {
      // Здесь можно добавить отправку email через SendGrid
      console.log("✅ Order confirmation processing for:", email);
    } catch (err) {
      console.error("🔥 Email sending error:", err.message);
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

// Health check endpoint
app.get('/', (req, res) => {
  res.json({status: 'OK', service: 'Stripe Webhook Handler'});
});

app.listen(PORT, () => {
  console.log(`🚀 Stripe webhook service listening on port ${PORT}`);
});