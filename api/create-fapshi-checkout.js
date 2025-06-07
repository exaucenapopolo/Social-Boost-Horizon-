// api/create-fapshi-checkout.js

// Version compatible Node 16+
// Pas besoin de 'node-fetch' si Vercel utilise Node.js 18+ ou 20+
// car 'fetch' est globalement disponible.
// Si tu es sur Node 16, conserve l'import. Si tu es sur 18/20, tu peux le retirer.
const fetch = (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args));

// Syntaxe Vercel : export default function avec req et res
export default async function handler(req, res) {
  console.log(">>> REQ RECEIVED:", JSON.stringify({
    method: req.method,
    headers: req.headers,
    // Ne log pas le body en entier directement pour des raisons de sécurité/taille si c'est gros
    // Mais on peut log une partie si besoin pour le debug
    // body: req.body 
  }));

  console.log(">>> ENV CHECK:", {
    FAPSHI_API_USER: !!process.env.FAPSHI_API_USER,
    FAPSHI_SECRET_KEY: !!process.env.FAPSHI_SECRET_KEY,
    FAPSHI_WEBHOOK_URL: !!process.env.FAPSHI_WEBHOOK_URL
  });

  try {
    if (req.method !== 'POST') {
      // Utilisation de res.status().json() pour Vercel
      return res.status(405).json({ error: 'Method Not Allowed. Use POST only' });
    }

    const API_USER = process.env.FAPSHI_API_USER;
    const SECRET_KEY = process.env.FAPSHI_SECRET_KEY;
    const WEBHOOK_URL = process.env.FAPSHI_WEBHOOK_URL;

    if (!API_USER || !SECRET_KEY || !WEBHOOK_URL) {
      console.error('CRITICAL: Missing env vars');
      return res.status(500).json({ error: 'Configuration serveur incomplète' });
    }

    let body;
    try {
      // req.body est déjà parsé par Vercel si Content-Type est application/json
      body = req.body; 
    } catch (err) {
      // Ce bloc catch est moins probable avec req.body, mais on le garde par précaution
      console.error('JSON parsing error (should not happen with req.body):', err);
      return res.status(400).json({ error: 'JSON invalide ou malformé' });
    }

    const { amount, currency, redirectUrl, uid } = body;
    if (!amount || !currency || !redirectUrl || !uid) {
      return res.status(400).json({ error: 'Paramètres manquants: amount, currency, redirectUrl ou uid' });
    }

    const payload = {
      amount,
      currency,
      description: 'Paiement Social Boost Horizon',
      redirect_url: redirectUrl,
      webhook_url: WEBHOOK_URL,
      metadata: { userId: uid }
    };

    // Debug: Vérification des credentials
    console.log(">>> API Credentials:", Buffer.from(`${API_USER}:${SECRET_KEY}`).toString('base64'));

    // Configuration du timeout
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
      console.log('>>> Fapshi response:', fapshiResponse.status, rawText);

      // Vercel gère les headers de réponse, donc on utilise res.json directement.
      // Pas besoin de vérifier 'content-type' ici côté Vercel, car on renvoie notre propre JSON.
      // La vérification de la réponse Fapshi est toujours pertinente.
      
      let respJson;
      try {
        respJson = JSON.parse(rawText);
      } catch (parseErr) {
        console.error('Erreur parsing réponse Fapshi non-JSON:', parseErr);
        return res.status(502).json({ error: 'Réponse invalide du processeur (non-JSON)', details: rawText });
      }

      if (!fapshiResponse.ok) {
        // Renvoie le statut et les détails de l'erreur Fapshi
        return res.status(fapshiResponse.status).json(respJson); 
      }

      const checkoutUrl = respJson.data?.url || respJson.link;
      if (!checkoutUrl) {
        console.error('Structure de réponse Fapshi inattendue: pas de checkoutUrl', respJson);
        return res.status(502).json({ error: 'Réponse du processeur incomplète: URL de paiement manquante', details: respJson });
      }

      // Succès: renvoie l'URL de paiement
      return res.status(200).json({ checkoutUrl });

    } catch (err) {
      if (err.name === 'AbortError') {
        console.error('Fapshi API timeout');
        return res.status(504).json({ error: 'Timeout lors de la connexion à Fapshi' });
      }
      console.error('❌ ERREUR LORS DE L\'APPEL FAPSHI:', err.stack);
      return res.status(500).json({ 
        error: 'Erreur interne lors de la communication avec Fapshi',
        details: process.env.NODE_ENV === 'development' ? err.message : null
      });
    } finally {
      clearTimeout(timeout);
    }

  } catch (err) {
    console.error('❌ ERREUR GÉNÉRALE DANS HANDLER:', err.stack);
    // Gestion des erreurs inattendues de la fonction elle-même
    return res.status(500).json({
      error: 'Erreur serveur interne',
      details: process.env.NODE_ENV === 'development' ? err.message : null
    });
  }
}
