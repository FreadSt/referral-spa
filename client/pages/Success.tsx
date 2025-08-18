import React, { useEffect, useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { Button } from "@/components/ui/button";
import Header from "@/components/Header";
import { getFunctions, httpsCallable } from "firebase/functions";
import { doc, getDoc, setDoc } from "firebase/firestore";
import { db } from "@/lib/firebase.ts";

const activationDelay = 10 * 1000; // 10 сек для теста

const Success: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const functions = getFunctions();

  const [referralData, setReferralData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const confirmPayment = async () => {
      const sessionId = new URLSearchParams(location.search).get("session_id");
      if (sessionId) {
        const email = localStorage.getItem("lastPurchaseEmail");
        if (email) {
          const orderDoc = await getDoc(doc(db, "orders", email));
          if (orderDoc.exists()) {
            const orderData = orderDoc.data();
            const createShipment = httpsCallable(functions, "createNovaPoshtaShipment");
            await createShipment({
              email,
              name: orderData.name,
              phone: orderData.phone,
              address: orderData.address,
            });
            await setDoc(doc(db, "orders", email), { status: "shipped" }, { merge: true });
          }
        }
      }
    };
    confirmPayment();
  }, [location, functions]);

  useEffect(() => {
    const fetchReferral = async () => {
      const email = localStorage.getItem("lastPurchaseEmail");
      if (!email) {
        setLoading(false);
        return;
      }
      try {
        const res = await fetch(`/api/referral/${encodeURIComponent(email)}`);
        if (res.ok) {
          const data = await res.json();
          setReferralData(data);
        }
      } finally {
        setLoading(false);
      }
    };
    fetchReferral();
  }, []);

  const isActive = referralData && (Date.now() - referralData.purchaseTimestamp >= activationDelay);
  const referralLink = referralData ? `${window.location.origin}/product?ref=${referralData.referralCode}` : "";

  const handleCopy = () => {
    if (referralLink) {
      navigator.clipboard.writeText(referralLink);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }
  };

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
