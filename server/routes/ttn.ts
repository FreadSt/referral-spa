import { RequestHandler } from "express";
import { db } from "../lib/firebase-admin.ts"; // путь до файла firebase-admin.ts

export const bindTtn: RequestHandler = async (req, res) => {
  const { email, ttn } = req.body;
  console.log("Получены данные:", { email, ttn });

  if (!email || !ttn) {
    return res.status(400).json({ error: "Missing email or TTN" });
  }

  const snapshot = await db
    .collection("orders")
    .where("customer_email", "==", email)
    .where("received", "==", false)
    .get();

  console.log("Найдено заказов:", snapshot.size, "для email:", email);

  if (snapshot.empty) {
    return res.status(404).json({ error: "No pending order found for this email" });
  }

  const orderDoc = snapshot.docs[0];
  await orderDoc.ref.update({ ttn });
  console.log("TTN обновлен для заказа:", orderDoc.id);

  res.json({ success: true });
};
