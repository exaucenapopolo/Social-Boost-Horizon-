import { doc, setDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore.js";
import { getToken, onMessage } from "https://www.gstatic.com/firebasejs/10.13.2/firebase-messaging.js";
import { db, messaging } from "./firebase-config.js";

const VAPID_KEY = "BDJ9c5sqfWbd5CvqSO_2SwT61nt-tq6N7PNAXbrqY1LNN1GMxkPweAZ4Ixr6482ZE1P-R3rJEf0ddlD_EDWEGEU";

export async function enablePushNotifications(userId = "anonymous") {
  if (!("serviceWorker" in navigator)) {
    throw new Error("Les Service workers ne sont pas supportés par ce navigateur.");
  }

  if (!("Notification" in window)) {
    throw new Error("Les notifications ne sont pas supportées par ce navigateur.");
  }

  const permission = await Notification.requestPermission();
  if (permission !== "granted") {
    throw new Error("Permission refusée par l'utilisateur.");
  }

  // NOUVEAU : Ajout d'un bloc de capture d'erreur pour diagnostiquer le problème
  let swRegistration;
  try {
    swRegistration = await navigator.serviceWorker.register("/firebase-messaging-sw.js");
    console.log("Succès : Le Service Worker a été trouvé et enregistré !");
  } catch (error) {
    console.error("Erreur de chemin ou blocage du navigateur : Impossible de trouver /firebase-messaging-sw.js", error);
    throw new Error("Échec de l'enregistrement du Service Worker.");
  }

  const token = await getToken(messaging, {
    vapidKey: VAPID_KEY,
    serviceWorkerRegistration: swRegistration,
  });

  if (token) {
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

onMessage(messaging, (payload) => {
  console.log("Notification au premier plan :", payload);
  const title = payload?.notification?.title || "Nouvelle notification";
  const body = payload?.notification?.body || "";
  
  alert(`🔔 ${title} — ${body}`); 
});
