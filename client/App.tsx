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
import ShippingReturns from "@/pages/ShippingReturns.tsx";
import About from "@/pages/About.tsx";
import Terms from "@/pages/Terms.tsx";
import Privacy from "@/pages/Privacy.tsx";
import Offer from "@/pages/Offer.tsx";

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
        <Route path="/shipping-returns" element={<ShippingReturns />} />
        <Route path="/about" element={<About />} />
        <Route path="/terms" element={<Terms />} />
        <Route path="/privacy" element={<Privacy />} />
        <Route path="/offer" element={<Offer />} />
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
