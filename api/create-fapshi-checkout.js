// api/create-fapshi-checkout.js

// 1) Pour Node 16 sur Vercel, importer fetch
const fetch = require('node-fetch');

exports.handler = async (event) => {
  // 🪵 Logs d’entrée pour diagnostiquer
  console.log(">>> EVENT RECEIVED:", JSON.stringify({
    httpMethod: event.httpMethod,
    headers: event.headers,
    body: event.body
  }));
  console.log(">>> ENV:", {
    FAPSHI_API_USER: process.env.FAPSHI_API_USER,
    FAPSHI_SECRET_KEY: !!process.env.FAPSHI_SECRET_KEY,
    FAPSHI_WEBHOOK_URL: process.env.FAPSHI_WEBHOOK_URL
  });

  try {
    // 2) Accepter uniquement POST
    if (event.httpMethod !== 'POST') {
      return { statusCode: 405, body: 'Use POST only' };
    }

    // 3) Récupérer variables d’environnement
    const API_USER    = process.env.FAPSHI_API_USER;
    const SECRET_KEY  = process.env.FAPSHI_SECRET_KEY;
    const WEBHOOK_URL = process.env.FAPSHI_WEBHOOK_URL;
    if (!API_USER || !SECRET_KEY || !WEBHOOK_URL) {
      console.error('Missing env vars:', { API_USER, SECRET_KEY, WEBHOOK_URL });
      return {
        statusCode: 500,
        body: JSON.stringify({ error: 'Payment credentials or webhook URL missing' })
      };
    }

    // 4) Parser le corps
    let body;
    try {
      body = JSON.parse(event.body);
    } catch (err) {
      console.error('JSON parse error:', err);
      return { statusCode: 400, body: JSON.stringify({ error: 'Invalid JSON' }) };
    }

    const { amount, currency, description, redirectUrl, uid } = body;
    if (!amount || !currency || !redirectUrl || !uid) {
      console.error('Missing fields in payload:', body);
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'Missing amount, currency, redirectUrl or uid' })
      };
    }

    // 5) Construire le payload pour Fapshi
    const payload = {
      amount,
      currency,
      description: description || 'Paiement Social Boost Horizon',
      redirect_url: redirectUrl,
      webhook_url:  WEBHOOK_URL,
      metadata:     { userId: uid }
    };
    console.log('>>> Payload to Fapshi:', JSON.stringify(payload));

    // 6) Appel à l’API Fapshi
    const response = await fetch('https://live.fapshi.com/initiate-pay', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apiuser':       API_USER,
        'apikey':        SECRET_KEY
      },
      body: JSON.stringify(payload)
    });

    const rawText = await response.text();
    const contentType = response.headers.get('content-type') || '';
    console.log('>>> Fapshi status:', response.status, 'content-type:', contentType);
    console.log('>>> Fapshi raw response:', rawText);

    if (!contentType.includes('application/json')) {
      return {
        statusCode: 502,
        body: JSON.stringify({ error: 'Non-JSON response from Fapshi', details: rawText })
      };
    }

    const respJson = JSON.parse(rawText);
    if (!response.ok) {
      console.error('Fapshi returned error status:', response.status, respJson);
      return { statusCode: response.status, body: JSON.stringify(respJson) };
    }

    // 7) Renvoyer l’URL de checkout
    const checkoutUrl = respJson.data?.url || respJson.link;
    if (!checkoutUrl) {
      console.error('Unexpected Fapshi response structure', respJson);
      return {
        statusCode: 502,
        body: JSON.stringify({ error: 'Unexpected response from Fapshi', details: respJson })
      };
    }

    return {
      statusCode: 200,
      body: JSON.stringify({ checkoutUrl })
    };

  } catch (err) {
    // 🛑 Log d’erreur complet
    console.error('❌ Unhandled error in create-fapshi-checkout:', err.stack || err);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Server error', details: err.message })
    };
  }
};
