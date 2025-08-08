import { initializeApp } from "firebase/app";
import { getAuth, signInAnonymously, onAuthStateChanged } from "firebase/auth";
import { getFirestore, collection, addDoc, onSnapshot, doc, setDoc } from "firebase/firestore";
import { getStorage } from "firebase/storage";
import { getFunctions, httpsCallable } from "firebase/functions";

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain:
    import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket:
    import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId:
    import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
  measurementId: import.meta.env.VITE_MASUREMENT_ID,
};

const app = initializeApp(firebaseConfig);

const functions = getFunctions(app);
export const auth = getAuth(app);
export const db = getFirestore(app);
export const storage = getStorage(app);

// ✅ Ensure user is authenticated (anonymously if needed)
const ensureAuth = async () => {
  return new Promise((resolve, reject) => {
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      unsubscribe();
      if (user) {
        resolve(user);
      } else {
        try {
          const result = await signInAnonymously(auth);
          resolve(result.user);
        } catch (error) {
          reject(error);
        }
      }
    });
  });
};

// ✅ NEW: Firebase Stripe Extension Integration
export const createCheckoutSession = async (params: {
  customer_email: string;
  referralCode?: string;
  name: string;
  phone: string;
  address: string;
}) => {
  // Ensure user is authenticated
  const user = await ensureAuth() as any;
  
  try {
    // Сохраняем заказ в нашу коллекцию для обработки (по email как ключ)
    await setDoc(doc(db, 'orders', params.customer_email), {
      email: params.customer_email,
      name: params.name,
      phone: params.phone,
      address: params.address,
      referralCode: params.referralCode || null,
      userId: user.uid,
      createdAt: new Date(),
      status: 'pending'
    });

    console.log('✅ Order saved to Firestore for email:', params.customer_email);

    // Создаем checkout сессию через расширение
    const checkoutSessionRef = await addDoc(
      collection(db, `customers/${user.uid}/checkout_sessions`),
      {
        price: 'price_1RnK1iQbiHOSieT9wsaQ8nOK', // Ваш price ID из Stripe
        success_url: window.location.origin + '/success',
        cancel_url: window.location.origin + '/product',
        mode: 'payment',
        customer_email: params.customer_email,
        metadata: {
          referralCode: params.referralCode || '',
          orderId: params.customer_email
        }
      }
    );

    console.log('✅ Checkout session created in Firestore');

    // Ждем когда расширение создаст URL для оплаты
    return new Promise<{sessionId: string}>((resolve, reject) => {
      const timeout = setTimeout(() => {
        unsubscribe();
        reject(new Error('Timeout waiting for checkout session'));
      }, 30000); // 30 seconds timeout

      const unsubscribe = onSnapshot(checkoutSessionRef, (snap) => {
        const data = snap.data();
        console.log('Checkout session data:', data);
        
        if (data?.error) {
          clearTimeout(timeout);
          unsubscribe();
          reject(new Error(data.error.message));
        }
        if (data?.url) {
          clearTimeout(timeout);
          unsubscribe();
          console.log('✅ Redirecting to Stripe:', data.url);
          // Перенаправляем на Stripe Checkout
          window.location.href = data.url;
          resolve({sessionId: checkoutSessionRef.id});
        }
      });
    });
  } catch (error) {
    console.error('❌ Error creating checkout session:', error);
    throw error;
  }
};

// Остальные функции без изменений
export const createNovaPoshtaShipment = httpsCallable(functions, "createNovaPoshtaShipment");
export const processRefund = httpsCallable(functions, "processRefund");
export const trackNovaPoshta = httpsCallable(functions, "trackNovaPoshta");

export default app;
