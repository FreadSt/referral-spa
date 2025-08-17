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
import { initiateCheckout } from "@/lib/firebase";

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
};

const OrderModal: React.FC<OrderModalProps> = ({ open, onOpenChange, product, referralCode }) => {
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<OrderFormValues>();
  const { toast } = useToast();

  const onSubmit = async (data: OrderFormValues) => {
    try {
      const checkoutData = {
        price: product.stripePriceId,
        customer_email: data.email, // важно для Customer
        success_url: `${window.location.origin}/success`,
        cancel_url: `${window.location.origin}/cancel`,
        line_items: [{ price: product.stripePriceId, quantity: 1 }],
        mode: "payment",
        // Дублируем email в metadata → гарантированно заберём его на сервере
        metadata: {
          email: data.email,
          name: data.name,
          phone: data.phone,
          address: data.address,
          referralCode: referralCode || "",
        },
      };

      const sessionUrl = await initiateCheckout(checkoutData);
      localStorage.setItem("lastPurchaseEmail", data.email);
      window.location.href = sessionUrl;
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
          <DialogFooter>
            <Button type="submit" disabled={isSubmitting} className="w-full">
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
