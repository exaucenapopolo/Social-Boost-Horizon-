// Fichier : api/_firebase.js
const admin = require('firebase-admin');

if (!admin.apps.length) {
  try {
    // Vercel lira ta clé privée depuis les variables d'environnement
    const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
    
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount)
    });
  } catch (error) {
    console.error('Erreur d\'initialisation de Firebase Admin', error);
  }
}

const db = admin.firestore();
module.exports = { admin, db };
