// api/create-fapshi-checkout.js

import fetch from 'node-fetch';

export default async function handler(req, res) {
  console.log(">>> REQUÊTE REÇUE :", {
    method: req.method,
    headers: req.headers,
    body: req.body
  });

  console.log(">>> ENV CHECK:", {
    FAPSHI_API_USER: !!process.env.FAPSHI_API_USER,
    FAPSHI_SECRET_KEY: !!process.env.FAPSHI_SECRET_KEY,
    FAPSHI_WEBHOOK_URL: !!process.env.FAPSHI_WEBHOOK_URL
  });

  try {
    if (req.method !== 'POST') {
      return res.status(405).json({ error: 'Utilise la méthode POST uniquement' });
    }

    const API_USER    = process.env.FAPSHI_API_USER;
    const SECRET_KEY  = process.env.FAPSHI_SECRET_KEY;
    const WEBHOOK_URL = process.env.FAPSHI_WEBHOOK_URL;

    if (!API_USER || !SECRET_KEY || !WEBHOOK_URL) {
      console.error('CRITICAL: Missing env vars');
      return res.status(500).json({ error: 'Configuration serveur incomplète' });
    }

    const { amount, currency, redirectUrl, uid } = req.body || {};
    if (!amount || !currency || !redirectUrl || !uid) {
      return res.status(400).json({ error: 'Paramètres manquants' });
    }

    const payload = {
      amount,
      currency,
      description: 'Paiement Social Boost Horizon',
      redirect_url: redirectUrl,
      webhook_url:  WEBHOOK_URL,
      metadata: { userId: uid }
    };

    // Debug
    console.log(">>> Payload:", JSON.stringify(payload, null, 2));

    // Timeout protection
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);

    try {
      const response = await fetch('https://live.fapshi.com/initiate-pay', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apiuser': API_USER,
          'apikey': SECRET_KEY
        },
        body: JSON.stringify(payload),
        signal: controller.signal
      });

      const rawText = await response.text();
      console.log('>>> Fapshi réponse brute:', response.status, rawText);

      const contentType = response.headers.get('content-type') || '';
      if (!contentType.includes('application/json')) {
        return res.status(502).json({ error: 'Fapshi a renvoyé un contenu non JSON' });
      }

      const respJson = JSON.parse(rawText);

      if (!response.ok) {
        return res.status(response.status).json(respJson);
      }

      const checkoutUrl = respJson.data?.url || respJson.link;
      if (!checkoutUrl) {
        return res.status(502).json({ error: 'Réponse inattendue de Fapshi', details: respJson });
      }

      return res.status(200).json({ checkoutUrl });

    } catch (err) {
      if (err.name === 'AbortError') {
        console.error('⏱️ Fapshi API timeout');
        return res.status(504).json({ error: 'Timeout Fapshi' });
      }
      throw err;
    } finally {
      clearTimeout(timeout);
    }

  } catch (err) {
    console.error('❌ ERREUR FATALE:', err.stack);
    return res.status(500).json({
      error: 'Erreur serveur',
      details: process.env.NODE_ENV === 'development' ? err.message : null
    });
  }
}
