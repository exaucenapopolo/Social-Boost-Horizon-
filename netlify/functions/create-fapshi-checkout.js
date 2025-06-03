// netlify/functions/create-fapshi-checkout.js

exports.handler = async (event) => {
  // 1) N’acceptez que POST
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      body: JSON.stringify({ error: 'Utilise POST, pas ' + event.httpMethod })
    };
  }

  // 2) Lire les clés dans les variables d’environnement Netlify
  const API_USER   = process.env.FAPSHI_API_USER;    // ex. "4fda5adb-..."
  const SECRET_KEY = process.env.FAPSHI_SECRET_KEY;  // ex. "FAK_6dbefae..."
  console.log(">>> API_USER   =", API_USER);
  console.log(">>> SECRET_KEY =", SECRET_KEY);

  if (!API_USER || !SECRET_KEY) {
    return {
      statusCode: 500,
      body: JSON.stringify({
        error: 'Clés Fapshi manquantes : vérifie FAPSHI_API_USER & FAPSHI_SECRET_KEY'
      })
    };
  }

  // 3) Parser le JSON envoyé par le front-end
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

  // 4) ENDPOINT CORRECT pour créer un paiement en prod
  const apiEndpoint = 'https://live.fapshi.com/initiate-pay';

  // 5) Construire le payload JSON attendu
  const payload = {
    amount:       amount,
    currency:     currency,
    description:  description || 'Paiement Social Boost Horizon',
    redirect_url: redirectUrl
  };

  console.log(">>> API Endpoint =", apiEndpoint);
  console.log(">>> Payload      =", JSON.stringify(payload));

  try {
    // 6) Appeler l’API Fapshi en envoyant EXACTEMENT "apiuser" et "secretkey"
    const response = await fetch(apiEndpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apiuser': API_USER,
        'secretkey': SECRET_KEY
      },
      body: JSON.stringify(payload)
    });

    // 7) Lire la réponse brute (texte)
    const rawText = await response.text();
    const contentType = response.headers.get('content-type') || '';

    console.log(">>> Fapshi status       =", response.status);
    console.log(">>> Fapshi content-type =", contentType);
    console.log(">>> Fapshi raw response =", rawText);

    // 8) Si ce n’est pas du JSON, renvoyer une 502 avec le HTML pour debugger
    if (!contentType.includes('application/json')) {
      return {
        statusCode: 502,
        body: JSON.stringify({
          error:   'Fapshi a renvoyé un contenu non JSON',
          details: rawText
        })
      };
    }

    // 9) Parser le JSON renvoyé
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

    // 10) Si l’API renvoie une erreur (status >= 400), transmettre ce JSON
    if (!response.ok) {
      return {
        statusCode: response.status,
        body: JSON.stringify({ error: respJson })
      };
    }

    // 11) Succès : renvoyer l’URL de checkout au frontend
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
