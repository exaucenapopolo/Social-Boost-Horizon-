// netlify/functions/create-fapshi-checkout.js

exports.handler = async (event) => {
  // 1) S’assurer que la méthode est POST
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      body: JSON.stringify({ error: 'Utilise POST, pas ' + event.httpMethod })
    };
  }

  // 2) Récupérer les clés Fapshi depuis les variables d’environnement Netlify
  const API_USER   = process.env.FAPSHI_API_USER;    // Ne pas renommer
  const SECRET_KEY = process.env.FAPSHI_SECRET_KEY;  // Ne pas renommer

  if (!API_USER || !SECRET_KEY) {
    return {
      statusCode: 500,
      body: JSON.stringify({
        error: 'Clés Fapshi manquantes : vérifie FAPSHI_API_USER & FAPSHI_SECRET_KEY'
      })
    };
  }

  // 3) Parser le JSON envoyé par le front‑end
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

  // 4) Endpoint REST officiel Fapshi (production)
  const apiEndpoint = 'https://api.fapshi.com/api/v1/checkout/create';

  // 5) Construire le payload JSON
  const payload = {
    amount:       amount,
    currency:     currency,
    description:  description || 'Paiement Social Boost Horizon',
    redirect_url: redirectUrl
  };

  // (logs de débogage — visibles dans Netlify Functions Logs)
  console.log(">>> API_USER  =", API_USER);
  console.log(">>> SECRET_KEY=", SECRET_KEY);
  console.log(">>> Endpoint   =", apiEndpoint);
  console.log(">>> Payload    =", JSON.stringify(payload));

  try {
    // 6) Appel POST vers Fapshi avec les headers “x-api-user” et “x-api-key”
    const response = await fetch(apiEndpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-user': API_USER,
        'x-api-key': SECRET_KEY
      },
      body: JSON.stringify(payload)
    });

    // 7) Lire la réponse brute (texte)
    const rawText = await response.text();
    const contentType = response.headers.get('content-type') || '';

    console.log(">>> Fapshi status        =", response.status);
    console.log(">>> Fapshi content-type  =", contentType);
    console.log(">>> Fapshi raw response  =", rawText);

    // 8) Si le contenu n’est pas JSON, renvoyer le HTML pour déboguer
    if (!contentType.includes('application/json')) {
      return {
        statusCode: 502,
        body: JSON.stringify({
          error:   'Fapshi a renvoyé un contenu non JSON',
          details: rawText
        })
      };
    }

    // 9) Parser le JSON renvoyé par Fapshi
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

    // 10) Si Fapshi retourne une erreur HTTP (4xx/5xx), transmettre ce JSON
    if (!response.ok) {
      return {
        statusCode: response.status,
        body: JSON.stringify({ error: respJson })
      };
    }

    // 11) Succès : renvoyer l’URL de checkout au front‑end
    return {
      statusCode: 200,
      body: JSON.stringify({ checkoutUrl: respJson.data.url })
    };

  } catch (error) {
    // 12) Erreur réseau ou inattendue
    console.log(">>> Erreur fetch:", error.message);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: error.message })
    };
  }
};
