// api/create-fapshi-checkout.js
const fetch = (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args));
const admin = require('firebase-admin'); // Importez admin

// Initialisation Firebase (comme dans le webhook)
if (!admin.apps.length) {
  try {
    admin.initializeApp({
      credential: admin.credential.cert({
        projectId: process.env.FIREBASE_PROJECT_ID,
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
        privateKey: process.env.FIREBASE_PRIVATE_KEY
      }),
    });
    console.log("✅ Firebase initialized in create-fapshi-checkout.js.");
  } catch (firebaseInitError) {
    console.error("❌ Firebase initialization failed in create-fapshi-checkout.js:", firebaseInitError.message);
    // Continue l'exécution pour que l'erreur soit renvoyée au client si la config est mauvaise
  }
}

export default async function handler(req, res) {
  console.log(">>> create-fapshi-checkout REQ RECEIVED:", JSON.stringify({
    method: req.method,
    headers: req.headers,
    body: req.body // Log le body pour voir ce qui est reçu
  }, null, 2));

  console.log(">>> ENV CHECK (create-fapshi-checkout):", {
    FAPSHI_API_USER: !!process.env.FAPSHI_API_USER,
    FAPSHI_SECRET_KEY: !!process.env.FAPSHI_SECRET_KEY,
    FAPSHI_WEBHOOK_URL: !!process.env.FAPSHI_WEBHOOK_URL
  });

  try {
    if (req.method !== 'POST') {
      return res.status(405).json({ error: 'Method Not Allowed. Use POST only' });
    }

    const API_USER = process.env.FAPSHI_API_USER;
    const SECRET_KEY = process.env.FAPSHI_SECRET_KEY;
    const WEBHOOK_URL = process.env.FAPSHI_WEBHOOK_URL;

    if (!API_USER || !SECRET_KEY || !WEBHOOK_URL) {
      console.error('CRITICAL: Missing env vars in create-fapshi-checkout.js');
      return res.status(500).json({ error: 'Configuration serveur incomplète' });
    }

    const { amount, currency, description, redirectUrl, externalId } = req.body; 

    // Validation des paramètres reçus du frontend
    if (!amount || !currency || !redirectUrl || !externalId) {
      console.error('Paramètres manquants dans la requête client:', { amount, currency, redirectUrl, externalId });
      return res.status(400).json({ error: 'Paramètres manquants: amount, currency, redirectUrl ou externalId' });
    }

    const payload = {
      amount,
      currency,
      description: description || 'Paiement Social Boost Horizon',
      redirect_url: redirectUrl,
      webhook_url: WEBHOOK_URL,
      // On passe externalId comme metadata.userId pour le cas où Fapshi le renverrait un jour
      metadata: { userId: externalId } 
    };

    console.log(">>> Fapshi Payload (create-fapshi-checkout):", JSON.stringify(payload, null, 2));

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);

    try {
      const fapshiResponse = await fetch('https://live.fapshi.com/initiate-pay', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apiuser': API_USER,
          'apikey': SECRET_KEY
        },
        body: JSON.stringify(payload),
        signal: controller.signal
      });

      const rawText = await fapshiResponse.text();
      console.log('>>> Fapshi raw response (create-fapshi-checkout):', fapshiResponse.status, rawText);
      
      let respJson;
      try {
        respJson = JSON.parse(rawText);
      } catch (parseErr) {
        console.error('Erreur parsing réponse Fapshi non-JSON (create-fapshi-checkout):', parseErr);
        return res.status(502).json({ error: 'Réponse invalide du processeur (non-JSON)', details: rawText });
      }

      if (!fapshiResponse.ok) {
        console.error('Fapshi API error response:', respJson);
        return res.status(fapshiResponse.status).json(respJson); 
      }

      const checkoutUrl = respJson.data?.url || respJson.link;
      const fapshiTransId = respJson.transId || null; // Essayer de récupérer le transId si Fapshi le renvoie ici

      if (!checkoutUrl) {
        console.error('Structure de réponse Fapshi inattendue: pas de checkoutUrl', respJson);
        return res.status(502).json({ error: 'Réponse du processeur incomplète: URL de paiement manquante', details: respJson });
      }

      // --- NOUVEAU : Enregistrer la transaction dans Firestore ---
      const db = admin.firestore();
      const transactionsRef = db.collection('fapshiTransactions'); // Nouvelle collection pour suivre les transactions

      // Créer un document pour suivre cette transaction Fapshi
      // Utilisez le transId de Fapshi comme ID du document si disponible, sinon un ID généré.
      const transactionDocId = fapshiTransId || (Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15));
      
      await transactionsRef.doc(transactionDocId).set({
        fapshiTransId: fapshiTransId, // L'ID de transaction de Fapshi (si disponible)
        userId: externalId, // L'ID de ton utilisateur Firebase
        amount: amount,
        currency: currency,
        status: 'PENDING', // Statut initial
        dateInitiated: admin.firestore.FieldValue.serverTimestamp(),
        checkoutUrl: checkoutUrl // Utile pour le debug si besoin
      });
      console.log(`✅ Transaction (${transactionDocId}) recorded in Firestore for user ${externalId}.`);
      // --- FIN NOUVEAU ---

      // Succès: renvoie l'URL de paiement
      return res.status(200).json({ checkoutUrl });

    } catch (err) {
      if (err.name === 'AbortError') {
        console.error('Fapshi API timeout (create-fapshi-checkout)');
        return res.status(504).json({ error: 'Timeout lors de la connexion à Fapshi' });
      }
      console.error('❌ ERREUR LORS DE L\'APPEL FAPSHI (create-fapshi-checkout):', err.stack);
      return res.status(500).json({ 
        error: 'Erreur interne lors de la communication avec Fapshi',
        details: process.env.NODE_ENV === 'development' ? err.message : null
      });
    } finally {
      clearTimeout(timeout);
    }

  } catch (err) {
    console.error('❌ ERREUR GÉNÉRALE DANS HANDLER (create-fapshi-checkout):', err.stack);
    return res.status(500).json({
      error: 'Erreur serveur interne',
      details: process.env.NODE_ENV === 'development' ? err.message : null
    });
  }
}
