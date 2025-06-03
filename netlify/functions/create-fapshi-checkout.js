// netlify/functions/create-fapshi-checkout.js

exports.handler = async (event) => {
  // 1) N’accepte que POST
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      body: JSON.stringify({ error: 'Utilise POST, pas ' + event.httpMethod })
    };
  }

  // 2) Lire les clés depuis les variables d’environnement Netlify
  const API_USER   = process.env.FAPSHI_API_USER;
  const SECRET_KEY = process.env.FAPSHI_SECRET_KEY;

  if (!API_USER || !SECRET_KEY) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Clés Fapshi non définies en variables d’environnement' })
    };
  }

  // 3) Parser le body JSON envoyé par le front-end
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

  // 4) POINT D’ACCÈS FAPSHI PRODUCTION (LIVE)
  const apiEndpoint = 'https://live.fapshi.com/initiate-pay';

  // 5) Construire le payload
  const payload = {
    amount: amount,
    currency: currency,
    description: description || 'Achat produit',
    redirect_url: redirectUrl
  };

  try {
    // 6) Appel à l’API Fapshi live
    const response = await fetch(apiEndpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${SECRET_KEY}`,
        'X-Fapshi-Api-User': API_USER
      },
      body: JSON.stringify(payload)
    });

    // 7) Lire la réponse brute (texte), peu importe son content-type
    const rawText = await response.text();
    const contentType = response.headers.get('content-type') || '';

    // 8) Si ce n’est pas du JSON, renvoyer un 502 avec le HTML ou le texte brut
    if (!contentType.includes('application/json')) {
      return {
        statusCode: 502,
        body: JSON.stringify({
          error: 'L’API Fapshi production a renvoyé un contenu non JSON',
          details: rawText
        })
      };
    }

    // 9) Parser le JSON
    let respJson;
    try {
      respJson = JSON.parse(rawText);
    } catch (err) {
      return {
        statusCode: 502,
        body: JSON.stringify({
          error: 'Impossible de parser le JSON renvoyé par Fapshi production',
          details: rawText
        })
      };
    }

    // 10) Si Fapshi renvoie une erreur (response.ok false), renvoyer tel quel
    if (!response.ok) {
      return {
        statusCode: response.status,
        body: JSON.stringify({ error: respJson })
      };
    }

    // 11) Succès : renvoyer l’URL de checkout
    return {
      statusCode: 200,
      body: JSON.stringify({ checkoutUrl: respJson.data.url })
    };

  } catch (error) {
    // 12) Erreur réseau ou autre
    return {
      statusCode: 500,
      body: JSON.stringify({ error: error.message })
    };
  }
};
