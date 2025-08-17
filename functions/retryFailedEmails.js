const { onCall } = require("firebase-functions/v2/https");
const admin = require("firebase-admin");
const { defineSecret } = require("firebase-functions/params");

const SENDGRID_API_KEY = defineSecret("SENDGRID_API_KEY");

exports.retryFailedEmails = onCall({
  secrets: [SENDGRID_API_KEY],
}, async (request) => {
  if (!request.auth) {
    throw new functions.https.HttpsError("unauthenticated", "Authentication required");
  }

  const { sessionId } = request.data;
  if (!sessionId) {
    throw new functions.https.HttpsError("invalid-argument", "Session ID required");
  }

  const uid = request.auth.uid;
  const sessionRef = admin
    .firestore()
    .collection(`customers/${uid}/checkout_sessions`)
    .doc(sessionId);

  const sessionDoc = await sessionRef.get();
  if (!sessionDoc.exists) {
    throw new functions.https.HttpsError("not-found", "Session not found");
  }

  await sessionRef.update({
    emailSent: false,
    emailSending: false,
    emailError: null,
    retryRequested: admin.firestore.FieldValue.serverTimestamp(),
  });

  return { success: true, message: "Email retry initiated" };
});
