// netlify/functions/create-fapshi-checkout.js

exports.handler = async (event) => {
  // 1) Pour voir exactement ce qui est dans les env vars
  console.log(">>> process.env.FAPSHI_API_USER  =", process.env.FAPSHI_API_USER);
  console.log(">>> process.env.FAPSHI_SECRET_KEY =", process.env.FAPSHI_SECRET_KEY);

  // 2) N’accepter que POST
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      body: JSON.stringify({ error: 'Utilise POST, pas ' + event.httpMethod })
    };
  }

  // 3) Récupérer les variables d’environnement
  const API_USER   = process.env.FAPSHI_API_USER;
  const SECRET_KEY = process.env.FAPSHI_SECRET_KEY;
  
  // 4) Vérifier qu’elles ne sont pas vides
  if (!API_USER || !SECRET_KEY) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Clés Fapshi manquantes ou vides' })
    };
  }

  // 5) Parser le JSON envoyé par le front-end
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

  // 6) Définir le bon endpoint Fapshi
  const apiEndpoint = 'https://live.fapshi.com/initiate-pay';

  // 7) Construire le payload
  const payload = {
    amount:       amount,
    currency:     currency,
    description:  description || 'Paiement Social Boost Horizon',
    redirect_url: redirectUrl
  };

  // 8) Logs pour vérifier ce qu’on envoie
  console.log(">>> API Endpoint :", apiEndpoint);
  console.log(">>> Payload      :", JSON.stringify(payload));
  console.log(">>> Header apiuser  envoyé :", API_USER);
  console.log(">>> Header secretkey envoyé :", SECRET_KEY);

  try {
    // 9) Faire l’appel POST vers Fapshi
    const response = await fetch(apiEndpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apiuser': API_USER,
        'secretkey': SECRET_KEY
      },
      body: JSON.stringify(payload)
    });

    // 10) Lire la réponse brute
    const rawText = await response.text();
    const contentType = response.headers.get('content-type') || '';

    console.log(">>> Fapshi HTTP status       =", response.status);
    console.log(">>> Fapshi content-type      =", contentType);
    console.log(">>> Fapshi raw response      =", rawText);

    // 11) Si ce n’est pas du JSON, renvoyer une 502 pour debugging
    if (!contentType.includes('application/json')) {
      return {
        statusCode: 502,
        body: JSON.stringify({
          error:   'Fapshi a renvoyé un contenu non JSON',
          details: rawText
        })
      };
    }

    // 12) Parser le JSON renvoyé
    let respJson;
    try {
      respJson = JSON.parse(rawText);
    } catch {
      return {
        statusCode: 502,
        body: JSON.stringify({
          error:   'Impossible de parser le JSON renvoyé par Fapshi',
          details: rawText
        })
      };
    }

    // 13) Si l’API Fapshi renvoie une erreur (>=400), transmettre
    if (!response.ok) {
      return {
        statusCode: response.status,
        body: JSON.stringify({ error: respJson })
      };
    }

    // 14) Succès : renvoyer l’URL de checkout
    return {
      statusCode: 200,
      body: JSON.stringify({ checkoutUrl: respJson.data.url })
    };

  } catch (error) {
    console.log(">>> Erreur fetch vers Fapshi :", error.message);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: error.message })
    };
  }
};
