// netlify/functions/create-fapshi-checkout.js

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      body: JSON.stringify({ error: 'Utilise POST, pas ' + event.httpMethod })
    };
  }

  const API_USER = process.env.FAPSHI_API_USER;
  const SECRET_KEY = process.env.FAPSHI_SECRET_KEY;

  if (!API_USER || !SECRET_KEY) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Clés Fapshi non définies en variables d’environnement' })
    };
  }

  let bodyData;
  try {
    bodyData = JSON.parse(event.body);
  } catch (err) {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: 'JSON mal formé dans la requête' })
    };
  }

  const { amount, currency, description, redirectUrl } = bodyData;
  if (!amount || !currency || !redirectUrl) {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: 'Paramètres manquants : amount, currency ou redirectUrl' })
    };
  }

  // ⚠️ TU VEUX TESTER AVEC CE LIEN (attention, ce n’est probablement pas une API REST)
  const apiEndpoint = 'https://live.fapshi.com';

  const payload = {
    amount,
    currency,
    description: description || 'Achat produit',
    redirect_url: redirectUrl
  };

  try {
    console.log("Début de l'appel à https://live.fapshi.com ...");

    const response = await fetch(apiEndpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${SECRET_KEY}`,
        'X-Fapshi-Api-User': API_USER
      },
      body: JSON.stringify(payload)
    });

    const rawText = await response.text();
    const contentType = response.headers.get('content-type') || '';

    if (!contentType.includes('application/json')) {
      return {
        statusCode: 502,
        body: JSON.stringify({
          error: 'Fapshi (live.fapshi.com) a renvoyé un contenu non JSON',
          details: rawText
        })
      };
    }

    let respJson;
    try {
      respJson = JSON.parse(rawText);
    } catch (err) {
      return {
        statusCode: 502,
        body: JSON.stringify({
          error: 'Impossible de parser le JSON Fapshi',
          details: rawText
        })
      };
    }

    if (!response.ok) {
      return {
        statusCode: response.status,
        body: JSON.stringify({ error: respJson })
      };
    }

    return {
      statusCode: 200,
      body: JSON.stringify({ checkoutUrl: respJson.data.url })
    };

  } catch (error) {
    console.log("Erreur FETCH vers Fapshi :", error.message);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: error.message })
    };
  }
};
