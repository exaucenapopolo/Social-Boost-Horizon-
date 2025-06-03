// netlify/functions/create-fapshi-checkout.js
const fetch = (...args) => import('node-fetch').then(({ default: f }) => f(...args));

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Utilise POST, pas ' + event.httpMethod }) };
  }

  const API_USER   = process.env.FAPSHI_API_USER;
  const SECRET_KEY = process.env.FAPSHI_SECRET_KEY;
  console.log(">>> FAPSHI_API_USER  =", API_USER);
  console.log(">>> FAPSHI_SECRET_KEY=", SECRET_KEY);

  if (!API_USER || !SECRET_KEY) {
    return { statusCode: 500, body: JSON.stringify({ error: 'Clés Fapshi manquantes' }) };
  }

  let bodyData;
  try { bodyData = JSON.parse(event.body); }
  catch {
    return { statusCode: 400, body: JSON.stringify({ error: 'JSON mal formé' }) };
  }

  const { amount, currency, description, redirectUrl } = bodyData;
  if (!amount || !currency || !redirectUrl) {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: 'Champs requis manquants : amount, currency, redirectUrl' })
    };
  }

  const apiEndpoint = 'https://api.fapshi.com/api/v1/checkout/create';
  const payload = { amount, currency, description: description || 'Paiement', redirect_url: redirectUrl };

  console.log(">>> API Endpoint      =", apiEndpoint);
  console.log(">>> Payload           =", JSON.stringify(payload));
  console.log(">>> Headers envoyés   =", JSON.stringify({
    'Content-Type': 'application/json',
    'x-api-user': API_USER,
    'x-api-key': SECRET_KEY
  }));

  try {
    const response = await fetch(apiEndpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-user': API_USER,
        'x-api-key': SECRET_KEY
      },
      body: JSON.stringify(payload)
    });

    const rawText = await response.text();
    console.log(">>> Fapshi response HTTP status =", response.status);
    console.log(">>> Fapshi response Content-Type =", response.headers.get("content-type"));
    console.log(">>> Fapshi response brute =", rawText);

    const contentType = response.headers.get('content-type') || '';
    if (!contentType.includes('application/json')) {
      return {
        statusCode: 502,
        body: JSON.stringify({ error: 'Fapshi renvoyé contenu non JSON', details: rawText })
      };
    }

    let respJson;
    try { respJson = JSON.parse(rawText); }
    catch {
      return {
        statusCode: 502,
        body: JSON.stringify({ error: 'Impossible de parser JSON', details: rawText })
      };
    }

    if (!response.ok) {
      return { statusCode: response.status, body: JSON.stringify({ error: respJson }) };
    }

    return {
      statusCode: 200,
      body: JSON.stringify({ checkoutUrl: respJson.data.url })
    };

  } catch (error) {
    console.log(">>> Erreur fetch:", error.message);
    return { statusCode: 500, body: JSON.stringify({ error: error.message }) };
  }
};
