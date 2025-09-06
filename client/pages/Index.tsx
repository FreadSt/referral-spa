import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  Star,
  User,
  ChevronRight,
  Facebook,
  Instagram,
  Twitter,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import img1 from "../assets/images/image1.JPG";
import Header from "@/components/Header";
import Footer from "@/components/Footer";


export default function Index() {
  const navigate = useNavigate();

  const handleNav = () => {
    navigate('/product')
  }
  const handleLogoClick = () => navigate("/");

  return (
    <div className="min-h-screen bg-white justify-between flex flex-col">
      {/* Navigation */}
      <Header onLogoClick={handleLogoClick} />

      <section className="relative">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-9 lg:py-12">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 items-center">
            <div>
              <Badge
                variant="secondary"
                className="mb-4 bg-brand-orange/10 text-brand-orange border-brand-orange/20"
              >
                New Collection
              </Badge>
              <h1 className="text-4xl lg:text-6xl font-bold text-brand-navy mb-6 leading-tight break-words flex flex-col">
                <span>Покажи всім</span>
                <span className="text-brand-orange">Найкращого себе</span>
              </h1>
              <p className="text-lg text-gray-600 mb-8 max-w-lg">
                Відкрийте для себе найновішу колекцію преміального взуття від провідного бренду.
                Знайдіть ідеальний розмыр та підкресліть свій стиль.
              </p>
              <div className="flex flex-col sm:flex-row gap-4">
                <Button
                  size="lg"
                  className="bg-brand-orange hover:bg-brand-orange-dark text-white px-8"
                  onClick={handleNav}
                >
                  Придбати
                  <ChevronRight className="ml-2 h-4 w-4" />
                </Button>
                {/*<Button*/}
                {/*  variant="outline"*/}
                {/*  size="lg"*/}
                {/*  className="border-brand-navy text-brand-navy hover:bg-brand-navy hover:text-white"*/}
                {/*>*/}
                {/*  Вся коллекція*/}
                {/*</Button>*/}
              </div>
            </div>
            <div className="relative">
              <div className="flex items-center justify-center cursor-pointer" onClick={handleNav}>
                <img
                  src={img1 as string}
                  alt="Featured Shoe"
                  className="object-cover rounded-2xl lg:max-h-[32rem]"
                />
              </div>
              <div className="absolute bottom-4 left-4 bg-brand-orange text-white rounded-lg p-3 shadow-lg">
                <div className="text-sm font-medium">30% Знижка</div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Footer */}
      <Footer />
    </div>
  );
}
