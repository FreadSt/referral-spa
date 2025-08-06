// frontend-example.js - Пример работы с Firebase Stripe Payments Extension

import { initializeApp } from 'firebase/app';
import { getAuth, onAuthStateChanged } from 'firebase/auth';
import { 
  getFirestore, 
  collection, 
  doc, 
  addDoc, 
  onSnapshot, 
  query, 
  where, 
  getDocs 
} from 'firebase/firestore';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { useState, useEffect } from 'react';

// Firebase config (замените на ваши данные)
const firebaseConfig = {
  // ваша конфигурация
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const functions = getFunctions(app);

// 🛒 1. СОЗДАНИЕ CHECKOUT СЕССИИ
export const createCheckoutSession = async (priceId, orderData) => {
  const user = auth.currentUser;
  if (!user) throw new Error('User not authenticated');

  // Сначала сохраняем заказ в нашу коллекцию
  await doc(db, 'orders', user.email).set({
    ...orderData,
    userId: user.uid,
    createdAt: new Date(),
    status: 'pending'
  });

  // Создаем checkout сессию через расширение
  const checkoutSessionRef = await addDoc(
    collection(db, `customers/${user.uid}/checkout_sessions`),
    {
      price: priceId, // например: 'price_1RnK1iQbiHOSieT9wsaQ8nOK'
      success_url: window.location.origin + '/success',
      cancel_url: window.location.origin + '/cancel',
      mode: 'payment', // или 'subscription' для подписок
      // Дополнительные параметры
      allow_promotion_codes: true,
      metadata: {
        orderId: user.email,
        customData: 'any custom data'
      }
    }
  );

  // Слушаем когда расширение создаст URL для оплаты
  return new Promise((resolve, reject) => {
    const unsubscribe = onSnapshot(checkoutSessionRef, (snap) => {
      const data = snap.data();
      if (data?.error) {
        unsubscribe();
        reject(new Error(data.error.message));
      }
      if (data?.url) {
        unsubscribe();
        resolve(data.url);
      }
    });
  });
};

// 🛒 2. СОЗДАНИЕ ПОДПИСКИ
export const createSubscription = async (priceId) => {
  const user = auth.currentUser;
  if (!user) throw new Error('User not authenticated');

  const checkoutSessionRef = await addDoc(
    collection(db, `customers/${user.uid}/checkout_sessions`),
    {
      price: priceId,
      success_url: window.location.origin + '/subscription-success',
      cancel_url: window.location.origin + '/pricing',
      mode: 'subscription',
      trial_period_days: 7, // опционально
    }
  );

  return new Promise((resolve, reject) => {
    const unsubscribe = onSnapshot(checkoutSessionRef, (snap) => {
      const data = snap.data();
      if (data?.error) {
        unsubscribe();
        reject(new Error(data.error.message));
      }
      if (data?.url) {
        unsubscribe();
        resolve(data.url);
      }
    });
  });
};

// 📦 3. ПОЛУЧЕНИЕ ПРОДУКТОВ И ЦЕН
export const getProducts = async () => {
  const productsQuery = query(
    collection(db, 'products'),
    where('active', '==', true)
  );
  
  const querySnapshot = await getDocs(productsQuery);
  
  const products = await Promise.all(
    querySnapshot.docs.map(async (productDoc) => {
      const productData = productDoc.data();
      
      // Получаем цены для каждого продукта
      const pricesSnapshot = await getDocs(
        collection(productDoc.ref, 'prices')
      );
      
      const prices = pricesSnapshot.docs.map(priceDoc => ({
        id: priceDoc.id,
        ...priceDoc.data()
      }));
      
      return {
        id: productDoc.id,
        ...productData,
        prices
      };
    })
  );
  
  return products;
};

// 👤 4. ПОЛУЧЕНИЕ АКТИВНЫХ ПОДПИСОК ПОЛЬЗОВАТЕЛЯ
export const getUserSubscriptions = async () => {
  const user = auth.currentUser;
  if (!user) return [];

  const subscriptionsQuery = query(
    collection(db, `customers/${user.uid}/subscriptions`),
    where('status', 'in', ['trialing', 'active'])
  );
  
  const querySnapshot = await getDocs(subscriptionsQuery);
  return querySnapshot.docs.map(doc => ({
    id: doc.id,
    ...doc.data()
  }));
};

// 💳 5. ПОЛУЧЕНИЕ ИСТОРИИ ПЛАТЕЖЕЙ
export const getPaymentHistory = async () => {
  const user = auth.currentUser;
  if (!user) return [];

  const paymentsSnapshot = await getDocs(
    collection(db, `customers/${user.uid}/payments`)
  );
  
  return paymentsSnapshot.docs.map(doc => ({
    id: doc.id,
    ...doc.data()
  }));
};

// 🏢 6. СОЗДАНИЕ CUSTOMER PORTAL (для управления подписками)
export const createCustomerPortal = async () => {
  const user = auth.currentUser;
  if (!user) throw new Error('User not authenticated');

  const createPortalLink = httpsCallable(
    functions,
    'ext-firestore-stripe-payments-createPortalLink'
  );

  try {
    const result = await createPortalLink({
      returnUrl: window.location.origin
    });
    
    return result.data.url;
  } catch (error) {
    console.error('Error creating portal link:', error);
    throw error;
  }
};

// 🔄 7. ПРОВЕРКА СТАТУСА ПОДПИСКИ В РЕАЛЬНОМ ВРЕМЕНИ
export const subscribeToUserSubscriptions = (callback) => {
  const user = auth.currentUser;
  if (!user) return () => {};

  return onSnapshot(
    collection(db, `customers/${user.uid}/subscriptions`),
    (snapshot) => {
      const subscriptions = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));
      callback(subscriptions);
    }
  );
};

// 📱 8. ПРИМЕР ИСПОЛЬЗОВАНИЯ В REACT КОМПОНЕНТЕ
export const PaymentComponent = () => {
  const [products, setProducts] = useState([]);
  const [subscriptions, setSubscriptions] = useState([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    // Загружаем продукты
    getProducts().then(setProducts);

    // Слушаем изменения в подписках пользователя
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      if (user) {
        const unsubscribeSubscriptions = subscribeToUserSubscriptions(setSubscriptions);
        return () => unsubscribeSubscriptions();
      } else {
        setSubscriptions([]);
      }
    });

    return unsubscribe;
  }, []);

  const handlePurchase = async (priceId) => {
    setLoading(true);
    try {
      const checkoutUrl = await createCheckoutSession(priceId, {
        name: 'John Doe',
        phone: '+380123456789',
        address: 'Киев, ул. Примерная 123'
      });
      
      // Перенаправляем на Stripe Checkout
      window.location.href = checkoutUrl;
    } catch (error) {
      console.error('Payment error:', error);
      alert('Ошибка при создании платежа');
    } finally {
      setLoading(false);
    }
  };

  const handleManageSubscription = async () => {
    try {
      const portalUrl = await createCustomerPortal();
      window.location.href = portalUrl;
    } catch (error) {
      console.error('Portal error:', error);
    }
  };

  return (
    <div>
      <h2>Продукты</h2>
      {products.map(product => (
        <div key={product.id}>
          <h3>{product.name}</h3>
          <p>{product.description}</p>
          {product.prices.map(price => (
            <button
              key={price.id}
              onClick={() => handlePurchase(price.id)}
              disabled={loading}
            >
              Купить за {price.unit_amount / 100} {price.currency.toUpperCase()}
            </button>
          ))}
        </div>
      ))}

      <h2>Мои подписки</h2>
      {subscriptions.length > 0 ? (
        <div>
          {subscriptions.map(sub => (
            <div key={sub.id}>
              <p>Статус: {sub.status}</p>
              <p>Период: {new Date(sub.current_period_end * 1000).toLocaleDateString()}</p>
            </div>
          ))}
          <button onClick={handleManageSubscription}>
            Управление подписками
          </button>
        </div>
      ) : (
        <p>У вас нет активных подписок</p>
      )}
    </div>
  );
};

// 🎯 ОСНОВНЫЕ ПРЕИМУЩЕСТВА ЭТОГО ПОДХОДА:
// ✅ Нет проблем с raw body - расширение все решает автоматически
// ✅ Автоматическая синхронизация с Stripe
// ✅ Реальное время обновления через Firestore
// ✅ Безопасность - все через Firebase Auth
// ✅ Готовые Cloud Functions для webhook'ов
// ✅ Customer Portal из коробки
// ✅ Поддержка подписок и разовых платежей