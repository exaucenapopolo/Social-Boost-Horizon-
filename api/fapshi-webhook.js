// api/fapshi-webhook.js

const admin = require('firebase-admin');
const crypto = require('crypto');

// Initialisation Firebase corrigée
if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: process.env.FIREBASE_PRIVATE_KEY // Format direct
    }),
  });
}

exports.handler = async (event) => {
  // Vérification méthode HTTP
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  // Récupération du corps BRUT
  const rawBody = event.isBase64Encoded
    ? Buffer.from(event.body, 'base64').toString('utf8')
    : event.body;

  // Vérification signature HMAC
  const signature = event.headers['x-fapshi-signature'];
  const expectedSig = crypto
    .createHmac('sha256', process.env.FAPSHI_SECRET_KEY)
    .update(rawBody)
    .digest('hex');

  console.log(`>>> Signature check:\nReceived: ${signature}\nExpected: ${expectedSig}`);

  if (signature !== expectedSig) {
    return { statusCode: 401, body: 'Signature invalide' };
  }

  // Parsing du payload
  let payload;
  try {
    payload = JSON.parse(rawBody);
  } catch (err) {
    return { statusCode: 400, body: 'JSON invalide' };
  }

  // Vérification statut paiement
  if (payload.status !== 'paid') {
    return { statusCode: 200, body: 'Paiement non finalisé' };
  }

  // Validation des données
  const uid = payload.metadata?.userId;
  const amount = payload.amount;
  if (!uid || !amount) {
    return { statusCode: 400, body: 'Données manquantes' };
  }

  // Mise à jour Firestore
  try {
    const db = admin.firestore();
    const userRef = db.collection('users').doc(uid);
    
    await db.runTransaction(async (tx) => {
      const doc = await tx.get(userRef);
      const currentBalance = doc.exists ? doc.data().balance || 0 : 0;
      tx.set(userRef, { balance: currentBalance + amount }, { merge: true });
    });

    return {
      statusCode: 200,
      body: JSON.stringify({ success: true })
    };
    
  } catch (err) {
    console.error("🔥 ERREUR FIRESTORE:", err);
    return { 
      statusCode: 500, 
      body: JSON.stringify({ error: 'Erreur base de données' }) 
    };
  }
};
