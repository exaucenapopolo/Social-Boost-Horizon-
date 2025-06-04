// netlify/functions/create-fapshi-checkout.js

exports.handler = async (event) => {
  // 1) Afficher la valeur brute des variables d’environnement
  console.log(">>> process.env.FAPSHI_API_USER   =", JSON.stringify(process.env.FAPSHI_API_USER));
  console.log(">>> process.env.FAPSHI_SECRET_KEY  =", JSON.stringify(process.env.FAPSHI_SECRET_KEY));

  // 2) N’accepter que la méthode POST
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      body: JSON.stringify({ error: 'Utilise POST, pas ' + event.httpMethod })
    };
  }

  // 3) Récupérer API_USER et SECRET_KEY depuis Netlify
  const API_USER   = process.env.FAPSHI_API_USER;   // doît exister et être correct
  const SECRET_KEY = process.env.FAPSHI_SECRET_KEY; // doît exister et être correct

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

  // 5) Endpoint de production pour créer un checkout
  const apiEndpoint = 'https://live.fapshi.com/initiate-pay';

  // 6) Construire le payload au format attendu (redirect_url avec underscore)
  const payload = {
    amount:       amount,
    currency:     currency,
    description:  description || 'Paiement Social Boost Horizon',
    redirect_url: redirectUrl
  };

  // 7) Logs de débogage pour vérifier l’appel
  console.log(">>> API Endpoint  =", apiEndpoint);
  console.log(">>> Payload       =", JSON.stringify(payload));
  console.log(">>> Header apiuser envoyé =", API_USER);
  console.log(">>> Header apikey   envoyé =", SECRET_KEY);

  try {
    // 8) Faire l’appel POST vers Fapshi en envoyant apiuser + apikey
    const response = await fetch(apiEndpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apiuser': API_USER,
        'apikey': SECRET_KEY
      },
      body: JSON.stringify(payload)
    });

    // 9) Lire la réponse brute (texte)
    const rawText = await response.text();
    const contentType = response.headers.get('content-type') || '';

    console.log(">>> Fapshi HTTP status      =", response.status);
    console.log(">>> Fapshi content-type     =", contentType);
    console.log(">>> Fapshi raw response     =", rawText);

    // 10) Si la réponse n’est pas du JSON, renvoyer le HTML pour déboguer
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
    } catch {
      return {
        statusCode: 502,
        body: JSON.stringify({
          error:   'Impossible de parser le JSON renvoyé par Fapshi',
          details: rawText
        })
      };
    }

    // 12) Si l’API renvoie un code d’erreur HTTP (>=400), transmettre ce JSON
    if (!response.ok) {
      return {
        statusCode: response.status,
        body: JSON.stringify({ error: respJson })
      };
    }

    // 13) Succès : renvoyer l’URL du checkout au front‑end
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
