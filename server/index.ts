import express from "express";
import cors from "cors";
import { handleDemo } from "./routes/demo";
import { generateReferralCode, getReferralData, getReferredUsers } from "./routes/referral";
import {
  createPaymentIntent,
  confirmPayment,
  createCustomer,
  createCheckoutSession,
  debugPrice, refundOrder,
} from "./routes/stripe";
import * as admin from "./lib/firebase-admin.ts";
import { bindTtn } from "./routes/ttn";
import * as stripe from "stripe";

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.applicationDefault(),
  });
}

export function createServer() {
  const app = express();

  // Middleware
  app.use(cors());
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));
  app.use(cors({
    origin: 'http://localhost:8080', // Match your Vite dev server
    methods: ['GET', 'POST', 'OPTIONS'],
    credentials: true,
  }));

  // Example API routes
  app.get("/api/ping", (_req, res) => {
    res.json({ message: "Hello from Express server v2!" });
  });

  app.get("/api/debug-price/:id", debugPrice);


  app.get("/api/demo", handleDemo);

  app.post("/api/referral", generateReferralCode);
  app.get("/api/referral/:userId", getReferralData);
  app.get("/api/referred/:referralCode", getReferredUsers);

  app.post("/api/refund/:orderId", refundOrder);

  // Stripe API routes
  app.post("/api/create-payment-intent", createPaymentIntent);
  app.post('/api/create-checkout-session', createCheckoutSession);
  app.post("/api/confirm-payment", confirmPayment);
  app.post("/api/create-customer", createCustomer);
  app.post("/api/bind-ttn", bindTtn);
  return app;
}
