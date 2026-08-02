importScripts("https://www.gstatic.com/firebasejs/10.13.2/firebase-app-compat.js");
importScripts("https://www.gstatic.com/firebasejs/10.13.2/firebase-messaging-compat.js");

firebase.initializeApp({
  apiKey: "AIzaSyD2JiDS0g8EkeNXxjO7_wGI3WznpPvcCCk",
  authDomain: "social-boost-horizon.firebaseapp.com",
  databaseURL: "https://social-boost-horizon-default-rtdb.firebaseio.com",
  projectId: "social-boost-horizon",
  storageBucket: "social-boost-horizon.firebasestorage.app",
  messagingSenderId: "43658165639",
  appId: "1:43658165639:web:b8f492dc6a25cd12fc6722",
  measurementId: "G-JJXPNN90V1"
});

const messaging = firebase.messaging();

messaging.onBackgroundMessage((payload) => {
  const title = payload?.notification?.title || "Nouvelle notification";
  const options = {
    body: payload?.notification?.body || "",
    data: payload?.data || {}
  };

  self.registration.showNotification(title, options);
});
