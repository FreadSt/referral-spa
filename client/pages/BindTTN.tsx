import React, { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { useToast } from "@/hooks/use-toast";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { db } from "@/lib/firebase";
import {
  doc,
  setDoc,
  getDocs,
  collection,
  query,
  orderBy,
  limit,
  serverTimestamp,
} from "firebase/firestore";
import { getFunctions, httpsCallable } from "firebase/functions";

type TTNFormValues = {
  email: string;
  ttn: string;
};

type OrderRow = {
  id: string;
  email: string;
  createdAt: Date | null;
  ttn?: string;
  status?: string;
  receivedAt?: Date | null;
  referralSent?: boolean;
  referralCode?: string;
};

const BindTTN: React.FC = () => {
  const { register, handleSubmit, formState: { errors, isSubmitting }, reset } = useForm<TTNFormValues>();
  const { toast } = useToast();

  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [loadingOrders, setLoadingOrders] = useState(false);
  const [refreshingAll, setRefreshingAll] = useState(false);
  const [expandedRow, setExpandedRow] = useState<string | null>(null);
  const [currentTime, setCurrentTime] = useState(new Date());

  // Важно: регион us-central1, т.к. твои функции деплоятся туда
  const functions = getFunctions(undefined, "us-central1");
  const refreshShipmentStatus = httpsCallable(functions, "refreshShipmentStatus");

  const toDateSafe = (v: any): Date | null => {
    try {
      if (!v) return null;
      if (typeof v.toDate === "function") return v.toDate();
      if (v instanceof Date) return v;
      return null;
    } catch {
      return null;
    }
  };

  const fetchOrders = async () => {
    setLoadingOrders(true);
    try {
      // 1) Получаем заказы — одна сортировка по createdAt НЕ требует композитного индекса
      const ordersSnap = await getDocs(
        query(collection(db, "orders"), orderBy("createdAt", "desc"), limit(100))
      );

      // 2) Получаем все TTN
      const ttnSnap = await getDocs(collection(db, "ttns"));

      // Собираем map по email (берём самый свежий по createdAt, если их несколько)
      const ttnByEmail = new Map<string, { ttn: string; status?: string; createdAt?: Date | null; receivedAt?: Date | null; referralSent?: boolean; referralCode?: string }>();
      ttnSnap.forEach((d) => {
        const t = d.data() as any;
        if (!t?.email) return;
        const current = ttnByEmail.get(t.email);
        const created = toDateSafe(t.createdAt);
        if (!current || (created && (!current.createdAt || created > current.createdAt))) {
          ttnByEmail.set(t.email, {
            ttn: t.ttn || d.id,
            status: t.status,
            createdAt: created,
            receivedAt: toDateSafe(t.receivedAt),
            referralSent: t.referralSent ?? false,
            referralCode: t.referralCode || undefined,
          });
        }
      });

      const rows: OrderRow[] = [];
      ordersSnap.forEach((d) => {
        const data = d.data() as any;
        const email = data.email || "";
        const createdAt = toDateSafe(data.createdAt);
        const link = ttnByEmail.get(email);

        rows.push({
          id: d.id,
          email,
          createdAt,
          ttn: link?.ttn,
          status: link?.status,
          receivedAt: link?.receivedAt,
          referralSent: link?.referralSent,
          referralCode: link?.referralCode,
        });
      });

      setOrders(rows);
    } catch (err) {
      console.error("Error fetching orders:", err);
      toast({
        title: "❌ Помилка",
        description: "Не вдалося завантажити замовлення",
        variant: "destructive",
      });
    } finally {
      setLoadingOrders(false);
    }
  };

  useEffect(() => {
    fetchOrders();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Реал-тайм таймер (обновляется каждую секунду для всех расширенных строк)
  useEffect(() => {
    const interval = setInterval(() => {
      setCurrentTime(new Date());
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  const onSubmit = async (data: TTNFormValues) => {
    try {
      // Видалено перевірку на існування замовлення, щоб дозволити прив'язку для будь-яких email/TTN

      // Создаём/обновляем документ TTN (id документа = номер TTN)
      await setDoc(doc(db, "ttns", data.ttn), {
        email: data.email,
        ttn: data.ttn,
        createdAt: serverTimestamp(),
        status: "pending",
      }, { merge: true });

      // Сразу дергаем обновление статуса только для этого TTN
      try {
        await refreshShipmentStatus({ ttn: data.ttn });
      } catch (e: any) {
        console.warn("refreshShipmentStatus(ttn) warn:", e?.message || e);
      }

      toast({ title: "✅ Успіх", description: "TTN успішно прив'язано" });
      reset({ ttn: "", email: data.email });
      await fetchOrders();
    } catch (err: any) {
      console.error("Error in onSubmit:", err);
      toast({
        title: "❌ Помилка",
        description: err?.message || "Не вдалося прив'язати TTN",
        variant: "destructive",
      });
    }
  };

  const handleRefreshAll = async () => {
    setRefreshingAll(true);
    try {
      // Пустой payload => функция сама обновит все pending
      const res: any = await refreshShipmentStatus({});
      const updated = res?.data?.updated ?? 0;
      toast({ title: "🔄 Оновлено", description: `Оновлено статусів: ${updated}` });
      await fetchOrders();
    } catch (err: any) {
      console.error("refreshShipmentStatus error:", err);
      toast({
        title: "❌ Помилка",
        description: err?.message || "Не вдалося оновити статуси",
        variant: "destructive",
      });
    } finally {
      setRefreshingAll(false);
    }
  };

  const renderStatus = (status?: string) => {
    if (!status) return "—";                // нет запроса к API / еще не обновляли
    if (status === "pending") return "Очікує оновлення";
    return status;                          // текст из Nova Poshta (может быть «Номер не знайдено», «Видано», и т.п.)
  };

  const formatTimeLeft = (seconds: number): string => {
    const days = Math.floor(seconds / (3600 * 24));
    const hours = Math.floor((seconds % (3600 * 24)) / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);
    return `${days}д ${hours}г ${minutes}хв ${secs}с`;
  };

  return (
    <div className="px-4 py-8 sm:px-6 lg:px-8">
      {/* Форма */}
      <div className="max-w-md mx-auto bg-white rounded-2xl shadow-lg p-6 sm:p-8 border border-gray-200 mb-8">
        <h1 className="text-2xl font-semibold text-center mb-6">Прив'язати номер TTN</h1>
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-5">
          <div>
            <label className="block mb-1 text-sm font-medium text-gray-700">Email</label>
            <Input
              type="email"
              {...register("email", { required: "Вкажіть email" })}
              placeholder="example@email.com"
              className="focus-visible:ring-2 focus-visible:ring-primary"
            />
            {errors.email && <p className="text-sm text-red-500 mt-1">{errors.email.message}</p>}
          </div>

          <div>
            <label className="block mb-1 text-sm font-medium text-gray-700">Номер TTN</label>
            <Input
              type="text"
              {...register("ttn", { required: "Вкажіть TTN" })}
              placeholder="Введіть номер TTN"
              className="focus-visible:ring-2 focus-visible:ring-primary"
            />
            {errors.ttn && <p className="text-sm text-red-500 mt-1">{errors.ttn.message}</p>}
          </div>

          <Button
            type="submit"
            disabled={isSubmitting}
            className="w-full transition-all duration-150 hover:scale-[1.01]"
          >
            {isSubmitting ? "Обробка..." : "Прив'язати TTN"}
          </Button>
        </form>
      </div>

      {/* Таблица */}
      <div className="bg-white rounded-2xl shadow-lg p-6 border border-gray-200">
        <div className="flex flex-col sm:flex-row justify-between gap-3 sm:items-center mb-4">
          <h2 className="text-xl font-semibold">Список замовлень</h2>
          <div className="flex gap-2">
            <Button variant="outline" onClick={fetchOrders} disabled={loadingOrders}>
              {loadingOrders ? "Завантаження..." : "🔁 Оновити список"}
            </Button>
            <Button variant="secondary" onClick={handleRefreshAll} disabled={refreshingAll}>
              {refreshingAll ? "Оновлення..." : "📦 Оновити статуси TTN"}
            </Button>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="min-w-full border border-gray-200">
            <thead>
            <tr className="bg-gray-100 border-b border-gray-200">
              <th className="py-2 px-4 text-left">Email</th>
              <th className="py-2 px-4 text-left">Дата створення</th>
              <th className="py-2 px-4 text-left">TTN</th>
              <th className="py-2 px-4 text-left">Статус</th>
            </tr>
            </thead>
            <tbody>
            {orders.map((o) => (
              <React.Fragment key={o.id}>
                <tr
                  onClick={() => setExpandedRow(expandedRow === o.id ? null : o.id)}
                  className="border-b border-gray-200 cursor-pointer hover:bg-gray-50"
                >
                  <td className="py-2 px-4">{o.email || "-"}</td>
                  <td className="py-2 px-4">
                    {o.createdAt ? o.createdAt.toLocaleString() : "-"}
                  </td>
                  <td className="py-2 px-4">{o.ttn || "-"}</td>
                  <td className="py-2 px-4">{renderStatus(o.status)}</td>
                </tr>
                {expandedRow === o.id && (
                  <tr>
                    <td colSpan={4} className="p-4 bg-gray-50 border-b border-gray-200">
                      {o.status === "Відправлення отримано" && o.receivedAt ? (
                        (() => {
                          const deadline = new Date(o.receivedAt.getTime() + 30 * 1000);
                          const timeLeftSeconds = Math.max(0, (deadline.getTime() - currentTime.getTime()) / 1000);
                          if (timeLeftSeconds > 0) {
                            return (
                              <div>
                                <p className="text-sm font-medium text-gray-700">Залишилося до генерації реферальної посилання:</p>
                                <p className="text-lg font-bold text-primary">{formatTimeLeft(timeLeftSeconds)}</p>
                              </div>
                            );
                          } else if (o.referralSent && o.referralCode) {
                            const baseUrl = window.location.origin; // Замініть на ваш APP_URL, якщо є env
                            const referralLink = `${baseUrl}/?code=${o.referralCode}`;
                            return (
                              <div>
                                <p className="text-sm font-medium text-green-600">✅ Посилання сгенеровано та надіслано</p>
                                <a href={referralLink} className="text-blue-500 underline" target="_blank" rel="noopener noreferrer">
                                  {referralLink}
                                </a>
                              </div>
                            );
                          } else {
                            return <p className="text-sm text-gray-500">Очікує генерації (оновіть сторінку)</p>;
                          }
                        })()
                      ) : (
                        <p className="text-sm text-gray-500">Таймер доступний тільки для статусу "Відправлення отримано"</p>
                      )}
                    </td>
                  </tr>
                )}
              </React.Fragment>
            ))}
            {orders.length === 0 && (
              <tr>
                <td colSpan={4} className="py-4 text-center text-gray-500">
                  Замовлень не знайдено
                </td>
              </tr>
            )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

export default BindTTN;
