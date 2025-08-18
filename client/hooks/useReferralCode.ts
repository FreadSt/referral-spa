import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';

interface ReferralCodeHook {
  referralCode: string | null;
  isLoading: boolean;
  saveReferralCode: (code: string) => void;
  clearReferralCode: () => void;
}

export const useReferralCode = (): ReferralCodeHook => {
  const [referralCode, setReferralCode] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [searchParams, setSearchParams] = useSearchParams(); // Используйте setSearchParams для очистки

  const getReferralCode = (): string | null => {
    try {
      const code = localStorage.getItem('referralCode');
      const expiry = localStorage.getItem('referralCodeExpiry');

      if (code && expiry) {
        const expiryTime = parseInt(expiry);
        if (Date.now() < expiryTime) {
          return code;
        } else {
          localStorage.removeItem('referralCode');
          localStorage.removeItem('referralCodeExpiry');
        }
      }

      return null;
    } catch (error) {
      console.error('Error getting referral code:', error);
      return null;
    }
  };

  const saveReferralCode = (code: string): void => {
    try {
      localStorage.setItem('referralCode', code);
      const expiryTime = Date.now() + (30 * 24 * 60 * 60 * 1000); // 30 дней
      localStorage.setItem('referralCodeExpiry', expiryTime.toString());
      setReferralCode(code);
      console.log('🔗 Referral code saved:', code);
    } catch (error) {
      console.error('Error saving referral code:', error);
    }
  };

  const clearReferralCode = (): void => {
    try {
      localStorage.removeItem('referralCode');
      localStorage.removeItem('referralCodeExpiry');
      setReferralCode(null);
    } catch (error) {
      console.error('Error clearing referral code:', error);
    }
  };

  useEffect(() => {
    setIsLoading(true);

    // Проверяем URL параметры
    const urlReferralCode = searchParams.get('ref') || searchParams.get('code');

    if (urlReferralCode) {
      saveReferralCode(urlReferralCode);

      // Очищаем URL от реферального кода (используем setSearchParams для React Router)
      setSearchParams((params) => {
        params.delete('ref');
        params.delete('code');
        return params;
      }, { replace: true }); // replace: true — чтобы не добавлять в историю
    } else {
      // Получаем сохраненный код
      const savedCode = getReferralCode();
      setReferralCode(savedCode);
    }

    setIsLoading(false);
  }, [searchParams, setSearchParams]); // Зависимость от searchParams — реагирует на изменения URL

  return {
    referralCode,
    isLoading,
    saveReferralCode,
    clearReferralCode,
  };
};
