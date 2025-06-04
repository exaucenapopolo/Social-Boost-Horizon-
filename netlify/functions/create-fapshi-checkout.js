// netlify/functions/create-fapshi-checkout.js

exports.handler = async (event) => {
  // Afficher en log la valeur exacte de l’API User et de la Secret Key
  console.log(">>> process.env.FAPSHI_API_USER   =", JSON.stringify(process.env.FAPSHI_API_USER));
  console.log(">>> process.env.FAPSHI_SECRET_KEY  =", JSON.stringify(process.env.FAPSHI_SECRET_KEY));

  // 1) Vérifier la méthode POST
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      body: JSON.stringify({ error: 'Utilise POST, pas ' + event.httpMethod })
    };
  }

  // 2) Récupérer les clés
  const API_USER   = process.env.FAPSHI_API_USER;
  const SECRET_KEY = process.env.FAPSHI_SECRET_KEY;

  if (!API_USER || !SECRET_KEY) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Clés Fapshi manquantes ou vides' })
    };
  }

  // 3) Parser le JSON du front-end
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

  // 4) Endpoint de production
  const apiEndpoint = 'https://live.fapshi.com/initiate-pay';

  // 5) Payload attendu (avec redirect_url underscore)
  const payload = {
    amount:       amount,
    currency:     currency,
    description:  description || 'Paiement Social Boost Horizon',
    redirect_url: redirectUrl
  };

  console.log(">>> API Endpoint  =", apiEndpoint);
  console.log(">>> Payload       =", JSON.stringify(payload));

  try {
    // 6) Envoyer la requête en testant plusieurs clés de header
    const response = await fetch(apiEndpoint, {
      method: 'POST',
      headers: {
        'Content-Type':    'application/json',
        // on envoie la même valeur sous plusieurs noms de header
        'apiuser':          API_USER,
        'APIUSER':          API_USER,
        'x-api-user':       API_USER,
        'X-API-USER':       API_USER,
        'secretkey':        SECRET_KEY,
        'SECRETKEY':        SECRET_KEY,
        'x-api-key':        SECRET_KEY,
        'X-API-KEY':        SECRET_KEY
      },
      body: JSON.stringify(payload)
    });

    // 7) Lire la réponse brute
    const rawText = await response.text();
    const contentType = response.headers.get('content-type') || '';

    console.log(">>> Fapshi HTTP status      =", response.status);
    console.log(">>> Fapshi content-type     =", contentType);
    console.log(">>> Fapshi raw response     =", rawText);

    // 8) Si ce n’est pas du JSON, renvoyer le HTML pour déboguer
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

    // 11) Succès : renvoyer l’URL de checkout au front-end
    return {
      statusCode: 200,
      body: JSON.stringify({ checkoutUrl: respJson.data.url })
    };

  } catch (error) {
    console.log(">>> Erreur fetch:", error.message);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: error.message })
    };
  }
};
