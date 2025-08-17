const { onDocumentUpdated } = require("firebase-functions/v2/firestore");
const admin = require("firebase-admin");
const sendgrid = require("@sendgrid/mail");
const { defineSecret } = require("firebase-functions/params");

const SENDGRID_API_KEY = defineSecret("SENDGRID_API_KEY");

const sendSubscriptionWelcomeEmail = async (email) => {
  try {
    const msg = {
      to: email,
      from: "thiswolfram@gmail.com",
      subject: "🎉 Добро пожаловать в подписку!",
      html: `
        <h2>Спасибо за подписку!</h2>
        <p>Ваша подписка успешно активирована.</p>
      `,
    };
    await sendgrid.send(msg);
  } catch (error) {
    console.error("🔥 Subscription welcome email error:", error?.response?.body || error);
  }
};

const sendSubscriptionCanceledEmail = async (email) => {
  try {
    const msg = {
      to: email,
      from: "thiswolfram@gmail.com",
      subject: "😢 Подписка отменена",
      html: `
        <h2>Ваша подписка была отменена</h2>
        <p>Мы сожалеем, что вы решили отменить подписку.</p>
      `,
    };
    await sendgrid.send(msg);
  } catch (error) {
    console.error("🔥 Subscription canceled email error:", error?.response?.body || error);
  }
};

exports.onSubscriptionUpdated = onDocumentUpdated({
  document: "customers/{uid}/subscriptions/{subscriptionId}",
  secrets: [SENDGRID_API_KEY],
}, async (event) => {
  const newData = event.data.after.data();
  const oldData = event.data.before.data();
  const uid = event.params.uid;

  try {
    const userRecord = await admin.auth().getUser(uid);
    const email = userRecord.email;

    if (!email) return;

    sendgrid.setApiKey(SENDGRID_API_KEY.value());

    if (oldData?.status !== "active" && newData?.status === "active") {
      await sendSubscriptionWelcomeEmail(email);
    }

    if (newData?.status === "canceled" || newData?.status === "incomplete_expired") {
      await sendSubscriptionCanceledEmail(email);
    }
  } catch (error) {
    console.error("🔥 Error processing subscription update:", error);
  }
});
