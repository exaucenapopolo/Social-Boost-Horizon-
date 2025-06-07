// api/fapshi-webhook.js

const admin  = require('firebase-admin');
const crypto = require('crypto');

// 1) Initialiser Firebase Admin
if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert({
      projectId:   process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey:  process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
    }),
  });
}

// 2) Vérifier signature HMAC
function verifySignature(event) {
  const sig = event.headers['x-fapshi-signature'];
  if (!sig) return false;
  const expected = crypto
    .createHmac('sha256', process.env.FAPSHI_SECRET_KEY)
    .update(event.body)
    .digest('hex');
  return sig === expected;
}

exports.handler = async (event) => {
  // 3) N’accepte que POST
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  // 4) Logs de signature
  console.log(">>> WEBHOOK headers:", JSON.stringify(event.headers));
  console.log(">>> WEBHOOK body   :", event.body);
  console.log(">>> expected sig   :", crypto.createHmac('sha256', process.env.FAPSHI_SECRET_KEY).update(event.body).digest('hex'));

  // 5) Vérifier la signature
  if (!verifySignature(event)) {
    return { statusCode: 401, body: 'Invalid signature' };
  }

  // 6) Parser le payload
  let payload;
  try {
    payload = JSON.parse(event.body);
  } catch {
    return { statusCode: 400, body: 'Bad JSON' };
  }

  // 7) Vérifier statut
  if (payload.status !== 'paid') {
    return { statusCode: 200, body: 'Payment not finalized' };
  }

  const uid    = payload.metadata?.userId;
  const amount = payload.amount;
  if (!uid || !amount) {
    return { statusCode: 400, body: 'Missing userId or amount' };
  }

  // 8) Mettre à jour Firestore
  const userRef = admin.firestore().collection('users').doc(uid);
  try {
    const newBalance = await admin.firestore().runTransaction(async (tx) => {
      const doc = await tx.get(userRef);
      const old  = doc.exists ? doc.data().balance || 0 : 0;
      const updated = old + amount;
      if (doc.exists) tx.update(userRef, { balance: updated });
      else           tx.set(userRef, { balance: updated }, { merge: true });
      return updated;
    });

    // 9) Répondre OK
    return {
      statusCode: 200,
      body: JSON.stringify({ message: 'Balance updated', uid, newBalance })
    };
  } catch (err) {
    console.error("Webhook error ▶", err);
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
