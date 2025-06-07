// api/create-fapshi-checkout.js

// Si votre runtime Vercel est Node 16 ou inférieur, décommentez la ligne suivante :
// const fetch = require('node-fetch');

exports.handler = async (event) => {
  // 1) Vérifier POST
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Use POST only' };
  }

  // 2) Logs d’environnement
  console.log(">>> FAPSHI_API_USER   =", process.env.FAPSHI_API_USER);
  console.log(">>> FAPSHI_SECRET_KEY =", process.env.FAPSHI_SECRET_KEY);
  console.log(">>> FAPSHI_WEBHOOK_URL=", process.env.FAPSHI_WEBHOOK_URL);

  const API_USER   = process.env.FAPSHI_API_USER;
  const SECRET_KEY = process.env.FAPSHI_SECRET_KEY;
  const WEBHOOK_URL= process.env.FAPSHI_WEBHOOK_URL;
  if (!API_USER || !SECRET_KEY || !WEBHOOK_URL) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Missing Fapshi API credentials or webhook URL' })
    };
  }

  // 3) Parser le corps
  let body;
  try {
    body = JSON.parse(event.body);
  } catch {
    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid JSON' }) };
  }

  const { amount, currency, description, redirectUrl, uid } = body;
  if (!amount || !currency || !redirectUrl || !uid) {
    return {
      statusCode: 400,
      body: JSON.stringify({
        error: 'Required fields missing: amount, currency, redirectUrl, uid'
      })
    };
  }

  // 4) Construire le payload pour Fapshi
  const payload = {
    amount,
    currency,
    description: description || 'Paiement Social Boost Horizon',
    redirect_url: redirectUrl,       // doit être: https://social-boost-horizon-new-sbh.vercel.app/success.html
    webhook_url:  WEBHOOK_URL,       // doit être: https://social-boost-horizon-new-sbh.vercel.app/api/fapshi-webhook
    metadata:     { userId: uid }
  };
  console.log(">>> PAYLOAD ENVOYÉ À FAPSHI:", JSON.stringify(payload));

  // 5) Appel à l’API Fapshi
  try {
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
    console.log(">>> Fapshi status     =", response.status);
    console.log(">>> Fapshi content-type=", contentType);
    console.log(">>> Fapshi raw response=", rawText);

    if (!contentType.includes('application/json')) {
      return {
        statusCode: 502,
        body: JSON.stringify({ error: 'Non-JSON response from Fapshi', details: rawText })
      };
    }

    const respJson = JSON.parse(rawText);
    if (!response.ok) {
      return { statusCode: response.status, body: JSON.stringify(respJson) };
    }

    // 6) Renvoyer checkoutUrl
    if (respJson.data?.url) {
      return { statusCode: 200, body: JSON.stringify({ checkoutUrl: respJson.data.url }) };
    }
    if (respJson.link) {
      return { statusCode: 200, body: JSON.stringify({ checkoutUrl: respJson.link }) };
    }

    return {
      statusCode: 502,
      body: JSON.stringify({ error: 'Unexpected Fapshi response structure', details: respJson })
    };

  } catch (err) {
    console.error(">>> Erreur fetch:", err);
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
