// netlify/functions/create-fapshi-checkout.js

exports.handler = async (event) => {
  // 1) Logs pour voir la valeur effective des variables d’environnement
  console.log(">>> process.env.FAPSHI_API_USER   =", JSON.stringify(process.env.FAPSHI_API_USER));
  console.log(">>> process.env.FAPSHI_SECRET_KEY  =", JSON.stringify(process.env.FAPSHI_SECRET_KEY));

  // 2) N’accepte que la méthode POST
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      body: JSON.stringify({ error: 'Utilise POST, pas ' + event.httpMethod })
    };
  }

  // 3) Récupérer les clés Fapshi
  const API_USER   = process.env.FAPSHI_API_USER;
  const SECRET_KEY = process.env.FAPSHI_SECRET_KEY;
  if (!API_USER || !SECRET_KEY) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Clés Fapshi manquantes ou vides' })
    };
  }

  // 4) Parser le JSON envoyé par le front‑end
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
      body: JSON.stringify({
        error: 'Champs requis manquants : amount, currency, redirectUrl'
      })
    };
  }

  // 5) Définir l’endpoint en production
  const apiEndpoint = 'https://live.fapshi.com/initiate-pay';

  // 6) Construire le payload
  const payload = {
    amount:       amount,
    currency:     currency,
    description:  description || 'Paiement Social Boost Horizon',
    redirect_url: redirectUrl
  };

  // 7) Logs pour le debug
  console.log(">>> API Endpoint   =", apiEndpoint);
  console.log(">>> Payload        =", JSON.stringify(payload));
  console.log(">>> Header apiuser =", API_USER);
  console.log(">>> Header apikey  =", SECRET_KEY);

  try {
    // 8) Appel POST vers Fapshi avec les bons headers
    const response = await fetch(apiEndpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apiuser': API_USER,
        'apikey': SECRET_KEY
      },
      body: JSON.stringify(payload)
    });

    // 9) Lire la réponse brute
    const rawText = await response.text();
    const contentType = response.headers.get('content-type') || '';

    console.log(">>> Fapshi HTTP status      =", response.status);
    console.log(">>> Fapshi content-type     =", contentType);
    console.log(">>> Fapshi raw response     =", rawText);

    // 10) Si ce n’est pas du JSON, renvoyer la 502 avec le HTML pour debug
    if (!contentType.includes('application/json')) {
      return {
        statusCode: 502,
        body: JSON.stringify({
          error:   'Fapshi a renvoyé un contenu non JSON',
          details: rawText
        })
      };
    }

    // 11) Parser le JSON renvoyé par Fapshi
    let respJson;
    try {
      respJson = JSON.parse(rawText);
    } catch (err) {
      return {
        statusCode: 502,
        body: JSON.stringify({
          error:   'Impossible de parser le JSON renvoyé par Fapshi',
          details: rawText
        })
      };
    }

    // 12) Si l’API Fapshi renvoie un code d’erreur (4xx/5xx), on renvoie directement ce JSON
    if (!response.ok) {
      return {
        statusCode: response.status,
        body: JSON.stringify(respJson)
      };
    }

    // 13) Si `respJson.data` existe, renvoyer son champ `url`
    if (respJson.data && respJson.data.url) {
      return {
        statusCode: 200,
        body: JSON.stringify({ checkoutUrl: respJson.data.url })
      };
    }

    // 14) Sinon, la structure JSON a changé : on renvoie l’objet complet pour debug
    return {
      statusCode: 502,
      body: JSON.stringify({
        error:   'Réponse inattendue de Fapshi (pas de data.url)',
        details: respJson
      })
    };

  } catch (error) {
    console.log(">>> Erreur fetch:", error.message);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: error.message })
    };
  }
};
