// web/src/lib/firebase.ts
import { initializeApp } from "firebase/app";
import { getAuth, signInAnonymously } from "firebase/auth";
import { getFirestore } from "firebase/firestore";
import { getStorage } from "firebase/storage";
import { getFunctions, httpsCallable } from "firebase/functions";

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
  measurementId: import.meta.env.VITE_MASUREMENT_ID,
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
export const storage = getStorage(app);

const functions = getFunctions(app);

export const initiateCheckout = httpsCallable(functions, "initiateCheckout");
export const createNovaPoshtaShipment = httpsCallable(functions, "createNovaPoshtaShipment");
export const processRefund = httpsCallable(functions, "processRefund");
export const trackNovaPoshta = httpsCallable(functions, "trackNovaPoshta"); // Или refreshShipmentStatus, если переименуешь

export async function startCheckout(data: any) {
  if (!auth.currentUser) {
    await signInAnonymously(auth);
  }
  try {
    const result: any = await initiateCheckout(data);
    const formHtml = result?.data?.formHtml;
    if (!formHtml) throw new Error("LiqPay form not returned");

    // Рендерим форму и сабмитим автоматически
    const formContainer = document.createElement("div");
    formContainer.innerHTML = formHtml;
    document.body.appendChild(formContainer);
    const form = formContainer.querySelector("form") as HTMLFormElement;
    if (form) {
      form.submit();
    } else {
      throw new Error("Form not found in HTML");
    }

    return result.data.orderId;
  } catch (error) {
    console.error("Checkout failed:", error);
    throw error;
  }
}

export default app;
