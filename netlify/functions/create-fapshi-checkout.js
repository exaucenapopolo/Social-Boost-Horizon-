// netlify/functions/create-fapshi-checkout.js

// Si ton environnement Node n’a pas fetch global (versions Netlify antérieures à Node 18),
// décommente cette ligne :
// const fetch = (...args) => import('node-fetch').then(({ default: f }) => f(...args));

exports.handler = async (event) => {
  // 1) Vérifier que la méthode est bien POST
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      body: JSON.stringify({ error: 'Utilise POST, pas ' + event.httpMethod })
    };
  }

  // 2) Récupérer les clés dans les variables d’environnement Netlify
  const API_USER   = process.env.FAPSHI_API_USER;    // Ne pas renommer
  const SECRET_KEY = process.env.FAPSHI_SECRET_KEY;  // Ne pas renommer

  if (!API_USER || !SECRET_KEY) {
    return {
      statusCode: 500,
      body: JSON.stringify({
        error: 'Clés Fapshi manquantes : vérifie FAPSHI_API_USER et FAPSHI_SECRET_KEY'
      })
    };
  }

  // 3) Parser le JSON envoyé par le client
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

  // 4) POINT D’ACCÈS OFFICIEL REST EN PRODUCTION
  const apiEndpoint = 'https://api.fapshi.com/api/v1/checkout/create';

  // 5) Construire le payload JSON attendu par Fapshi
  const payload = {
    amount:        amount,
    currency:      currency,
    description:   description || 'Paiement Social Boost Horizon',
    redirect_url:  redirectUrl
  };

  try {
    // 6) Appel POST vers l’API Fapshi avec les headers exacts “x-api-user” et “x-api-key”
    const response = await fetch(apiEndpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-user': API_USER,   // <— clé utilisateur Fapshi
        'x-api-key': SECRET_KEY   // <— clé secrète Fapshi
      },
      body: JSON.stringify(payload)
    });

    // 7) Lire la réponse brute comme texte (peu importe le content-type)
    const rawText = await response.text();
    const contentType = response.headers.get('content-type') || '';

    // 8) Si la réponse n’est pas du JSON, renvoyer un 502 avec le HTML ou le texte brut
    if (!contentType.includes('application/json')) {
      return {
        statusCode: 502,
        body: JSON.stringify({
          error:   'Fapshi a renvoyé un contenu non JSON',
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
          error:   'Impossible de parser le JSON renvoyé par Fapshi',
          details: rawText
        })
      };
    }

    // 10) Si Fapshi retourne une erreur (4xx/5xx), transmettre ce JSON d’erreur
    if (!response.ok) {
      return {
        statusCode: response.status,
        body: JSON.stringify({ error: respJson })
      };
    }

    // 11) Succès : extraire et renvoyer checkoutUrl au front-end
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
