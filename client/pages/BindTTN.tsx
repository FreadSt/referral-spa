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

type BankFormValues = {
  iban: string;
  bic?: string;
  holderName: string;
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
  name?: string;
  phone?: string;
  address?: string;
  cashbacks?: Array<{
    pending: boolean;
    pendingAt?: Date | null;
    sent: boolean;
    amount?: number;
    buyerEmail?: string;
    skipped?: boolean;
    skippedReason?: string;
  }>;
  bankDetails?: { iban: string; bic?: string; name: string };
};

const REFERRAL_DELAY_MS = 1 * 60 * 1000; // 1 хв для тесту
const CASHBACK_DELAY_MS = 1 * 60 * 1000; // 1 хв для тесту

const BindTTN: React.FC = () => {
  const {
    register: registerTTN,
    handleSubmit: handleSubmitTTN,
    formState: { errors: errorsTTN, isSubmitting: isSubmittingTTN },
    reset: resetTTN,
  } = useForm<TTNFormValues>();
  const { toast } = useToast();

  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [loadingOrders, setLoadingOrders] = useState(false);
  const [refreshingAll, setRefreshingAll] = useState(false);
  const [expandedRow, setExpandedRow] = useState<string | null>(null);
  const [currentTime, setCurrentTime] = useState(new Date());

  const functions = getFunctions(undefined, "us-central1");
  const refreshShipmentStatus = httpsCallable(functions, "refreshShipmentStatus");
  const createBankDetailsOnboarding = httpsCallable(
    functions,
    "createBankDetailsOnboarding"
  );

  const {
    register: registerBank,
    handleSubmit: handleSubmitBank,
    formState: { errors: errorsBank, isSubmitting: isSubmittingBank },
    reset: resetBank,
  } = useForm<BankFormValues>();

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
      const ordersSnap = await getDocs(
        query(collection(db, "orders"), orderBy("createdAt", "desc"), limit(100))
      );

      const ttnSnap = await getDocs(collection(db, "ttns"));

      const ttnByEmail = new Map<
        string,
        {
          ttn: string;
          status?: string;
          createdAt?: Date | null;
          receivedAt?: Date | null;
          referralSent?: boolean;
          referralCode?: string;
        }
      >();
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

      // referrals + subcollection cashbacks
      const referralsSnap = await getDocs(collection(db, "referrals"));
      const referralsByEmail = new Map<
        string,
        { createdAt?: Date | null; cashbacks: Array<any> }
      >();
      for (const refDoc of referralsSnap.docs) {
        const r = refDoc.data() as any;
        if (!r?.email) continue;
        const current = referralsByEmail.get(r.email);
        const created = toDateSafe(r.createdAt);
        if (current && created && current.createdAt && created <= current.createdAt) continue;

        const cashbacksSnap = await getDocs(collection(refDoc.ref, "cashbacks"));
        const cashbacks = cashbacksSnap.docs.map((cb) => ({
          ...cb.data(),
          pendingAt: toDateSafe(cb.data().pendingAt),
        }));

        referralsByEmail.set(r.email, {
          createdAt: created,
          cashbacks,
        });
      }

      // users → bankDetails
      const usersSnap = await getDocs(collection(db, "users"));
      const bankByEmail = new Map<string, { iban: string; bic?: string; name: string }>();
      usersSnap.forEach((u) => {
        const data = u.data() as any;
        if (data?.email && data.bankDetails) {
          bankByEmail.set(data.email, data.bankDetails);
        }
      });

      const rows: OrderRow[] = [];
      ordersSnap.forEach((d) => {
        const data = d.data() as any;
        const email = data.email || "";
        const createdAt = toDateSafe(data.createdAt);
        const ttnLink = ttnByEmail.get(email);
        const referralLink = referralsByEmail.get(email);
        const bankLink = bankByEmail.get(email);

        rows.push({
          id: d.id,
          email,
          createdAt,
          ttn: ttnLink?.ttn,
          status: ttnLink?.status,
          receivedAt: ttnLink?.receivedAt,
          referralSent: ttnLink?.referralSent,
          referralCode: ttnLink?.referralCode,
          name: data.name || data.metadata?.name || undefined,
          phone: data.phone || data.metadata?.phone || undefined,
          address: data.address || data.metadata?.address || undefined,
          cashbacks: referralLink?.cashbacks || [],
          bankDetails: bankLink,
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
    const autoRefresh = setInterval(fetchOrders, 10000);
    return () => clearInterval(autoRefresh);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const interval = setInterval(() => {
      setCurrentTime(new Date());
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  const onSubmitTTN = async (data: TTNFormValues) => {
    try {
      await setDoc(
        doc(db, "ttns", data.ttn),
        {
          email: data.email,
          ttn: data.ttn,
          createdAt: serverTimestamp(),
          status: "pending",
          referralSent: false, // Добавьте это поле
          receivedAt: null,
        },
        { merge: true }
      );

      try {
        await refreshShipmentStatus({ ttn: data.ttn });
      } catch (e: any) {
        console.warn("refreshShipmentStatus(ttn) warn:", e?.message || e);
      }

      toast({ title: "✅ Успіх", description: "TTN успішно прив'язано" });
      resetTTN({ ttn: "", email: data.email });
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

  const onSubmitBank = async (data: BankFormValues, email: string) => {
    try {
      await createBankDetailsOnboarding({
        email,
        iban: data.iban,
        bic: data.bic || "",
        name: data.holderName,
      });
      toast({ title: "✅ Успіх", description: "Банківські дані збережено" });
      resetBank();
      await fetchOrders();
    } catch (err: any) {
      toast({
        title: "❌ Помилка",
        description: err?.message || "Не вдалося зберегти банківські дані",
        variant: "destructive",
      });
    }
  };

  const handleRefreshAll = async () => {
    setRefreshingAll(true);
    try {
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
    if (!status) return "—";
    if (status === "pending") return "Очікує оновлення";
    return status;
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
      {/* Форма TTN */}
      <div className="max-w-md mx-auto bg-white rounded-2xl shadow-lg p-6 sm:p-8 border border-gray-200 mb-8">
        <h1 className="text-2xl font-semibold text-center mb-6">Прив'язати номер TTN</h1>
        <form onSubmit={handleSubmitTTN(onSubmitTTN)} className="space-y-5">
          <div>
            <label className="block mb-1 text-sm font-medium text-gray-700">Email</label>
            <Input
              type="email"
              {...registerTTN("email", { required: "Вкажіть email" })}
              placeholder="example@email.com"
              className="focus-visible:ring-2 focus-visible:ring-primary"
            />
            {errorsTTN.email && (
              <p className="text-sm text-red-500 mt-1">{errorsTTN.email.message}</p>
            )}
          </div>

          <div>
            <label className="block mb-1 text-sm font-medium text-gray-700">Номер TTN</label>
            <Input
              type="text"
              {...registerTTN("ttn", { required: "Вкажіть TTN" })}
              placeholder="Введіть номер TTN"
              className="focus-visible:ring-2 focus-visible:ring-primary"
            />
            {errorsTTN.ttn && (
              <p className="text-sm text-red-500 mt-1">{errorsTTN.ttn.message}</p>
            )}
          </div>

          <Button
            type="submit"
            disabled={isSubmittingTTN}
            className="w-full transition-all duration-150 hover:scale-[1.01]"
          >
            {isSubmittingTTN ? "Обробка..." : "Прив'язати TTN"}
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
              <th className="py-2 px-4 text-left">Ім'я</th>
              <th className="py-2 px-4 text-left">Телефон</th>
              <th className="py-2 px-4 text-left">Адреса</th>
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
                  <td className="py-2 px-4">{o.name || "-"}</td>
                  <td className="py-2 px-4">{o.phone || "-"}</td>
                  <td className="py-2 px-4">{o.address || "-"}</td>
                  <td className="py-2 px-4">
                    {o.createdAt ? o.createdAt.toLocaleString() : "-"}
                  </td>
                  <td className="py-2 px-4">{o.ttn || "-"}</td>
                  <td className="py-2 px-4">{renderStatus(o.status)}</td>
                </tr>

                {expandedRow === o.id && (
                  <tr>
                    <td colSpan={7} className="p-4 bg-gray-50 border-b border-gray-200">
                      {/* Блок: таймер → ссылка */}
                      {o.receivedAt || o.referralSent ? (
                        <>
                          {(() => {
                            const deadline = o.receivedAt
                              ? new Date(o.receivedAt.getTime() + REFERRAL_DELAY_MS)
                              : null;
                            const timeLeftSeconds = deadline
                              ? Math.max(
                                0,
                                (deadline.getTime() - currentTime.getTime()) / 1000
                              )
                              : 0;

                            if (deadline && timeLeftSeconds > 0 && !o.referralSent) {
                              return (
                                <div className="mb-4">
                                  <p className="text-sm font-medium text-gray-700">
                                    Залишилося до генерації реферальної посилання:
                                  </p>
                                  <p className="text-lg font-bold text-primary">
                                    {formatTimeLeft(timeLeftSeconds)}
                                  </p>
                                </div>
                              );
                            }

                            if (o.referralSent && o.referralCode) {
                              const baseUrl = window.location.origin;
                              const referralLink = `${baseUrl}/?code=${o.referralCode}`;
                              return (
                                <div className="mb-4">
                                  <p className="text-sm font-medium text-green-600">
                                    ✅ Посилання сгенеровано та надіслано
                                  </p>
                                  <a
                                    href={referralLink}
                                    className="text-blue-500 underline break-all"
                                    target="_blank"
                                    rel="noopener noreferrer"
                                  >
                                    {referralLink}
                                  </a>
                                </div>
                              );
                            }

                            return (
                              <p className="text-sm text-gray-500 mb-4">
                                ⏳ Посилання ще генерується… (оновіть сторінку)
                              </p>
                            );
                          })()}
                        </>
                      ) : (
                        <p className="text-sm text-gray-500">
                          Таймер доступний після статусу отримання посилки
                        </p>
                      )}

                      {/* Блок: кешбеки */}
                      {o.cashbacks && o.cashbacks.length > 0 ? (
                        <div className="mt-2">
                          <p className="text-sm font-medium text-gray-700">Кешбеки:</p>
                          {o.cashbacks.map((cb, idx) => (
                            <div key={idx} className="ml-4 text-sm">
                              {cb.pending && cb.pendingAt ? (
                                (() => {
                                  const deadline = new Date(
                                    cb.pendingAt.getTime() + CASHBACK_DELAY_MS
                                  );
                                  const timeLeft =
                                    Math.max(
                                      0,
                                      (deadline.getTime() - currentTime.getTime()) / 1000
                                    ) || 0;
                                  if (timeLeft > 0) {
                                    return (
                                      <p>
                                        Залишилося для{" "}
                                        {cb.buyerEmail || "реферала"}:{" "}
                                        {formatTimeLeft(timeLeft)}
                                      </p>
                                    );
                                  } else if (cb.sent && cb.amount) {
                                    return (
                                      <p className="text-green-600">
                                        ✅ Надіслано для {cb.buyerEmail || "реферала"}:{" "}
                                        {(cb.amount / 100).toFixed(2)} UAH
                                      </p>
                                    );
                                  } else if (cb.skipped) {
                                    return (
                                      <p className="text-red-500">
                                        Пропущено для {cb.buyerEmail || "реферала"}:{" "}
                                        {cb.skippedReason || "Невідома причина"}
                                      </p>
                                    );
                                  }
                                  return (
                                    <p className="text-gray-500">
                                      Очікує для {cb.buyerEmail || "реферала"}
                                    </p>
                                  );
                                })()
                              ) : cb.sent ? (
                                <p className="text-green-600">
                                  ✅ Надіслано для {cb.buyerEmail || "реферала"}:{" "}
                                  {(cb.amount ?? 0 / 100).toFixed(2)} UAH
                                </p>
                              ) : cb.skipped ? (
                                <p className="text-red-500">
                                  Пропущено для {cb.buyerEmail || "реферала"}:{" "}
                                  {cb.skippedReason}
                                </p>
                              ) : null}
                            </div>
                          ))}
                        </div>
                      ) : (
                        <p className="text-sm text-gray-500">
                          Кешбек недоступний (немає рефералів з покупкою)
                        </p>
                      )}

                      {/* Блок: банківські дані для виплат – показувати, коли посилання вже надіслано */}
                      {o.referralSent && !o.bankDetails ? (
                        <div className="mt-4">
                          <p className="text-sm font-medium text-gray-700 mb-2">
                            Введіть банківські дані для виплат (IBAN):
                          </p>
                          <form
                            onSubmit={handleSubmitBank((data) =>
                              onSubmitBank(data, o.email)
                            )}
                            className="space-y-3"
                          >
                            <div>
                              <label className="block mb-1 text-xs font-medium text-gray-700">
                                IBAN
                              </label>
                              <Input
                                {...registerBank("iban", { required: "Вкажіть IBAN" })}
                                placeholder="UA..."
                              />
                              {errorsBank.iban && (
                                <p className="text-xs text-red-500">
                                  {errorsBank.iban.message}
                                </p>
                              )}
                            </div>
                            <div>
                              <label className="block mb-1 text-xs font-medium text-gray-700">
                                Ім'я власника
                              </label>
                              <Input
                                {...registerBank("holderName", {
                                  required: "Вкажіть ім'я",
                                })}
                                placeholder="Іван Іванов"
                              />
                              {errorsBank.holderName && (
                                <p className="text-xs text-red-500">
                                  {errorsBank.holderName.message}
                                </p>
                              )}
                            </div>
                            <div>
                              <label className="block mb-1 text-xs font-medium text-gray-700">
                                BIC (опціонально)
                              </label>
                              <Input {...registerBank("bic")} placeholder="BIC..." />
                            </div>
                            <Button
                              type="submit"
                              disabled={isSubmittingBank}
                              className="w-full text-sm"
                            >
                              {isSubmittingBank ? "Збереження..." : "Зберегти банківські дані"}
                            </Button>
                          </form>
                        </div>
                      ) : o.referralSent && o.bankDetails ? (
                        <p className="text-sm text-green-600 mt-2">
                          ✅ Банківські дані збережено (IBAN: {o.bankDetails.iban.slice(-4)})
                        </p>
                      ) : null}
                    </td>
                  </tr>
                )}
              </React.Fragment>
            ))}

            {orders.length === 0 && (
              <tr>
                <td colSpan={7} className="py-4 text-center text-gray-500">
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
