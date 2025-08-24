// functions/processCashbackDue.js
const { onSchedule } = require("firebase-functions/v2/scheduler");
const admin = require("firebase-admin");
const { defineSecret } = require("firebase-functions/params");
const Wise = require('transferwise'); // npm install transferwise

if (!admin.apps.length) {
  admin.initializeApp();
}

const WISE_API_KEY = defineSecret("WISE_API_KEY");
const WISE_PROFILE_ID = defineSecret("WISE_PROFILE_ID"); // Добавлено: Ваш profileId из Wise
const CASHBACK_DELAY_MS = 1*60*1000; // 17 дней прод; 1*60*1000 тест
const db = admin.firestore();
const functions = require("firebase-functions"); // Для callable

exports.processCashbackDue = onSchedule({
  schedule: "every 1 minutes", // Тест; прод "every day"
  secrets: [WISE_API_KEY, WISE_PROFILE_ID],
}, async () => {
  console.log("processCashbackDue started...");

  const now = admin.firestore.Timestamp.now();
  const wise = new Wise({
    apiToken: WISE_API_KEY.value(),  // теперь работает
    environment: "sandbox",
  });

  const snapshot = await db.collectionGroup("cashbacks")
    .where("pending", "==", true)
    .get();

  if (snapshot.empty) {
    console.log("Нет pending cashback");
    return null;
  }

  const batch = db.batch();
  const refreshShipmentStatus = functions.httpsCallable("refreshShipmentStatus"); // Для вызова

  for (const doc of snapshot.docs) {
    const data = doc.data();

    if (data.pendingAt && now.toMillis() - data.pendingAt.toMillis() >= CASHBACK_DELAY_MS) {
      if (!data.userBankDetails || !data.userBankDetails.iban) {
        batch.update(doc.ref, {
          skipped: true,
          skippedReason: 'No bank details',
        });
        continue;
      }

      // Добавлено: Проверка статуса TTN buyer (пользователь 2)
      let skipReason = null;
      if (data.buyerTTN) {
        try {
          await refreshShipmentStatus({ ttn: data.buyerTTN }); // Update status
          const ttnDoc = await db.collection("ttns").doc(data.buyerTTN).get();
          const ttnData = ttnDoc.data();
          if (ttnData && ttnData.status !== "Відправлення отримано" ||
            ttnData.status.toLowerCase().includes('відмова') ||
            ttnData.status.toLowerCase().includes('повернення')) {
            skipReason = 'Shipment refused or returned';
          }
        } catch (err) {
          console.error("Error checking TTN:", err);
          skipReason = 'TTN check failed';
        }
      } else {
        skipReason = 'No buyer TTN';
      }

      if (skipReason) {
        batch.update(doc.ref, {
          skipped: true,
          skippedReason,
        });
        continue;
      }

      try {
        console.log(`Делаем Wise transfer для cashback ${doc.id} → IBAN ${data.userBankDetails.iban}`);

        const profileId = WISE_PROFILE_ID.value();

        const quote = await wise.quotes.create({
          profile: profileId,
          sourceCurrency: 'EUR', // Адаптируйте
          targetCurrency: 'UAH',
          targetAmount: data.amount / 100,
        });

        const recipient = await wise.accounts.create({
          profile: profileId,
          currency: 'UAH',
          type: 'iban',
          details: {
            legalType: 'PRIVATE',
            iban: data.userBankDetails.iban,
            accountHolderName: data.userBankDetails.name,
            bic: data.userBankDetails.bic || undefined,
          },
        });

        const transfer = await wise.transfers.create({
          targetAccount: recipient.id,
          quoteUuid: quote.uuid,
          customerTransactionId: `cashback-${doc.id}`,
          details: {
            reference: `Referral cashback ${doc.id}`,
          },
        });

        await wise.transfers.fund({
          profile: profileId,
          transferId: transfer.id,
          type: 'BALANCE',
        });

        console.log("Wise transfer successful:", transfer.id);

        batch.update(doc.ref, {
          pending: false,
          sent: true,
          paidAt: now,
          wiseTransferId: transfer.id,
        });
      } catch (err) {
        console.error("Ошибка перевода Wise:", err);
        batch.update(doc.ref, { error: err.message });
      }
    }
  }

  await batch.commit();
  console.log("processCashbackDue finished");
  return null;
});
