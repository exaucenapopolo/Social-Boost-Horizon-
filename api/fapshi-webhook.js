// api/fapshi-webhook.js

import admin from ‘firebase-admin’;
import crypto from ‘crypto’;

// Initialisation Firebase avec gestion d’erreur
if (!admin.apps.length) {
try {
// Formatage correct de la clé privée
const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\n/g, ‘\n’);

```
admin.initializeApp({
  credential: admin.credential.cert({
    projectId: process.env.FIREBASE_PROJECT_ID,
    clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
    privateKey: privateKey
  }),
});
console.log('✅ Firebase initialisé avec succès');
```

} catch (error) {
console.error(‘❌ Erreur initialisation Firebase:’, error);
}
}

export default async function handler(req, res) {
console.log(’>>> Webhook reçu:’, {
method: req.method,
headers: req.headers,
body: req.body
});

// Vérification méthode HTTP
if (req.method !== ‘POST’) {
return res.status(405).json({ error: ‘Method Not Allowed’ });
}

try {
// Récupération du corps brut pour la vérification de signature
let rawBody;
if (typeof req.body === ‘string’) {
rawBody = req.body;
} else {
rawBody = JSON.stringify(req.body);
}

```
// Vérification signature HMAC (si fournie)
const signature = req.headers['x-fapshi-signature'] || req.headers['X-Fapshi-Signature'];
const secretKey = process.env.FAPSHI_SECRET_KEY;

if (signature && secretKey) {
  const expectedSignature = crypto
    .createHmac('sha256', secretKey)
    .update(rawBody)
    .digest('hex');

  console.log('>>> Vérification signature:', {
    received: signature,
    expected: expectedSignature,
    match: signature === expectedSignature
  });

  if (signature !== expectedSignature) {
    console.error('❌ Signature invalide');
    return res.status(401).json({ error: 'Signature invalide' });
  }
} else {
  console.warn('⚠️ Aucune signature fournie - vérification ignorée');
}

// Parsing du payload
let payload;
if (typeof req.body === 'object') {
  payload = req.body;
} else {
  try {
    payload = JSON.parse(rawBody);
  } catch (err) {
    console.error('Erreur parsing JSON:', err);
    return res.status(400).json({ error: 'JSON invalide' });
  }
}

console.log('>>> Payload webhook:', payload);

// Vérification du statut de paiement
const status = payload.status || payload.payment_status || payload.state;

if (status !== 'paid' && status !== 'completed' && status !== 'success') {
  console.log(`Paiement non finalisé: ${status}`);
  return res.status(200).json({ message: 'Paiement non finalisé', status });
}

// Extraction des données
const uid = payload.metadata?.userId || payload.user_id || payload.custom_data?.userId;
const amount = parseFloat(payload.amount || payload.total || payload.price || 0);

if (!uid) {
  console.error('❌ UID utilisateur manquant dans:', payload);
  return res.status(400).json({ error: 'ID utilisateur manquant' });
}

if (!amount || amount <= 0) {
  console.error('❌ Montant invalide:', amount);
  return res.status(400).json({ error: 'Montant invalide' });
}

console.log(`>>> Mise à jour solde: ${uid} +${amount}`);

// Mise à jour Firestore avec transaction
const db = admin.firestore();
const userRef = db.collection('users').doc(uid);

await db.runTransaction(async (transaction) => {
  const userDoc = await transaction.get(userRef);
  const currentData = userDoc.exists ? userDoc.data() : {};
  const currentBalance = currentData.balance || 0;
  const newBalance = currentBalance + amount;
  
  const updateData = {
    balance: newBalance,
    lastPayment: {
      amount: amount,
      timestamp: admin.firestore.FieldValue.serverTimestamp(),
      transactionId: payload.id || payload.transaction_id || Date.now().toString()
    }
  };

  transaction.set(userRef, updateData, { merge: true });
  
  console.log(`✅ Solde mis à jour: ${currentBalance} → ${newBalance}`);
});

// Optionnel: Enregistrer la transaction
try {
  await db.collection('transactions').add({
    userId: uid,
    amount: amount,
    status: 'completed',
    provider: 'fapshi',
    transactionId: payload.id || payload.transaction_id,
    timestamp: admin.firestore.FieldValue.serverTimestamp(),
    rawPayload: payload
  });
  console.log('✅ Transaction enregistrée');
} catch (transError) {
  console.warn('⚠️ Erreur enregistrement transaction:', transError);
  // Ne pas faire échouer le webhook pour cela
}

return res.status(200).json({ 
  success: true, 
  message: 'Paiement traité avec succès' 
});
```

} catch (error) {
console.error(‘🔥 ERREUR WEBHOOK:’, error);
return res.status(500).json({
error: ‘Erreur serveur’,
details: process.env.NODE_ENV === ‘development’ ? error.message : null
});
}
}
