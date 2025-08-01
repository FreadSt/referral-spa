import { RequestHandler } from "express";
import Stripe from "stripe";
import dotenv from "dotenv";
dotenv.config();
import { referralDataStore, referredPurchases } from "./referral";
import { v4 as uuidv4 } from "uuid";

// Make sure your .env file is in the project root and contains:
// STRIPE_SECRET_KEY=sk_test_...
// VITE_STRIPE_PUBLISHABLE_KEY=pk_test_...
// The server uses STRIPE_SECRET_KEY, the client uses VITE_STRIPE_PUBLISHABLE_KEY

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: "2025-06-30.basil",
});

export const createCheckoutSession: RequestHandler = async (req, res) => {
  try {
    const { price, quantity = 1, customer_email, referralCode } = req.body;

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ["card"],
      line_items: [
        {
          price, // Stripe Price ID
          quantity,
        },
      ],
      mode: "payment",
      customer_email,
      success_url: "http://localhost:8080/success",
      cancel_url: "http://localhost:8080/product",
    });

    // Generate referral code for the user if not already present
    let generatedReferralCode: string | undefined;
    if (customer_email) {
      const existing = Object.values(referralDataStore).find(data => data.userId === customer_email);
      if (!existing) {
        generatedReferralCode = uuidv4();
        referralDataStore[generatedReferralCode] = {
          userId: customer_email,
          referralCode: generatedReferralCode,
          purchaseTimestamp: Date.now(),
          status: "pending",
        };
      } else {
        generatedReferralCode = existing.referralCode;
      }
    }

    // Track referred purchase if referralCode and customer_email are present
    if (referralCode && customer_email) {
      referredPurchases.push({
        referralCode,
        referredEmail: customer_email,
        orderId: session.id,
        status: "paid",
        timestamp: Date.now(),
      });
    }

    res.json({ sessionId: session.id, referralCode: generatedReferralCode });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
};

export const createPaymentIntent: RequestHandler = async (req, res) => {
  try {
    const { amount, currency = "usd", metadata = {} } = req.body;

    if (!amount || amount <= 0) {
      return res.status(400).json({
        error: "Invalid amount. Amount must be greater than 0.",
      });
    }

    const paymentIntent = await stripe.paymentIntents.create({
      amount: Math.round(amount), // Ensure amount is an integer
      currency,
      metadata,
      automatic_payment_methods: {
        enabled: true,
      },
    });

    res.json({
      clientSecret: paymentIntent.client_secret,
      paymentIntentId: paymentIntent.id,
    });
  } catch (error) {
    console.error("Error creating payment intent:", error);
    res.status(500).json({
      error: "Failed to create payment intent",
      message: error instanceof Error ? error.message : "Unknown error",
    });
  }
};

export const confirmPayment: RequestHandler = async (req, res) => {
  try {
    const { paymentIntentId } = req.body;

    if (!paymentIntentId) {
      return res.status(400).json({
        error: "Payment Intent ID is required",
      });
    }

    const paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId);

    res.json({
      status: paymentIntent.status,
      paymentIntent,
    });
  } catch (error) {
    console.error("Error confirming payment:", error);
    res.status(500).json({
      error: "Failed to confirm payment",
      message: error instanceof Error ? error.message : "Unknown error",
    });
  }
};

export const createCustomer: RequestHandler = async (req, res) => {
  try {
    const { email, name, phone } = req.body;

    if (!email) {
      return res.status(400).json({
        error: "Email is required",
      });
    }

    const customer = await stripe.customers.create({
      email,
      name,
      phone,
    });

    res.json({
      customerId: customer.id,
      customer,
    });
  } catch (error) {
    console.error("Error creating customer:", error);
    res.status(500).json({
      error: "Failed to create customer",
      message: error instanceof Error ? error.message : "Unknown error",
    });
  }
};

// Debug route to test Stripe Price ID
import { Request, Response } from "express";

export const debugPrice: RequestHandler = async (req: Request, res: Response) => {
  try {
    const price = await stripe.prices.retrieve(req.params.id);
    res.json(price);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
};

export const refundOrder: RequestHandler = async (req, res) => {
  const { orderId } = req.params;
  console.log(req.params, 'orderID')
  try {
    // Retrieve the session to get the payment intent
    const session = await stripe.checkout.sessions.retrieve(orderId);
    const paymentIntentId = session.payment_intent as string;
    if (!paymentIntentId) {
      return res.status(400).json({ error: "No payment intent in session" });
    }
    // Retrieve the payment intent to get the charge
    const paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId);
    const chargeId = paymentIntent.charges.data[0].id;
    if (!chargeId) {
      return res.status(400).json({ error: "No charge found for this payment intent" });
    }
    // Create a partial refund (e.g., 1000 UAH = 100000 kopecks)
    const refund = await stripe.refunds.create({
      charge: chargeId,
      amount: 3000, // 30 UAH in kopecks
    });
    res.json({ refund });
    console.log('Refund created:', refund);
  } catch (error: any) {
    console.error('Refund error:', error);
    res.status(500).json({ error: error.message });
  }
};



