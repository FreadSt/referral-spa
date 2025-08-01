import * as admin from "./lib/firebase-admin.ts";
import { createServer } from "./index";
import * as dotenv from "dotenv";

dotenv.config();

// Initialize Firebase Admin
if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert({
      projectId: process.env.FIREBASE_PROJECT_ID!,
      privateKey: process.env.FIREBASE_PRIVATE_KEY!?.replace(/\\n/g, "\n"),
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL!,
    }),
  });
}

const app = createServer();
const port = process.env.PORT || 3000;

app.listen(port, () => {
  console.log(`Express server running on http://localhost:${port}`);
});
