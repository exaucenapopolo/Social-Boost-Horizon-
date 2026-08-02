import { initializeApp } from "https://www.gstatic.com/firebasejs/10.13.2/firebase-app.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore.js";
import { getMessaging } from "https://www.gstatic.com/firebasejs/10.13.2/firebase-messaging.js";
import { getAnalytics } from "https://www.gstatic.com/firebasejs/10.13.2/firebase-analytics.js";

const firebaseConfig = {
  apiKey: "AIzaSyD2JiDS0g8EkeNXxjO7_wGI3WznpPvcCCk",
  authDomain: "social-boost-horizon.firebaseapp.com",
  databaseURL: "https://social-boost-horizon-default-rtdb.firebaseio.com",
  projectId: "social-boost-horizon",
  storageBucket: "social-boost-horizon.firebasestorage.app",
  messagingSenderId: "43658165639",
  appId: "1:43658165639:web:b8f492dc6a25cd12fc6722",
  measurementId: "G-JJXPNN90V1"
};

export const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
export const messaging = getMessaging(app);

try {
  getAnalytics(app);
} catch (e) {
  // Analytics peut échouer si le navigateur bloque certaines fonctions.
}
