import { doc, setDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore.js";
import { getToken, onMessage } from "https://www.gstatic.com/firebasejs/10.13.2/firebase-messaging.js";
import { db, messaging } from "./firebase-config.js";

const VAPID_KEY = "BDJ9c5sqfWbd5CvqSO_2SwT61nt-tq6N7PNAXbrqY1LNN1GMxkPweAZ4Ixr6482ZE1P-R3rJEf0ddlD_EDWEGEU";

const statusEl = document.getElementById("status");
const btn = document.getElementById("btn-enable-push");

function setStatus(message) {
  if (statusEl) statusEl.textContent = message;
}

async function enablePushNotifications(userId = "anonymous") {
  if (!("serviceWorker" in navigator)) {
    throw new Error("Service workers non supportés.");
  }

  if (!("Notification" in window)) {
    throw new Error("Notifications non supportées.");
  }

  const permission = await Notification.requestPermission();
  if (permission !== "granted") {
    setStatus("Permission refusée.");
    return null;
  }

  const swRegistration = await navigator.serviceWorker.register("/firebase-messaging-sw.js");

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

    setStatus("Notifications activées.");
  } else {
    setStatus("Aucun token reçu.");
  }

  return token;
}

onMessage(messaging, (payload) => {
  console.log("Notification au premier plan :", payload);
  const title = payload?.notification?.title || "Nouvelle notification";
  const body = payload?.notification?.body || "";
  setStatus(`${title} — ${body}`);
});

if (btn) {
  btn.addEventListener("click", async () => {
    try {
      setStatus("Activation en cours...");
      await enablePushNotifications("user-1");
    } catch (error) {
      console.error(error);
      setStatus(error.message || "Erreur.");
    }
  });
}
