import { doc, setDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore.js";
import { getToken, onMessage } from "https://www.gstatic.com/firebasejs/10.13.2/firebase-messaging.js";
import { db, messaging } from "./firebase-config.js";

const VAPID_KEY = "BDJ9c5sqfWbd5CvqSO_2SwT61nt-tq6N7PNAXbrqY1LNN1GMxkPweAZ4Ixr6482ZE1P-R3rJEf0ddlD_EDWEGEU";

// On exporte la fonction pour que ton tableau de bord puisse l'utiliser
export async function enablePushNotifications(userId = "anonymous") {
  if (!("serviceWorker" in navigator)) {
    throw new Error("Les Service workers ne sont pas supportés par ce navigateur.");
  }

  if (!("Notification" in window)) {
    throw new Error("Les notifications ne sont pas supportées par ce navigateur.");
  }

  // C'est ici que l'invite s'affiche pour l'utilisateur (déclenché par le clic)
  const permission = await Notification.requestPermission();
  if (permission !== "granted") {
    throw new Error("Permission refusée par l'utilisateur.");
  }

  // Enregistrement du service worker
  const swRegistration = await navigator.serviceWorker.register("/firebase-messaging-sw.js");

  // Récupération du token
  const token = await getToken(messaging, {
    vapidKey: VAPID_KEY,
    serviceWorkerRegistration: swRegistration,
  });

  if (token) {
    // Sauvegarde dans Firestore
    await setDoc(doc(db, "pushTokens", token), {
      token,
      userId,
      createdAt: serverTimestamp(),
      userAgent: navigator.userAgent,
      origin: window.location.origin
    }, { merge: true });
    
    return token;
  } else {
    throw new Error("Aucun token reçu de Firebase.");
  }
}

// Gestion des notifications quand l'utilisateur est sur la page
onMessage(messaging, (payload) => {
  console.log("Notification au premier plan :", payload);
  const title = payload?.notification?.title || "Nouvelle notification";
  const body = payload?.notification?.body || "";
  
  // Utilisation correcte des backticks pour la chaîne de caractères
  alert(`🔔 ${title} — ${body}`); 
});
