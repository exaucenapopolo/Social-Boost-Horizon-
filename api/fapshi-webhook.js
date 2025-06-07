// api/fapshi-webhook.js

const admin = require('firebase-admin');
const crypto = require('crypto');

// Initialisation Firebase corrigée et plus robuste pour la clé privée
if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      // DÉCODAGE DE LA CLÉ PRIVÉE EN BASE64 ICI
      privateKey: Buffer.from(process.env.FIREBASE_PRIVATE_KEY, 'base64').toString('utf8')
    }),
  });
}

// Syntaxe Vercel : export default function avec req et res
export default async function handler(req, res) {
  // Vérification méthode HTTP
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  // Récupération du corps BRUT
  // Vercel fournit req.rawBody déjà si le Content-Type est un type de webhook
  // et si 'bodyParser' est désactivé dans la configuration Vercel (ce qui est souvent le cas pour les webhooks).
  // Si req.rawBody n'est pas disponible, il faudrait lire le stream manuellement,
  // mais cela devrait fonctionner par défaut avec les webhooks Vercel.
  const rawBody = req.rawBody; 

  if (!rawBody) {
      console.error('Webhook: Corps brut de la requête manquant.');
      // Envoie une réponse 200 même si le corps est manquant pour éviter les ré-essais excessifs
      // de la part de Fapshi si c'est un problème ponctuel. Une meilleure pratique serait 400.
      // Pour le moment, gardons 400 pour un diagnostic clair.
      return res.status(400).json({ error: 'Corps de la requête manquant' });
  }

  // Vérification signature HMAC
  const signature = req.headers['x-fapshi-signature'];
  const secretKey = process.env.FAPSHI_SECRET_KEY;

  if (!secretKey) {
      console.error('CRITICAL: FAPSHI_SECRET_KEY manquant pour la vérification du webhook.');
      return res.status(500).json({ error: 'Configuration serveur incomplète pour le webhook' });
  }

  // Création de la signature attendue
  const expectedSig = crypto
    .createHmac('sha256', secretKey)
    .update(rawBody) // Utilise le corps brut pour la vérification
    .digest('hex');

  console.log(`>>> Signature check:\nReceived: ${signature}\nExpected: ${expectedSig}`);

  if (signature !== expectedSig) {
    console.warn('Webhook: Signature invalide reçue.');
    return res.status(401).json({ error: 'Signature invalide' });
  }

  // Parsing du payload (maintenant depuis rawBody pour garantir la cohérence avec la signature)
  let payload;
  try {
    payload = JSON.parse(rawBody);
  } catch (err) {
    console.error('Webhook: Erreur parsing JSON du payload:', err);
    return res.status(400).json({ error: 'JSON invalide dans le payload' });
  }

  // Vérification statut paiement
  // Assurez-vous que le statut "paid" est bien celui envoyé par Fapshi pour un paiement réussi.
  // D'autres statuts pourraient être "success", "completed", etc.
  if (payload.status !== 'paid') {
    console.log(`Webhook: Paiement non finalisé ou statut inattendu: ${payload.status}`);
    // Si le statut n'est pas 'paid', on retourne 200 OK pour ne pas re-tenter inutilement
    // mais on ne met pas à jour le solde.
    return res.status(200).json({ message: 'Paiement non finalisé ou statut inattendu' });
  }

  // Validation des données nécessaires
  const uid = payload.metadata?.userId; // Accès sécurisé à metadata.userId
  const amount = payload.amount;
  
  if (!uid || typeof amount === 'undefined' || amount === null) { // Vérifie aussi si amount est défini
    console.error('Webhook: Données essentielles manquantes (userId ou amount) dans le payload:', payload);
    return res.status(400).json({ error: 'Données (userId ou amount) manquantes dans le webhook' });
  }
  
  // Assurez-vous que l'amount est un nombre pour éviter des problèmes d'addition
  const parsedAmount = parseFloat(amount);
  if (isNaN(parsedAmount)) {
      console.error('Webhook: Montant non numérique reçu:', amount);
      return res.status(400).json({ error: 'Montant invalide reçu' });
  }

  // Mise à jour Firestore
  try {
    const db = admin.firestore();
    const userRef = db.collection('users').doc(uid);

    let newBalance = 0; // Initialise avec une valeur par défaut
    await db.runTransaction(async (tx) => {
      const doc = await tx.get(userRef);
      const currentBalance = doc.exists ? doc.data().balance || 0 : 0;
      newBalance = currentBalance + parsedAmount; // Calcul du nouveau solde
      tx.set(userRef, { balance: newBalance }, { merge: true });
    });

    console.log(`Webhook: Solde de l'utilisateur ${uid} mis à jour avec ${parsedAmount}. Nouveau solde: ${newBalance}`);
    return res.status(200).json({ success: true, message: 'Solde utilisateur mis à jour' });

  } catch (err) {
    console.error("🔥 ERREUR FIRESTORE LORS DU WEBHOOK:", err);
    // En cas d'erreur Firebase, renvoie une erreur 500 pour que Fapshi puisse re-tenter plus tard
    return res.status(500).json({ error: 'Erreur base de données lors de la mise à jour du solde', details: err.message });
  }
}
