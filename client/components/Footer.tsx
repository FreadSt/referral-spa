// src/components/Footer.tsx
import { Link } from "react-router-dom";
import { Instagram } from "lucide-react";

export default function Footer() {
  return (
    <footer className="bg-brand-gray-900 text-white py-9">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
          <div>
            <h3 className="text-xl font-bold mb-4 text-brand-orange">
              SolePeak
            </h3>
            <p className="text-brand-gray-400 mb-4">
              Ваше найкраще місце для придбання преміального взуття від провідних світових брендів.
            </p>
            <div className="flex items-center space-x-2">
              <a
                href="https://www.instagram.com/schaslyvi_pokupki/?igsh=MXczNjZwYWZ0NXVldQ%3D%3D#"
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center text-brand-gray-400 hover:text-brand-orange transition-colors"
              >
                <Instagram className="h-5 w-5 mr-1" />
                <span>Instagram</span>
              </a>
            </div>
          </div>

          <div>
            <h4 className="font-semibold mb-4">Підтримка</h4>
            <ul className="space-y-2 text-brand-gray-400">
              <li>
                {/* Popup будет обработан отдельно */}
                <button
                  onClick={() =>
                    alert("Телефон: +380 (67) 123-45-67\nEmail: la_rose_@ukr.net")
                  }
                  className="hover:text-white transition-colors"
                >
                  Звʼяжіться з нами
                </button>
              </li>
              <li>
                <Link
                  to="/shipping-returns"
                  className="hover:text-white transition-colors"
                >
                  Доставка та Повернення
                </Link>
              </li>
            </ul>
          </div>

          <div>
            <h4 className="font-semibold mb-4">Компанія</h4>
            <ul className="space-y-2 text-brand-gray-400">
              <li>
                <Link
                  to="/about"
                  className="hover:text-white transition-colors"
                >
                  Про нас
                </Link>
              </li>
              <li>
                <Link
                  to="/privacy"
                  className="hover:text-white transition-colors"
                >
                  Політика конфіденційності
                </Link>
              </li>
              <li>
                <Link
                  to="/terms"
                  className="hover:text-white transition-colors"
                >
                  Правила користування
                </Link>
              </li>
              <li>
                <Link
                  to="/offer"
                  className="hover:text-white transition-colors"
                >
                  Договір оферти
                </Link>
              </li>
            </ul>
          </div>
        </div>

        <div className="border-t border-brand-gray-700 mt-8 pt-8 text-center text-brand-gray-400">
          <p>&copy; 2025 SolePeak. All парава захищені.</p>
        </div>
      </div>
    </footer>
  );
}
