// api/create-fapshi-checkout.js
import fetch from 'node-fetch';

export default async function handler(req, res) {
  console.log(">>> REQUEST RECEIVED:", {
    method: req.method,
    headers: req.headers,
    body: req.body
  });

  console.log(">>> ENV CHECK:", {
    FAPSHI_API_USER: !!process.env.FAPSHI_API_USER,
    FAPSHI_SECRET_KEY: !!process.env.FAPSHI_SECRET_KEY,
    FAPSHI_WEBHOOK_URL: !!process.env.FAPSHI_WEBHOOK_URL
  });

  // CORS headers
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version');

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  try {
    if (req.method !== 'POST') {
      return res.status(405).json({ error: 'Use POST only' });
    }

    const API_USER = process.env.FAPSHI_API_USER;
    const SECRET_KEY = process.env.FAPSHI_SECRET_KEY;
    const WEBHOOK_URL = process.env.FAPSHI_WEBHOOK_URL;

    if (!API_USER || !SECRET_KEY || !WEBHOOK_URL) {
      console.error('CRITICAL: Missing env vars');
      return res.status(500).json({ error: 'Configuration serveur incomplète' });
    }

    const { amount, currency, redirectUrl, uid } = req.body;
    if (!amount || !currency || !redirectUrl || !uid) {
      return res.status(400).json({ error: 'Paramètres manquants' });
    }

    const payload = {
      amount: parseFloat(amount),
      currency,
      description: 'Paiement Social Boost Horizon',
      redirect_url: redirectUrl,
      webhook_url: WEBHOOK_URL,
      metadata: { userId: uid }
    };

    console.log(">>> Payload envoyé à Fapshi:", payload);

    const response = await fetch('https://live.fapshi.com/initiate-pay', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apiuser': API_USER,
        'apikey': SECRET_KEY
      },
      body: JSON.stringify(payload),
      timeout: 8000
    });

    const rawText = await response.text();
    console.log('>>> Fapshi response:', response.status, rawText);

    let respJson;
    try {
      respJson = JSON.parse(rawText);
    } catch (err) {
      console.error('Erreur parsing JSON:', err);
      return res.status(502).json({ error: 'Réponse invalide du processeur' });
    }

    if (!response.ok) {
      console.error('Erreur Fapshi:', respJson);
      return res.status(response.status).json(respJson);
    }

    const checkoutUrl = respJson.data?.url || respJson.link || respJson.checkout_url;
    if (!checkoutUrl) {
      console.error('URL de checkout manquante:', respJson);
      return res.status(500).json({ error: 'URL de paiement manquante' });
    }

    return res.status(200).json({ checkoutUrl });

  } catch (err) {
    console.error('❌ ERREUR GRAVE:', err);
    return res.status(500).json({
      error: 'Erreur serveur',
      details: process.env.NODE_ENV === 'development' ? err.message : null
    });
  }
}
