// netlify/functions/create-fapshi-checkout.js

exports.handler = async (event) => {
  // 1) N’accepte que POST
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      body: JSON.stringify({ error: 'Utilise POST, pas ' + event.httpMethod })
    };
  }

  // 2) Lire les clés depuis Netlify (variables d’environnement)
  const API_USER   = process.env.FAPSHI_API_USER;
  const SECRET_KEY = process.env.FAPSHI_SECRET_KEY;

  if (!API_USER || !SECRET_KEY) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Clés Fapshi non définies (Vérifie FAPSHI_API_USER & FAPSHI_SECRET_KEY)' })
    };
  }

  // 3) Parser le body JSON envoyé par le frontend
  let bodyData;
  try {
    bodyData = JSON.parse(event.body);
  } catch {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: 'JSON mal formé' })
    };
  }

  const { amount, currency, description, redirectUrl } = bodyData;
  if (!amount || !currency || !redirectUrl) {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: 'Champs requis : amount, currency, redirectUrl' })
    };
  }

  // 4) URL API Fapshi (production)
  const apiEndpoint = 'https://live.fapshi.com/api/payments/init';

  // 5) Construire le payload
  const payload = {
    amount: amount,
    currency: currency,
    description: description || 'Paiement Fapshi',
    redirect_url: redirectUrl
  };

  try {
    // 6) Appel POST vers Fapshi avec le header "apikey" (clé secrète) et "apiuser"
    const response = await fetch(apiEndpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': SECRET_KEY,    // clé secrète attendue par Fapshi
        'apiuser': API_USER      // identifiant API User
      },
      body: JSON.stringify(payload)
    });

    // 7) Lire la réponse brute
    const rawText = await response.text();
    const contentType = response.headers.get('content-type') || '';

    // 8) Si la réponse n’est pas JSON, on renvoie l’erreur brute
    if (!contentType.includes('application/json')) {
      return {
        statusCode: 502,
        body: JSON.stringify({
          error: 'Fapshi a renvoyé un contenu non JSON',
          details: rawText
        })
      };
    }

    // 9) Parser le JSON
    let respJson;
    try {
      respJson = JSON.parse(rawText);
    } catch {
      return {
        statusCode: 502,
        body: JSON.stringify({
          error: 'Impossible de parser le JSON depuis Fapshi',
          details: rawText
        })
      };
    }

    // 10) Si Fapshi renvoie une erreur (HTTP >= 400)
    if (!response.ok) {
      return {
        statusCode: response.status,
        body: JSON.stringify({ error: respJson })
      };
    }

    // 11) Succès : retourner l’URL de checkout
    return {
      statusCode: 200,
      body: JSON.stringify({ checkoutUrl: respJson.data.url })
    };

  } catch (error) {
    // 12) Erreur réseau ou inattendue
    return {
      statusCode: 500,
      body: JSON.stringify({ error: error.message })
    };
  }
};
