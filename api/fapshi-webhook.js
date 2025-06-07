// api/fapshi-webhook.js

const admin = require('firebase-admin');
const crypto = require('crypto');

// Initialisation Firebase corrigée et plus robuste pour la clé privée
if (!admin.apps.length) {
  console.log(">>> Checking FIREBASE_PROJECT_ID:", process.env.FIREBASE_PROJECT_ID);
  console.log(">>> Checking FIREBASE_CLIENT_EMAIL:", process.env.FIREBASE_CLIENT_EMAIL);
  console.log(">>> Raw FIREBASE_PRIVATE_KEY (Base64 from ENV):", process.env.FIREBASE_PRIVATE_KEY ? process.env.FIREBASE_PRIVATE_KEY.substring(0, 50) + '...' + process.env.FIREBASE_PRIVATE_KEY.substring(process.env.FIREBASE_PRIVATE_KEY.length - 50) : 'NOT SET'); 
  // J'ai modifié le log ci-dessus pour montrer le début ET la fin de la chaîne Base64

  let decodedPrivateKey = '';
  try {
    decodedPrivateKey = Buffer.from(process.env.FIREBASE_PRIVATE_KEY, 'base64').toString('utf8');
    // Log le début, la fin et la longueur de la clé décodée
    console.log(">>> Decoded Private Key (Length):", decodedPrivateKey.length);
    console.log(">>> Decoded Private Key (Start):", decodedPrivateKey.substring(0, 50));
    console.log(">>> Decoded Private Key (End):", decodedPrivateKey.substring(decodedPrivateKey.length - 50));
    // Vérification des en-têtes et pieds de page pour le format PEM
    if (decodedPrivateKey.startsWith('-----BEGIN PRIVATE KEY-----') && decodedPrivateKey.endsWith('-----END PRIVATE KEY-----\n')) {
        console.log(">>> Decoded key APPEARS to be in correct PEM format.");
    } else {
        console.warn(">>> Decoded key MIGHT NOT be in correct PEM format. Check headers/footers.");
    }

  } catch (decodeErr) {
    console.error("❌ ERREUR DE DÉCODAGE BASE64 EN MEMOIRE:", decodeErr.message);
    // Si le décodage échoue à ce stade (ce qui est peu probable si le Base64 est valide),
    // on renvoie une erreur pour éviter que Firebase ne plante plus tard.
    return res.status(500).json({ error: 'Erreur de décodage de la clé privée Firebase en mémoire' });
  }

  admin.initializeApp({
    credential: admin.credential.cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: decodedPrivateKey // Utilise la clé décodée
    }),
  });
}
// ... (le reste de ton code handler inchangé) ...
