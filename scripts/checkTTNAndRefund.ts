import axios from 'axios'
import Stripe from 'stripe'
import { boundTtnList } from '../server/routes/ttn'
import { referredPurchases } from '../server/routes/referral'

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: '2023-10-16',
})

export const checkNovaPoshta = async () => {
  const apiKey = process.env.NOVA_POSHTA_KEY!
  for (const record of boundTtnList.filter(r => !r.pickedUp)) {
    const res = await axios.post('https://api.novaposhta.ua/v2.0/json/', {
      apiKey,
      modelName: 'TrackingDocument',
      calledMethod: 'getStatusDocuments',
      methodProperties: {
        Documents: [{ DocumentNumber: record.ttn }],
      },
    })

    const status = res.data.data?.[0]?.Status
    if (status?.toLowerCase().includes('вручено')) {
      record.pickedUp = true

      // Найти запись в referredPurchases
      const purchase = referredPurchases.find(p => p.referredEmail === record.email)
      if (purchase && !purchase.refunded) {
        const session = await stripe.checkout.sessions.retrieve(purchase.orderId!)
        const paymentIntentId = session.payment_intent as string
        const intent = await stripe.paymentIntents.retrieve(paymentIntentId, { expand: ['charges'] })
        const chargeId = intent.charges.data[0]?.id

        if (chargeId) {
          await stripe.refunds.create({
            charge: chargeId,
            amount: 1000, // 10 грн (копейки)
          })

          purchase.refunded = true
          console.log(`✅ Refunded 1000 грн to referrer of ${record.email}`)
        }
      }
    }
  }
}
