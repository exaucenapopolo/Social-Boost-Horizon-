// netlify/functions/create-fapshi-checkout.js

// Pour Node.js sans fetch global, décommenter la ligne ci‑dessous :
const fetch = (...args) => import('node-fetch').then(({ default: f }) => f(...args));

exports.handler = async (event) => {
  // 1) Vérifier que la méthode est POST
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
      body: JSON.stringify({
        error: 'Clés Fapshi manquantes : vérifie FAPSHI_API_USER et FAPSHI_SECRET_KEY'
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

  // 4) Endpoint REST officiel Fapshi (production)
  const apiEndpoint = 'https://api.fapshi.com/api/v1/checkout/create';

  // 5) Construire le payload JSON
  const payload = {
    amount:       amount,
    currency:     currency,
    description:  description || 'Paiement Social Boost Horizon',
    redirect_url: redirectUrl
  };

  try {
    // 6) Appeler l’API Fapshi avec les headers “x-api-user” et “x-api-key”
    const response = await fetch(apiEndpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-user': API_USER,
        'x-api-key': SECRET_KEY
      },
      body: JSON.stringify(payload)
    });

    // 7) Récupérer la réponse brute (texte)
    const rawText = await response.text();
    const contentType = response.headers.get('content-type') || '';

    // 8) Si le contenu n’est pas JSON, renvoyer le HTML pour diagnostiquer
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

    // 10) Si Fapshi renvoie une erreur HTTP (>=400), transmettre ce JSON d’erreur
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
