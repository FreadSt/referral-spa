import React, { useEffect } from "react";
import { useNavigate, useSearchParams } from "react-router-dom"; // Заменил location на useSearchParams для consistency
import { Button } from "@/components/ui/button";
import Header from "@/components/Header";
import { getFunctions, httpsCallable } from "firebase/functions";
import { doc, getDoc, setDoc } from "firebase/firestore";
import { db } from "@/lib/firebase.ts";
import { useToast } from "@/hooks/use-toast"; // Добавьте для уведомлений об ошибках (если есть в проекте)

const Success: React.FC = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { toast } = useToast(); // Если нет — удалите и используйте console.error
  const functions = getFunctions();

  useEffect(() => {
    const confirmPayment = async () => {
      const sessionId = searchParams.get("session_id");
      if (!sessionId) {
        console.warn("No session_id in URL");
        return;
      }

      const email = localStorage.getItem("lastPurchaseEmail");
      if (!email) {
        toast({ title: "Ошибка", description: "Email не найден. Повторите покупку.", variant: "destructive" });
        return;
      }

      try {
        const orderRef = doc(db, "orders", email); // Если ID=email — ок, но рассмотрите смену на paymentId
        const orderDoc = await getDoc(orderRef);
        if (orderDoc.exists()) {
          const orderData = orderDoc.data();
          const createShipment = httpsCallable(functions, "createNovaPoshtaShipment");
          await createShipment({
            email,
            name: orderData.name,
            phone: orderData.phone,
            address: orderData.address,
          });
          await setDoc(orderRef, { status: "shipped" }, { merge: true });
        } else {
          console.warn("Order not found for email:", email);
        }
      } catch (err: any) {
        console.error("Payment confirmation error:", err);
        toast({ title: "Ошибка", description: "Не удалось подтвердить заказ. Свяжитесь с поддержкой.", variant: "destructive" });
      }
    };

    confirmPayment();
  }, [searchParams, functions, toast]);

  return (
    <div className="min-h-screen flex flex-col bg-brand-gray-50">
      <Header />
      <div className="flex flex-1 flex-col items-center justify-center px-4">
        <div className="bg-white border border-brand-gray-200 rounded-2xl p-8 shadow-lg max-w-lg text-center">
          <h1 className="text-3xl font-bold text-brand-navy mb-4">Оплата пройшла успішно!</h1>
          <p className="text-lg text-brand-gray-700 mb-6">Дякуємо за покупку. Ваше замовлення прийнято.</p>
          <Button
            className="bg-brand-navy text-white px-8 mt-6 hover:bg-brand-navy-light"
            onClick={() => navigate("/")}
          >
            Назад на головну
          </Button>
        </div>
      </div>
    </div>
  );
};

export default Success;
