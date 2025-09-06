// functions/payments/liqpayWebhook.js
const { onRequest } = require("firebase-functions/v2/https");
const { defineSecret } = require("firebase-functions/params");
const admin = require("firebase-admin");
const crypto = require("crypto");

if (!admin.apps.length) {
  admin.initializeApp();
}

const LIQPAY_PRIVATE_KEY = defineSecret("LIQPAY_PRIVATE_KEY");
const REGION = "us-central1";

// Устойчивый парсинг тела для application/x-www-form-urlencoded и JSON
function extractDataAndSignature(req) {
  let data = req.body?.data;
  let signature = req.body?.signature;

  if ((!data || !signature) && req.rawBody) {
    const contentType = (req.headers["content-type"] || "").toLowerCase();
    const raw = req.rawBody.toString("utf8");

    if (contentType.includes("application/x-www-form-urlencoded")) {
      const params = new URLSearchParams(raw);
      data = data || params.get("data");
      signature = signature || params.get("signature");
    } else if (contentType.includes("application/json")) {
      try {
        const parsed = JSON.parse(raw);
        data = data || parsed.data;
        signature = signature || parsed.signature;
      } catch {
        // ignore
      }
    }
  }
  return { data, signature };
}

exports.liqpayWebhook = onRequest(
  {
    region: REGION,
    secrets: [LIQPAY_PRIVATE_KEY],
    cors: false, // сервер-сервер; CORS не нужен
  },
  async (req, res) => {
    try {
      const { data, signature } = extractDataAndSignature(req);

      if (!data || !signature) {
        console.error("❌ Missing data/signature in LiqPay webhook body");
        return res.status(400).send("Bad Request");
      }

      const privateKey = LIQPAY_PRIVATE_KEY.value();
      const expected = crypto.createHash("sha1").update(privateKey + data + privateKey).digest("base64");
      if (expected !== signature) {
        console.error("❌ Invalid LiqPay signature");
        return res.status(400).send("Invalid signature");
      }

      const decoded = JSON.parse(Buffer.from(data, "base64").toString("utf8"));
      console.log("🔔 LiqPay webhook decoded:", {
        status: decoded.status,
        order_id: decoded.order_id,
        payment_id: decoded.payment_id,
        amount: decoded.amount,
        currency: decoded.currency,
      });

      // Успешные статусы LiqPay
      const okStatuses = ["success", "sandbox", "subscribed"];
      const status = String(decoded.status || "").toLowerCase();
      if (!okStatuses.includes(status)) {
        return res.status(200).send("ignored");
      }

      // Метаданные (мы туда клали JSON-строку в поле info)
      let metadata = {};
      try {
        metadata = JSON.parse(decoded.info || "{}");
      } catch {
        metadata = {};
      }

      const uid = metadata.uid;
      if (!uid) {
        console.error("❌ No uid in metadata");
        return res.status(200).send("no uid");
      }

      const paymentId =
        (decoded.payment_id && String(decoded.payment_id)) ||
        (decoded.acq_id && String(decoded.acq_id)) ||
        (decoded.order_id && String(decoded.order_id));

      // Записываем платеж: customers/{uid}/payments/{paymentId}
      const paymentRef = admin.firestore().collection(`customers/${uid}/payments`).doc(paymentId);

      await paymentRef.set(
        {
          status: "succeeded",
          presentation_amount: Math.round(Number(decoded.amount) * 100) || 0, // копейки
          presentation_currency: String(decoded.currency || "UAH").toUpperCase(),
          customer: decoded.sender_card_mask2 || null,
          metadata,
          created: admin.firestore.FieldValue.serverTimestamp(),
          liqpay: {
            order_id: decoded.order_id || null,
            payment_id: decoded.payment_id || null,
            status: decoded.status || null,
            description: decoded.description || null,
          },
        },
        { merge: true }
      );

      // Важно: set создаёт новый документ → сработает onPaymentCreated (создаст orders)
      return res.status(200).send("ok");
    } catch (err) {
      console.error("🔥 liqpayWebhook error:", err);
      return res.status(500).send("error");
    }
  }
);
