// netlify/functions/create-fapshi-checkout.js

exports.handler = async (event) => {
  // 1) Logs pour vérifier les variables d’environnement
  console.log(">>> process.env.FAPSHI_API_USER   =", JSON.stringify(process.env.FAPSHI_API_USER));
  console.log(">>> process.env.FAPSHI_SECRET_KEY  =", JSON.stringify(process.env.FAPSHI_SECRET_KEY));
  console.log(">>> process.env.FAPSHI_WEBHOOK_URL =", JSON.stringify(process.env.FAPSHI_WEBHOOK_URL));

  // 2) N’accepte que la méthode POST
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      body: JSON.stringify({ error: 'Utilise POST, pas ' + event.httpMethod })
    };
  }

  // 3) Récupérer les clés Fapshi & l’URL du webhook stockées dans Netlify
  const API_USER    = process.env.FAPSHI_API_USER;
  const SECRET_KEY  = process.env.FAPSHI_SECRET_KEY;
  const WEBHOOK_URL = process.env.FAPSHI_WEBHOOK_URL; // Ajouté : URL de ton webhook Fapshi
  if (!API_USER || !SECRET_KEY || !WEBHOOK_URL) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Clés Fapshi ou webhook manquant' })
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

  // 4.1. Récupérer amount, currency, description, redirectUrl, uid
  const { amount, currency, description, redirectUrl, uid } = bodyData;
  if (!amount || !currency || !redirectUrl || !uid) {
    return {
      statusCode: 400,
      body: JSON.stringify({
        error: 'Champs requis manquants : amount, currency, redirectUrl, uid'
      })
    };
  }

  // 5) Endpoint de production pour Fapshi
  const apiEndpoint = 'https://live.fapshi.com/initiate-pay';

  // 6) Construire le payload JSON en ajoutant metadata & webhook_url
  const payload = {
    amount:       amount,
    currency:     currency,
    description:  description || 'Paiement Social Boost Horizon',
    redirect_url: redirectUrl,

    // Ajouts nécessaires pour le webhook et l’UID
    webhook_url: WEBHOOK_URL,
    metadata: { userId: uid }
  };

  // 7) Logs de débogage
  console.log(">>> API Endpoint      =", apiEndpoint);
  console.log(">>> Payload           =", JSON.stringify(payload));
  console.log(">>> Header apiuser    =", API_USER);
  console.log(">>> Header apikey     =", SECRET_KEY);

  try {
    // 8) Faire l’appel POST vers Fapshi
    const response = await fetch(apiEndpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apiuser':       API_USER,
        'apikey':        SECRET_KEY
      },
      body: JSON.stringify(payload)
    });

    // 9) Lire la réponse brute (texte)
    const rawText = await response.text();
    const contentType = response.headers.get('content-type') || '';

    console.log(">>> Fapshi HTTP status     =", response.status);
    console.log(">>> Fapshi content-type    =", contentType);
    console.log(">>> Fapshi raw response    =", rawText);

    // 10) Si le contenu n’est pas JSON, renvoyer la 502 pour debug
    if (!contentType.includes('application/json')) {
      return {
        statusCode: 502,
        body: JSON.stringify({
          error:   'Fapshi a renvoyé un contenu non JSON',
          details: rawText
        })
      };
    }

    // 11) Parser le JSON
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

    // 12) Si la réponse HTTP n’est pas OK (4xx/5xx), renvoyer ce JSON d’erreur
    if (!response.ok) {
      return {
        statusCode: response.status,
        body: JSON.stringify(respJson)
      };
    }

    // 13) Si le JSON contient data.url (ancienne structure), on l’utilise
    if (respJson.data && respJson.data.url) {
      return {
        statusCode: 200,
        body: JSON.stringify({ checkoutUrl: respJson.data.url })
      };
    }

    // 14) Sinon, si le JSON contient link, on l’utilise
    if (respJson.link) {
      return {
        statusCode: 200,
        body: JSON.stringify({ checkoutUrl: respJson.link })
      };
    }

    // 15) Sinon, structure inattendue : renvoyer tout pour debug
    return {
      statusCode: 502,
      body: JSON.stringify({
        error:   'Réponse inattendue de Fapshi (ni data.url ni link)',
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
