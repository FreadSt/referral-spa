import cron from "node-cron";
import { checkDeliveries } from "../novaPost/checkDeliveries";
import { sendReferralLinks } from "../sendReferralLinks";

export const startCronJobs = () => {
  // Запуск каждые 10 секунд для теста
  cron.schedule("*/10 * * * * *", async () => {
    console.log("Running cron jobs...");
    await checkDeliveries();
    await sendReferralLinks();
  });
};
