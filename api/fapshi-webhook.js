// api/fapshi-webhook.js

const admin = require('firebase-admin');
const crypto = require('crypto');

// Initialisation Firebase
if (!admin.apps.length) {
  console.log(">>> Checking FIREBASE_PROJECT_ID:", process.env.FIREBASE_PROJECT_ID);
  console.log(">>> Checking FIREBASE_CLIENT_EMAIL:", process.env.FIREBASE_CLIENT_EMAIL);
  // Nous n'allons plus logguer la clé brute car elle sera la clé PEM directe et longue.
  // Si tu veux la débugguer, tu peux logguer les 50 premiers et derniers caractères de process.env.FIREBASE_PRIVATE_KEY
  // console.log(">>> Raw FIREBASE_PRIVATE_KEY (Start/End):", process.env.FIREBASE_PRIVATE_KEY ? process.env.FIREBASE_PRIVATE_KEY.substring(0, 50) + '...' + process.env.FIREBASE_PRIVATE_KEY.substring(process.env.FIREBASE_PRIVATE_KEY.length - 50) : 'NOT SET'); 

  const firebasePrivateKey = process.env.FIREBASE_PRIVATE_KEY; // On prend la clé PEM directement

  if (!firebasePrivateKey) {
    console.error("❌ ERREUR: FIREBASE_PRIVATE_KEY n'est pas définie dans l'environnement.");
    return res.status(500).json({ error: 'Clé privée Firebase non configurée.' });
  }

  // Ajout de logs pour vérifier la clé PEM directement
  console.log(">>> Firebase Private Key (Length):", firebasePrivateKey.length);
  console.log(">>> Firebase Private Key (Start):", firebasePrivateKey.substring(0, 50));
  console.log(">>> Firebase Private Key (End):", firebasePrivateKey.substring(firebasePrivateKey.length - 50));
  if (firebasePrivateKey.startsWith('-----BEGIN PRIVATE KEY-----') && firebasePrivateKey.endsWith('-----END PRIVATE KEY-----\n')) {
      console.log(">>> Key appears to be in correct PEM format.");
  } else {
      console.warn(">>> Key MIGHT NOT be in correct PEM format. Check headers/footers or missing final newline.");
  }

  admin.initializeApp({
    credential: admin.credential.cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: firebasePrivateKey // Utilise la clé PEM directe
    }),
  });
}
// ... (le reste de ton code handler inchangé) ...
