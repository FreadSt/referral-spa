// web/src/components/OrderModal.tsx
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
  product: { name: string; price: number; currency?: string };
}

type OrderFormValues = {
  name: string;
  email: string;
  phone: string;
  address: string;
  cashback_card?: string;
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
        customer_email: data.email,
        success_url: `${window.location.origin}/success`,
        cancel_url: `${window.location.origin}/cancel`,
        line_items: [
          {
            price_data: {
              currency: product.currency?.toLowerCase() || "uah",
              unit_amount: product.price * 1000,
              product_data: { name: product.name },
            },
            quantity: 1,
          },
        ],
        mode: "payment" as const,
        referralCode: referralCode || undefined,
        metadata: {
          email: data.email,
          name: data.name,
          phone: data.phone,
          address: data.address,
          cashback_card: data.cashback_card || undefined,
          ...(referralCode && { referralCode }),
        },
      };

      console.log('🛒 Creating checkout with referral code:', referralCode || 'none');

      const { liqpayData, signature, liqpay_url } = await initiateCheckout(checkoutData);
      localStorage.setItem("lastPurchaseEmail", data.email);

      if (referralCode) {
        localStorage.setItem("lastPurchaseReferralCode", referralCode);
      }

      // Создаем форму динамически
      const form = document.createElement('form');
      form.method = 'POST';
      form.action = liqpay_url;

      // Добавляем скрытое поле data
      const dataInput = document.createElement('input');
      dataInput.type = 'hidden';
      dataInput.name = 'data';
      dataInput.value = liqpayData;
      form.appendChild(dataInput);

      // Добавляем скрытое поле signature
      const signatureInput = document.createElement('input');
      signatureInput.type = 'hidden';
      signatureInput.name = 'signature';
      signatureInput.value = signature;
      form.appendChild(signatureInput);

      // Добавляем форму в body и отправляем
      document.body.appendChild(form);
      form.submit();

      // Опционально: удаляем форму после отправки
      document.body.removeChild(form);
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
          <div>
            <label className="block mb-1 font-medium">Номер карти для кешбеку (опціонально)</label>
            <Input
              {...register("cashback_card", {
                pattern: { value: /^\d{16}$/, message: "Повинно бути 16 цифр" },
              })}
              placeholder="1234567890123456"
            />
            {errors.cashback_card && <span className="text-red-500 text-xs">{errors.cashback_card.message}</span>}
          </div>
          <DialogFooter>
            <Button
              type="submit"
              disabled={isSubmitting || referralLoading}
              className="w-full"
            >
              {isSubmitting ? "Обробка..." : `Оплатити ${product.price} ₴`}
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
