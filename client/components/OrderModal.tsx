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
import { createCheckoutSession } from "@/lib/firebase";

interface OrderModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  product: { name: string; price: number };
  referralCode?: string | null;
}

type OrderFormValues = {
  name: string;
  email: string;
  phone: string;
  address: string;
};

const OrderModal: React.FC<OrderModalProps> = ({ open, onOpenChange, product, referralCode }) => {
  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<OrderFormValues>();
  const { toast } = useToast();

  const onSubmit = async (data: OrderFormValues) => {
    try {
      // ✅ NEW: Using Firebase Stripe Extension
      const result = await createCheckoutSession({
        customer_email: data.email,
        referralCode: referralCode || "",
        name: data.name,
        phone: data.phone,
        address: data.address,
      });

      localStorage.setItem("lastPurchaseEmail", data.email);

      // Функция createCheckoutSession теперь сама перенаправляет на Stripe
      // Больше не нужно вызывать stripe.redirectToCheckout

      toast({
        title: "Сесія створена",
        description: "Зараз вас перенаправить до Stripe для оплати.",
        variant: "default",
      });

    } catch (err: any) {
      console.error("Checkout error:", err);
      toast({
        title: "Помилка оплати",
        description: err.message || "Щось пішло не так.",
        variant: "destructive",
      });
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Оформлення замовлення</DialogTitle>
          <DialogDescription>Заповніть форму для оформлення замовлення та переходу до оплати</DialogDescription>
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
            <Input {...register("address", { required: "Вкажіть адресу" })} placeholder="Місто, вулиця, будинок..." />
            {errors.address && <span className="text-red-500 text-xs">{errors.address.message}</span>}
          </div>
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="outline">
                Скасувати
              </Button>
            </DialogClose>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? "Обробка..." : `Оплатити ${product.price}₴`}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};

export default OrderModal;
