// api/fapshi-webhook.js
import admin from ‘firebase-admin’;
import crypto from ‘crypto’;

// Initialisation Firebase
if (!admin.apps.length) {
admin.initializeApp({
credential: admin.credential.cert({
projectId: process.env.FIREBASE_PROJECT_ID,
clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\n/g, ‘\n’) // Correction clé privée
}),
});
}

export default async function handler(req, res) {
console.log(”>>> WEBHOOK CALLED:”, {
method: req.method,
headers: req.headers,
body: req.body
});

// Vérification méthode HTTP
if (req.method !== ‘POST’) {
return res.status(405).json({ error: ‘Method Not Allowed’ });
}

try {
// Récupération du corps brut pour la signature
let rawBody;
if (typeof req.body === ‘string’) {
rawBody = req.body;
} else {
rawBody = JSON.stringify(req.body);
}

```
// Vérification signature HMAC
const signature = req.headers['x-fapshi-signature'] || req.headers['X-Fapshi-Signature'];
const expectedSig = crypto
  .createHmac('sha256', process.env.FAPSHI_SECRET_KEY)
  .update(rawBody)
  .digest('hex');

console.log(`>>> Signature check:\nReceived: ${signature}\nExpected: ${expectedSig}`);

if (signature !== expectedSig) {
  console.error('❌ SIGNATURE INVALIDE');
  return res.status(401).json({ error: 'Signature invalide' });
}

// Parsing du payload
let payload;
try {
  payload = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
} catch (err) {
  console.error('Erreur parsing JSON:', err);
  return res.status(400).json({ error: 'JSON invalide' });
}

console.log(">>> Payload reçu:", payload);

// Vérification statut paiement
if (payload.status !== 'paid' && payload.status !== 'completed') {
  console.log(`Paiement non finalisé, statut: ${payload.status}`);
  return res.status(200).json({ message: 'Paiement non finalisé' });
}

// Validation des données
const uid = payload.metadata?.userId;
const amount = parseFloat(payload.amount);

if (!uid) {
  console.error('❌ USER ID manquant dans metadata');
  return res.status(400).json({ error: 'User ID manquant' });
}

if (!amount || amount <= 0) {
  console.error('❌ Montant invalide:', payload.amount);
  return res.status(400).json({ error: 'Montant invalide' });
}

console.log(`>>> Mise à jour du solde pour l'utilisateur ${uid}: +${amount}`);

// Mise à jour Firestore
const db = admin.firestore();
const userRef = db.collection('users').doc(uid);

await db.runTransaction(async (tx) => {
  const doc = await tx.get(userRef);
  const currentBalance = doc.exists ? (doc.data().balance || 0) : 0;
  const newBalance = currentBalance + amount;
  
  console.log(`>>> Balance update: ${currentBalance} → ${newBalance}`);
  
  tx.set(userRef, { 
    balance: newBalance,
    lastPayment: {
      amount: amount,
      date: admin.firestore.FieldValue.serverTimestamp(),
      transactionId: payload.id || payload.transaction_id
    }
  }, { merge: true });
});

console.log('✅ PAIEMENT TRAITÉ AVEC SUCCÈS');

return res.status(200).json({ 
  success: true, 
  message: `Solde mis à jour: +${amount}` 
});
```

} catch (err) {
console.error(“🔥 ERREUR FIRESTORE:”, err);
return res.status(500).json({
error: ‘Erreur base de données’,
details: err.message
});
}
}
