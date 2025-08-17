import { Button } from "@/components/ui/button";
import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { TooltipProvider, Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";

interface HeaderProps {
  onLogoClick?: () => void;
}

const activationDelay = 10 * 1000; // 10 seconds for testing

const Header: React.FC<HeaderProps> = ({ onLogoClick }) => {
  const navigate = useNavigate();
  const handleLogo = () => {
    if (onLogoClick) {
      onLogoClick();
    } else {
      navigate("/");
    }
  };

  const [referralLink, setReferralLink] = useState("");
  const [copied, setCopied] = useState(false);
  const [isActive, setIsActive] = useState(false);

  useEffect(() => {
    // Try to get referral code from localStorage or URL
    const params = new URLSearchParams(window.location.search);
    const code = params.get("ref") || localStorage.getItem("referralCode");
    if (code) {
      setReferralLink(`${window.location.origin}/product?ref=${code}`);
      setIsActive(true); // Always active for demo, or add activation logic if needed
    }
  }, []);

  const handleCopy = () => {
    if (referralLink) {
      navigator.clipboard.writeText(referralLink);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }
  };

  return (
    <nav className="bg-white border-b border-gray-100 sticky top-0 z-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between items-center h-16">
          {/* Logo */}
          <div className="flex items-center">
            <span
              className="text-2xl font-bold text-brand-navy cursor-pointer"
              onClick={handleLogo}
            >
              SolePeak
            </span>
          </div>

          {/* Right Icons */}
          <div className="flex items-center space-x-4">
            {isActive && referralLink && (
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button size="sm" variant="outline" className="border-brand-orange text-brand-orange hover:bg-brand-orange hover:text-white" onClick={handleCopy}>
                      {copied ? "Скопійовано!" : "Реферальне посилання"}
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>
                    <span className="break-all">{referralLink}</span>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            )}
          </div>
        </div>
      </div>
    </nav>
  );
};

export default Header;
