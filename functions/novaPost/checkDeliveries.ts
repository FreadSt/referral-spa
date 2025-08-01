import * as admin from '../../server/lib/firebase-admin';
import fetch from 'node-fetch';
import { processRefund } from '../refunds/processRefund';

const db = admin.firestore();

export const checkDeliveries = async () => {
  const snapshot = await db
    .collection('orders')
    .where('received', '==', false)
    .where('ttn', '!=', null)
    .get();

  for (const doc of snapshot.docs) {
    const order = doc.data();
    const ttn = order.ttn;

    const response = await fetch('https://api.novaposhta.ua/v2.0/json/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        apiKey: process.env.NOVAPOSHTA_KEY,
        modelName: 'TrackingDocument',
        calledMethod: 'getStatusDocuments',
        methodProperties: {
          Documents: [{ DocumentNumber: ttn }],
        },
      }),
    });

    const json = await response.json();
    const status = json?.data?.[0]?.Status?.toLowerCase();

    if (status?.includes('вручено') || status?.includes('доставлен')) {
      console.log(`📦 Order ${doc.id} delivered!`);

      await doc.ref.update({ received: true });

      // 🪙 если есть реферер — начисляем вознаграждение
      if (order.referrerId) {
        await processRefund(doc.id);
      }
    }
  }
};
