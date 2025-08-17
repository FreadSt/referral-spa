
/*Index.tsx*/
export const featuredShoes = [
  {
    id: 1,
    name: "Nike Air Max 270",
    brand: "Nike",
    price: 149.99,
    originalPrice: 179.99,
    image: "/api/placeholder/400/400",
    rating: 4.8,
    reviews: 234,
    colors: ["black", "white", "red"],
    isNew: true,
    discount: 17,
  },
  {
    id: 2,
    name: "Adidas Ultraboost 22",
    brand: "Adidas",
    price: 179.99,
    image: "/api/placeholder/400/400",
    rating: 4.9,
    reviews: 156,
    colors: ["black", "gray", "blue"],
    isBestseller: true,
  },
  {
    id: 3,
    name: "Jordan Retro 1 High",
    brand: "Jordan",
    price: 169.99,
    image: "/api/placeholder/400/400",
    rating: 4.7,
    reviews: 89,
    colors: ["red", "black", "white"],
    isNew: true,
  },
  {
    id: 4,
    name: "Vans Old Skool",
    brand: "Vans",
    price: 89.99,
    image: "/api/placeholder/400/400",
    rating: 4.6,
    reviews: 312,
    colors: ["black", "white", "navy"],
    discount: 20,
    originalPrice: 112.49,
  },
];

export const categories = [
  { name: "Running", image: "/api/placeholder/300/200", count: 120 },
  { name: "Basketball", image: "/api/placeholder/300/200", count: 89 },
  { name: "Lifestyle", image: "/api/placeholder/300/200", count: 156 },
  { name: "Training", image: "/api/placeholder/300/200", count: 78 },
];

export const brands = [
  { name: "Nike", logo: "/api/placeholder/120/60" },
  { name: "Adidas", logo: "/api/placeholder/120/60" },
  { name: "Jordan", logo: "/api/placeholder/120/60" },
  { name: "Puma", logo: "/api/placeholder/120/60" },
  { name: "Converse", logo: "/api/placeholder/120/60" },
  { name: "Vans", logo: "/api/placeholder/120/60" },
];
