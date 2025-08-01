import React from "react";
import { useForm } from "react-hook-form";
import { useToast } from "@/hooks/use-toast";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { db } from "@/lib/firebase";
import { doc, setDoc, getDoc } from "firebase/firestore";

type TTNFormValues = {
  email: string;
  ttn: string;
};

const BindTTN: React.FC = () => {
  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<TTNFormValues>();
  const { toast } = useToast();

  const onSubmit = async (data: TTNFormValues) => {
    try {
      // Check if order exists
      const orderQuery = await getDoc(doc(db, "orders", data.email));
      if (!orderQuery.exists()) {
        throw new Error("Order not found for this email");
      }

      // Save TTN
      await setDoc(doc(db, "ttns", data.ttn), {
        email: data.email,
        ttn: data.ttn,
        createdAt: new Date(),
        status: "pending",
      });

      toast({ title: "Успіх", description: "TTN успішно прив'язано" });
    } catch (err: any) {
      console.error("Error in onSubmit:", err);
      toast({ title: "Помилка", description: err.message, variant: "destructive" });
    }
  };

  return (
    <div className="max-w-md mx-auto mt-10">
      <h1 className="text-2xl font-bold mb-4">Прив'язати TTN</h1>
      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
        <div>
          <label className="block mb-1 font-medium">Email</label>
          <Input
            type="email"
            {...register("email", { required: "Вкажіть email" })}
            placeholder="example@email.com"
          />
          {errors.email && <span className="text-red-500 text-xs">{errors.email.message}</span>}
        </div>
        <div>
          <label className="block mb-1 font-medium">Номер TTN</label>
          <Input
            {...register("ttn", { required: "Вкажіть TTN" })}
            placeholder="Введіть номер TTN"
            type="text"
          />
          {errors.ttn && <span className="text-red-500 text-xs">{errors.ttn.message}</span>}
        </div>
        <Button type="submit" disabled={isSubmitting} className="w-full">
          {isSubmitting ? "Обробка..." : "Прив'язати"}
        </Button>
      </form>
    </div>
  );
};

export default BindTTN;
