import React, { useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogClose,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useForm } from "react-hook-form";
import { useToast } from "@/hooks/use-toast";
import { startCheckout } from "@/lib/firebase"; // Импортируем startCheckout вместо initiateCheckout
import { getFunctions, httpsCallable } from "firebase/functions";
import { getAuth, signInAnonymously } from "firebase/auth";

interface OrderModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  product: { name: string; price: number; stripePriceId: string };
  referralCode?: string | null;
}

type OrderFormValues = {
  name: string;
  email: string;
  phone: string;
  address: string;
  bankIban: string;
  bankHolderName: string;
  bankBic?: string;
};

const OrderModal: React.FC<OrderModalProps> = ({ open, onOpenChange, product, referralCode }) => {
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<OrderFormValues>();
  const { toast } = useToast();

  const functions = getFunctions();
  const createBankDetailsOnboarding = httpsCallable(functions, "createBankDetailsOnboarding");

  useEffect(() => {
    signInAnonymously(getAuth()).catch((e) => {
      console.warn("Anonymous auth failed:", e);
    });
  }, []);

  const onSubmit = async (data: OrderFormValues) => {
    try {
      // Save bank details first
      try {
        await createBankDetailsOnboarding({
          email: data.email,
          iban: data.bankIban,
          bic: data.bankBic || "",
          name: data.bankHolderName,
        });
      } catch (err: any) {
        console.warn("Failed to save bank details:", err);
        toast({
          title: "Попередження",
          description: "Не вдалося зберегти банківські дані, але оплата продовжується.",
          variant: "default",
        });
      }

      const checkoutData = {
        price: product.price, // UAH number
        success_url: `${window.location.origin}/success`,
        metadata: {
          email: data.email,
          name: data.name,
          phone: data.phone,
          address: data.address,
          bankIban: data.bankIban,
          bankBic: data.bankBic || "",
          bankHolderName: data.bankHolderName,
          referralCode: referralCode || "",
        },
      };

      await startCheckout(checkoutData); // Используем startCheckout, который обрабатывает форму и submit автоматически
    } catch (err: any) {
      toast({
        title: "Помилка оплати",
        description: err?.message || "Щось пішло не так.",
        variant: "destructive",
      });
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Оформлення замовлення</DialogTitle>
          <DialogDescription>
            Заповніть форму для оформлення замовлення та переходу до оплати
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <div>
            <label className="block mb-1 font-medium">Ім'я</label>
            <Input {...register("name", { required: "Вкажіть ім'я" })} placeholder="Ваше ім'я" />
            {errors.name && <span className="text-red-500 text-xs">{errors.name.message}</span>}
          </div>
          <div>
            <label className="block mb-1 font-medium">Email</label>
            <Input type="email" {...register("email", { required: "Вкажіть email" })} placeholder="example@email.com" />
            {errors.email && <span className="text-red-500 text-xs">{errors.email.message}</span>}
          </div>
          <div>
            <label className="block mb-1 font-medium">Телефон</label>
            <Input {...register("phone", { required: "Вкажіть телефон" })} placeholder="+380..." />
            {errors.phone && <span className="text-red-500 text-xs">{errors.phone.message}</span>}
          </div>
          <div>
            <label className="block mb-1 font-medium">Адреса доставки</label>
            <Input
              {...register("address", { required: "Вкажіть адресу" })}
              placeholder="Місто, вулиця, будинок..."
            />
            {errors.address && <span className="text-red-500 text-xs">{errors.address.message}</span>}
          </div>
          <div>
            <label className="block mb-1 font-medium">IBAN для виплат</label>
            <Input {...register("bankIban", { required: "Вкажіть IBAN" })} placeholder="UA..." />
            {errors.bankIban && <span className="text-red-500 text-xs">{errors.bankIban.message}</span>}
          </div>
          <div>
            <label className="block mb-1 font-medium">Ім'я власника рахунку</label>
            <Input {...register("bankHolderName", { required: "Вкажіть ім'я власника рахунку" })} placeholder="Іван Іванов" />
            {errors.bankHolderName && <span className="text-red-500 text-xs">{errors.bankHolderName.message}</span>}
          </div>
          <div>
            <label className="block mb-1 font-medium">BIC (опціонально)</label>
            <Input {...register("bankBic")} placeholder="BIC код банку..." />
          </div>
          <DialogFooter>
            <Button type="submit" disabled={isSubmitting} className="w-full">
              {isSubmitting ? "Обробка..." : `Оплатити ${product.price} UAH`} {/* Исправил на UAH, раз LiqPay */}
            </Button>
            <DialogClose asChild>
              <Button type="button" variant="outline" className="w-full">
                Скасувати
              </Button>
            </DialogClose>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};

export default OrderModal;
