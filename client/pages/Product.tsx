import { useState } from "react";
import {
  Plus,
  Minus,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import Header from "@/components/Header";
import img1 from "../assets/images/image1.JPG"
import img2 from "../assets/images/image2.JPG"
import img3 from "../assets/images/image3.JPG"
import img4 from "../assets/images/image4.JPG"
import img5 from "../assets/images/image5.JPG"
import OrderModal from "@/components/OrderModal";
import { useEffect } from "react";

const product = {
  id: 1,
  name: "Nike Air Max 270",
  brand: "Nike",
  price: 5,
  originalPrice: 7,
  discount: 17,
  rating: 4.8,
  reviews: 234,
  description:
    "The Nike Air Max 270 delivers unrivaled all-day comfort with a sleek, running-inspired design. An Air Max unit in the heel provides lightweight cushioning, while the breathable mesh upper keeps your feet cool and comfortable.",
  features: [
    "Max Air unit in the heel for lightweight cushioning",
    "Breathable mesh upper for enhanced airflow",
    "Foam midsole for responsive cushioning",
    "Rubber outsole with waffle pattern for traction",
    "Pull tab for easy on and off",
  ],
  images: [
    img1,
    img2,
    img3,
    img4,
  ],
  colors: [
    { name: "Black/White", value: "black", image: "/api/placeholder/600/600" },
    { name: "White/Blue", value: "white", image: "/api/placeholder/600/600" },
    { name: "Red/Black", value: "red", image: "/api/placeholder/600/600" },
  ],
  sizes: [
    { value: "7", available: true },
    { value: "7.5", available: true },
    { value: "8", available: true },
    { value: "8.5", available: false },
    { value: "9", available: true },
    { value: "9.5", available: true },
    { value: "10", available: true },
    { value: "10.5", available: true },
    { value: "11", available: true },
    { value: "11.5", available: false },
    { value: "12", available: true },
  ],
  inStock: true,
  stockCount: 47,
};

export default function Product() {
  const [selectedImage, setSelectedImage] = useState(0);
  const [selectedColor, setSelectedColor] = useState(product.colors[0]);
  const [selectedSize, setSelectedSize] = useState("");
  const [quantity, setQuantity] = useState(1);
  const [orderModalOpen, setOrderModalOpen] = useState(false);
  const [showLoginPrompt, setShowLoginPrompt] = useState(false);
  const [referralCode, setReferralCode] = useState<string | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const code = params.get("ref") || localStorage.getItem("referralCode");
    setReferralCode(code);
  }, []);

  const handleBuyNow = () => {
    if (!selectedSize) {
      alert("Please select a size");
      return;
    }
    setOrderModalOpen(true);
  };

  return (
    <div className="min-h-screen bg-white">
      {/* Navigation */}
      <Header />

      {/* Product Detail */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-12">
          {/* Images */}
          <div className="space-y-4">
            {/* Main Image */}
            <div className="aspect-square bg-gray-100 rounded-2xl overflow-hidden">
              <img
                src={img5 as string}
                alt={product.name}
                className="w-full h-full object-contain"
              />
            </div>

            {/* Thumbnail Images */}
            <div className="grid grid-cols-4 gap-4">
              {product.images.map((image, index) => (
                <button
                  key={index}
                  onClick={() => setSelectedImage(index)}
                  className={`aspect-square bg-gray-100 rounded-lg overflow-hidden border-2 transition-colors ${
                    selectedImage === index
                      ? "border-brand-orange"
                      : "border-transparent"
                  }`}
                >
                  <img
                    src={image as string}
                    alt={`${product.name} ${index + 1}`}
                    className="w-full h-full object-contain"
                  />
                </button>
              ))}
            </div>
          </div>

          {/* Product Info */}
          <div className="space-y-6">
            {/* Header */}
            <div>
              <p className="text-sm text-gray-500 mb-1">{product.brand}</p>
              <h1 className="text-4xl font-bold text-brand-navy mb-4">
                {product.name}
              </h1>

              {/* Price */}
              <div className="flex items-center gap-3 mb-6">
                <span className="text-3xl font-bold text-brand-navy">
                  ${product.price}
                </span>
                {product.originalPrice && (
                  <span className="text-lg text-gray-500 line-through">
                    ${product.originalPrice}
                  </span>
                )}
              </div>
            </div>

            {/* Color Selection */}
            {/*<div>*/}
            {/*  <h3 className="text-lg font-semibold text-brand-navy mb-3">*/}
            {/*    Color: {selectedColor.name}*/}
            {/*  </h3>*/}
            {/*  <div className="flex gap-3">*/}
            {/*    {product.colors.map((color, index) => (*/}
            {/*      <button*/}
            {/*        key={index}*/}
            {/*        onClick={() => setSelectedColor(color)}*/}
            {/*        className={`w-12 h-12 rounded-lg border-2 transition-colors overflow-hidden ${*/}
            {/*          selectedColor.value === color.value*/}
            {/*            ? "border-brand-orange"*/}
            {/*            : "border-gray-200"*/}
            {/*        }`}*/}
            {/*      >*/}
            {/*        <img*/}
            {/*          src={color.image}*/}
            {/*          alt={color.name}*/}
            {/*          className="w-full h-full object-cover"*/}
            {/*        />*/}
            {/*      </button>*/}
            {/*    ))}*/}
            {/*  </div>*/}
            {/*</div>*/}

            {/* Size Selection */}
            <div>
              <h3 className="text-lg font-semibold text-brand-navy mb-3">
                Size
              </h3>
              <div className="grid grid-cols-6 gap-2">
                {product.sizes.map((size) => (
                  <button
                    key={size.value}
                    onClick={() =>
                      size.available && setSelectedSize(size.value)
                    }
                    disabled={!size.available}
                    className={`py-3 px-4 text-center border rounded-lg transition-colors ${
                      selectedSize === size.value
                        ? "border-brand-orange bg-brand-orange text-white"
                        : size.available
                          ? "border-gray-200 hover:border-brand-orange"
                          : "border-gray-200 bg-gray-100 text-gray-400 cursor-not-allowed"
                    }`}
                  >
                    {size.value}
                  </button>
                ))}
              </div>
            </div>

            {/* Quantity */}
            <div>
              <h3 className="text-lg font-semibold text-brand-navy mb-3">
                Quantity
              </h3>
              <div className="flex items-center border border-gray-200 rounded-lg w-fit">
                <button
                  onClick={() => setQuantity(Math.max(1, quantity - 1))}
                  className="p-3 hover:bg-gray-50 transition-colors"
                >
                  <Minus className="h-4 w-4" />
                </button>
                <span className="px-4 py-3 font-medium">{quantity}</span>
                <button
                  onClick={() => setQuantity(quantity + 1)}
                  className="p-3 hover:bg-gray-50 transition-colors"
                >
                  <Plus className="h-4 w-4" />
                </button>
              </div>
            </div>

            <div className="space-y-4">
              <Button
                size="lg"
                className="bg-brand-orange hover:bg-brand-orange-dark text-white px-8"
                onClick={handleBuyNow}
              >
                Купити
              </Button>
            </div>
          </div>
        </div>
      </div>
      <OrderModal
        open={orderModalOpen}
        onOpenChange={setOrderModalOpen}
        product={{ name: product.name, price: product.price }}
        referralCode={referralCode}
      />
      {showLoginPrompt && (
        <div className="fixed inset-0 flex items-center justify-center bg-black bg-opacity-40 z-50">
          <div className="bg-white p-8 rounded shadow-lg text-center">
            <h2 className="text-xl font-bold mb-4">Щоб скористатися реферальною програмою, увійдіть або зареєструйтеся</h2>
            <Button className="bg-brand-orange text-white px-8" onClick={() => window.location.href = "/login"}>Увійти</Button>
            <Button variant="outline" className="ml-4" onClick={() => window.location.href = "/signup"}>Зареєструватися</Button>
            <Button variant="ghost" className="block mt-4 mx-auto" onClick={() => setShowLoginPrompt(false)}>Скасувати</Button>
          </div>
        </div>
      )}
    </div>
  );
}
