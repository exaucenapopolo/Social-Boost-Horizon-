// api/fapshi-webhook.js

const admin = require('firebase-admin');
const crypto = require('crypto');

// Initialisation Firebase corrigée
if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      // La clé privée peut être problematic si elle n'est pas sur une seule ligne ou encodée
      // Assure-toi que FIREBASE_PRIVATE_KEY est une chaîne de caractères sur une seule ligne,
      // par exemple, en remplaçant les \n par de vrais retours à la ligne ou en l'encodant
      // Si tu l'as configurée comme tu l'as montrée avec les `\n`, elle pourrait être parsée
      // par Vercel et Firebase Admin. Si ça échoue, pense à encoder/décoder en Base64.
      privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n') 
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
  // Vercel fournit req.body déjà parsé si Content-Type est application/json.
  // Pour la signature HMAC, tu as besoin du corps RAW. Vercel le met dans req.rawBody.
  // Si req.rawBody n'est pas disponible (ancienne version de Vercel ou configuration),
  // tu devras peut-être lire le stream, mais req.rawBody est la méthode recommandée.
  const rawBody = req.rawBody; // Vercel fournit le corps brut ici pour les webhooks

  if (!rawBody) {
      console.error('Webhook: Corps brut de la requête manquant.');
      return res.status(400).json({ error: 'Corps de la requête manquant' });
  }

  // Vérification signature HMAC
  const signature = req.headers['x-fapshi-signature'];
  const secretKey = process.env.FAPSHI_SECRET_KEY;

  if (!secretKey) {
      console.error('CRITICAL: FAPSHI_SECRET_KEY manquant pour la vérification du webhook.');
      return res.status(500).json({ error: 'Configuration serveur incomplète pour le webhook' });
  }

  const expectedSig = crypto
    .createHmac('sha256', secretKey)
    .update(rawBody)
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
  if (payload.status !== 'paid') {
    console.log(`Webhook: Paiement non finalisé ou statut inattendu: ${payload.status}`);
    return res.status(200).json({ message: 'Paiement non finalisé ou statut inattendu' });
  }

  // Validation des données
  const uid = payload.metadata?.userId;
  const amount = payload.amount;
  if (!uid || !amount) {
    console.error('Webhook: Données essentielles manquantes (uid ou amount) dans le payload:', payload);
    return res.status(400).json({ error: 'Données (userId ou amount) manquantes dans le webhook' });
  }
  
  // Assurez-vous que l'amount est un nombre pour éviter des concaténations inattendues
  const parsedAmount = parseFloat(amount);
  if (isNaN(parsedAmount)) {
      console.error('Webhook: Montant non numérique reçu:', amount);
      return res.status(400).json({ error: 'Montant invalide reçu' });
  }

  // Mise à jour Firestore
  try {
    const db = admin.firestore();
    const userRef = db.collection('users').doc(uid);

    await db.runTransaction(async (tx) => {
      const doc = await tx.get(userRef);
      const currentBalance = doc.exists ? doc.data().balance || 0 : 0;
      // Ajoute le montant parsé
      tx.set(userRef, { balance: currentBalance + parsedAmount }, { merge: true });
    });

    console.log(`Webhook: Solde de l'utilisateur ${uid} mis à jour avec ${parsedAmount}. Nouveau solde: ${currentBalance + parsedAmount}`);
    return res.status(200).json({ success: true, message: 'Solde utilisateur mis à jour' });

  } catch (err) {
    console.error("🔥 ERREUR FIRESTORE LORS DU WEBHOOK:", err);
    return res.status(500).json({ error: 'Erreur base de données lors de la mise à jour du solde' });
  }
}
