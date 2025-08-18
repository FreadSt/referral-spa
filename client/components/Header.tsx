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
        </div>
      </div>
    </nav>
  );
};

export default Header;
