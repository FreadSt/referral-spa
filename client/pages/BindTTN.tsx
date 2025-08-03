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
      const orderQuery = await getDoc(doc(db, "orders", data.email));
      if (!orderQuery.exists()) {
        throw new Error("Замовлення з таким email не знайдено");
      }

      await setDoc(doc(db, "ttns", data.ttn), {
        email: data.email,
        ttn: data.ttn,
        createdAt: new Date(),
        status: "pending",
      });

      toast({ title: "✅ Успіх", description: "TTN успішно прив'язано" });
    } catch (err: any) {
      console.error("Error in onSubmit:", err);
      toast({ title: "❌ Помилка", description: err.message, variant: "destructive" });
    }
  };

  return (
    <div className="px-4 py-8 sm:px-6 lg:px-8 flex justify-center">
      <div className="w-full max-w-md bg-white rounded-2xl shadow-lg p-6 sm:p-8 border border-gray-200">
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
    </div>
  );
};

export default BindTTN;
