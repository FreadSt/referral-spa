import Stripe from 'stripe';
import * as admin from '../../server/lib/firebase-admin';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: '2025-06-30.basil',
});

const db = admin.firestore();

export const processRefund = async (orderId: string) => {
  const orderRef = db.collection('orders').doc(orderId);
  const orderSnap = await orderRef.get();
  const order = orderSnap.data();

  if (!order || !order.referrerId || !order.chargeId) return;

  try {
    // Возврат фиксированной суммы 1000 грн в копейках (100000 копеек)
    await stripe.refunds.create({
      charge: order.chargeId,
      amount: 1000,
    });

    console.log(`✅ Partial refund for order ${orderId}`);

    await orderRef.update({ refunded: true });
  } catch (err) {
    console.error(`❌ Failed refund for order ${orderId}`, err);
  }
};
