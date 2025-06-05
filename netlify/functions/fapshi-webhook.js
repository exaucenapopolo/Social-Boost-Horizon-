// netlify/functions/fapshi-webhook.js

const admin = require('firebase-admin');
const crypto = require('crypto');

// 1. Initialiser Firebase Admin si ce n'est pas déjà fait
if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      // Remplace les “\n” en vraies nouvelles lignes
      privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
    }),
    // databaseURL: process.env.FIREBASE_DATABASE_URL, // si nécessaire
  });
}

// 2. Vérifier la signature reçue de Fapshi (optionnel, mais recommandé)
function verifySignature(event) {
  const signature = event.headers['x-fapshi-signature'];
  if (!signature) return false;
  const rawBody = event.body; // le JSON brut reçu
  const expected = crypto
    .createHmac('sha256', process.env.FAPSHI_WEBHOOK_SECRET)
    .update(rawBody)
    .digest('hex');
  return signature === expected;
}

exports.handler = async (event) => {
  try {
    // Seulement les POST
    if (event.httpMethod !== 'POST') {
      return { statusCode: 405, body: 'Method Not Allowed' };
    }

    // Vérifier la signature si vous avez configuré FAPSHI_WEBHOOK_SECRET
    if (process.env.FAPSHI_WEBHOOK_SECRET) {
      const isValid = verifySignature(event);
      if (!isValid) {
        return { statusCode: 401, body: 'Signature invalide' };
      }
    }

    // Parser le JSON envoyé par Fapshi
    const payload = JSON.parse(event.body);

    // Si le statut n'est pas 'paid', on ne fait rien
    if (payload.status !== 'paid') {
      return { statusCode: 200, body: 'Paiement non finalisé' };
    }

    // Extraire l'UID et le montant depuis metadata
    const uid = payload.metadata?.userId;
    const amount = payload.amount; // montant en XAF
    if (!uid || !amount) {
      return { statusCode: 400, body: 'Données manquantes (userId ou amount)' };
    }

    // Référence au document Firestore de l'utilisateur
    const userRef = admin.firestore().collection('users').doc(uid);

    // Transaction pour incrémenter le solde
    const newBalance = await admin.firestore().runTransaction(async (tx) => {
      const doc = await tx.get(userRef);
      const oldBalance = doc.exists ? doc.data().balance || 0 : 0;
      const updated = oldBalance + amount;
      tx.update(userRef, { balance: updated });
      return updated;
    });

    // Répondre OK à Fapshi
    return {
      statusCode: 200,
      body: JSON.stringify({
        message: 'Solde mis à jour avec succès',
        uid: uid,
        newBalance: newBalance
      })
    };
  } catch (err) {
    console.error('Erreur webhook Fapshi ▶', err);
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
