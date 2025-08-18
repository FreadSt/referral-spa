// src/main.tsx
import "./global.css";

import { Toaster } from "@/components/ui/toaster";
import { createRoot } from "react-dom/client";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import Index from "./pages/Index";
import Product from "./pages/Product";
import NotFound from "./pages/NotFound";
import BindTTN from "@/pages/BindTTN.tsx";
import Success from "@/pages/Success.tsx";
import { useReferralCode } from '@/hooks/useReferralCode';

const queryClient = new QueryClient();

const App = () => {
  const { referralCode, isLoading } = useReferralCode(); // Теперь хук внутри BrowserRouter — работает

  return (
    <TooltipProvider>
      <Toaster />
      <Routes>
        <Route path="/" element={<Index />} />
        <Route path="/product" element={<Product />} />
        <Route path="/bind-ttn" element={<BindTTN />} />
        <Route path="*" element={<NotFound />} />
        <Route path="/success" element={<Success />} />
      </Routes>
    </TooltipProvider>
  );
};

createRoot(document.getElementById("root")!).render(
  <QueryClientProvider client={queryClient}>
    <BrowserRouter> {/* Роутер теперь снаружи App */}
      <App />
    </BrowserRouter>
  </QueryClientProvider>
);
