// netlify/functions/fapshi-webhook.js

const admin = require('firebase-admin');
const crypto = require('crypto');

// 1) Initialiser Firebase Admin (si ce n'est pas déjà fait)
if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
    }),
  });
}

// 2) Vérification de la signature que Fapshi envoie dans l'en‑tête x-fapshi-signature
function verifySignature(event) {
  const signature = event.headers['x-fapshi-signature'];
  if (!signature) return false;

  const rawBody = event.body; // JSON brut envoyé
  const expected = crypto
    .createHmac('sha256', process.env.FAPSHI_SECRET_KEY)
    .update(rawBody)
    .digest('hex');

  return signature === expected;
}

exports.handler = async (event) => {
  try {
    // 3) N’accepte que les requêtes POST
    if (event.httpMethod !== 'POST') {
      return { statusCode: 405, body: 'Method Not Allowed' };
    }

    // 4) Vérifier la signature HMAC
    if (process.env.FAPSHI_SECRET_KEY) {
      // Ajout de logs temporaires pour comparaison
      console.log(">>> Header x-fapshi-signature:", event.headers['x-fapshi-signature']);
      console.log(">>> Corps brut            :", event.body);
      console.log(">>> Signature attendue    :", crypto.createHmac('sha256', process.env.FAPSHI_SECRET_KEY).update(event.body).digest('hex'));

      const isValid = verifySignature(event);
      if (!isValid) {
        return { statusCode: 401, body: 'Signature invalide' };
      }
    }

    // 5) Parser le JSON du webhook envoyé par Fapshi
    const payload = JSON.parse(event.body);

    // 6) Vérifier que le statut est 'paid'
    if (payload.status !== 'paid') {
      return { statusCode: 200, body: 'Paiement non finalisé' };
    }

    // 7) Récupérer l’UID et le montant depuis metadata
    const uid = payload.metadata?.userId;
    const amount = payload.amount;
    if (!uid || !amount) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'Données manquantes (userId ou amount)' }),
      };
    }

    // 8) Référence vers le document Firestore de l’utilisateur
    const userRef = admin.firestore().collection('users').doc(uid);

    // 9) Transaction pour incrémenter le solde
    const newBalance = await admin.firestore().runTransaction(async (tx) => {
      const doc = await tx.get(userRef);
      // Si le document n’existe pas, balance = 0 par défaut
      const oldBalance = doc.exists ? doc.data().balance || 0 : 0;
      const updated = oldBalance + amount;

      // Utiliser tx.set(..., { merge: true }) pour créer si besoin
      if (doc.exists) {
        tx.update(userRef, { balance: updated });
      } else {
        tx.set(userRef, { balance: updated }, { merge: true });
      }
      return updated;
    });

    // 10) Répondre OK à Fapshi
    return {
      statusCode: 200,
      body: JSON.stringify({
        message:    'Solde mis à jour avec succès',
        uid:        uid,
        newBalance: newBalance,
      }),
    };
  } catch (err) {
    console.error('Erreur webhook Fapshi ▶', err);
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
