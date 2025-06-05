// netlify/functions/fapshi-webhook.js

const admin = require('firebase-admin');
// const crypto = require('crypto'); // plus nécessaire si on désactive la vérif HMAC

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

// Si vous aviez la fonction verifySignature, vous pouvez la supprimer ou la commenter :
// function verifySignature(event) {
//   const signature = event.headers['x-fapshi-signature'];
//   if (!signature) return false;
//   const rawBody = event.body;
//   const expected = crypto
//     .createHmac('sha256', process.env.FAPSHI_SECRET_KEY)
//     .update(rawBody)
//     .digest('hex');
//   return signature === expected;
// }

exports.handler = async (event) => {
  try {
    // 2) N’accepte que les requêtes POST
    if (event.httpMethod !== 'POST') {
      return { statusCode: 405, body: 'Method Not Allowed' };
    }

    // 3) Ici, on désactive la vérification HMAC ; on accepte tout qui vient de Fapshi
    // if (process.env.FAPSHI_SECRET_KEY) {
    //   const isValid = verifySignature(event);
    //   if (!isValid) {
    //     return { statusCode: 401, body: 'Signature invalide' };
    //   }
    // }

    // 4) Parser le JSON du webhook envoyé par Fapshi
    const payload = JSON.parse(event.body);

    // 5) Vérifier que le statut est 'paid'
    if (payload.status !== 'paid') {
      return { statusCode: 200, body: 'Paiement non finalisé' };
    }

    // 6) Récupérer l’UID et le montant depuis metadata
    const uid = payload.metadata?.userId;
    const amount = payload.amount;
    if (!uid || !amount) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'Données manquantes (userId ou amount)' }),
      };
    }

    // 7) Référence vers le document Firestore de l’utilisateur
    const userRef = admin.firestore().collection('users').doc(uid);

    // 8) Transaction pour incrémenter le solde
    const newBalance = await admin.firestore().runTransaction(async (tx) => {
      const doc = await tx.get(userRef);
      // Si le document n’existe pas, balance = 0 par défaut
      const oldBalance = doc.exists ? doc.data().balance || 0 : 0;
      const updated = oldBalance + amount;
      // Remplacez tx.update par tx.set pour créer le document si besoin
      if (doc.exists) {
        tx.update(userRef, { balance: updated });
      } else {
        tx.set(userRef, { balance: updated }, { merge: true });
      }
      return updated;
    });

    // 9) Répondre OK à Fapshi
    return {
      statusCode: 200,
      body: JSON.stringify({
        message: 'Solde mis à jour avec succès',
        uid: uid,
        newBalance: newBalance,
      }),
    };
  } catch (err) {
    console.error('Erreur webhook Fapshi ▶', err);
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
