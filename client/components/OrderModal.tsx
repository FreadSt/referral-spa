// web/src/components/OrderModal.tsx (версия с хуком)
import React from "react";
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
import { useReferralCode } from "@/hooks/useReferralCode";
import { initiateCheckout } from "@/lib/firebase";

interface OrderModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  product: { name: string; price: number; stripePriceId: string };
}

type OrderFormValues = {
  name: string;
  email: string;
  phone: string;
  address: string;
};

const OrderModal: React.FC<OrderModalProps> = ({ open, onOpenChange, product }) => {
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<OrderFormValues>();
  const { toast } = useToast();
  const { referralCode, isLoading: referralLoading } = useReferralCode();

  const onSubmit = async (data: OrderFormValues) => {
    try {
      const checkoutData = {
        price: product.stripePriceId,
        customer_email: data.email,
        success_url: `${window.location.origin}/success`,
        cancel_url: `${window.location.origin}/cancel`,
        line_items: [{ price: product.stripePriceId, quantity: 1 }],
        mode: "payment" as const,
        // ВАЖНО: передаем реферальный код на верхнем уровне
        referralCode: referralCode || undefined,
        metadata: {
          email: data.email,
          name: data.name,
          phone: data.phone,
          address: data.address,
          ...(referralCode && { referralCode }),
        },
      };

      console.log('🛒 Creating checkout with referral code:', referralCode || 'none');

      const sessionUrl = await initiateCheckout(checkoutData);
      localStorage.setItem("lastPurchaseEmail", data.email);

      if (referralCode) {
        localStorage.setItem("lastPurchaseReferralCode", referralCode);
      }

      window.location.href = sessionUrl;
    } catch (err: any) {
      console.error('🔥 Checkout error:', err);
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
            {!referralLoading && referralCode && (
              <div className="mt-2 p-2 bg-green-50 border border-green-200 rounded text-sm text-green-700">
                🎁 Використано реферальний код: <code className="font-mono">{referralCode}</code>
              </div>
            )}
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
          <DialogFooter>
            <Button
              type="submit"
              disabled={isSubmitting || referralLoading}
              className="w-full"
            >
              {isSubmitting ? "Обробка..." : `Оплатити $${product.price}`}
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
