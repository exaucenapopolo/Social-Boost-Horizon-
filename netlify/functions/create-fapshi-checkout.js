// netlify/functions/create-fapshi-checkout.js

// Si Node n’a pas fetch global (selon la version de Netlify),
// décommente la ligne suivante pour importer node-fetch :
// const fetch = (...args) => import('node-fetch').then(({ default: f }) => f(...args));

exports.handler = async (event) => {
  // 1) Vérifier la méthode POST
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      body: JSON.stringify({ error: 'Utilise POST, pas ' + event.httpMethod })
    };
  }

  // 2) Lire les variables d’environnement (clés Fapshi)
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

  // 3) Parser le JSON envoyé par le front‑end (font.html)
  let bodyData;
  try {
    bodyData = JSON.parse(event.body);
  } catch {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: 'JSON mal formé' })
    };
  }

  // 4) Récupérer les champs requis et optionnels
  const {
    amount,
    currency,
    description = 'Paiement Social Boost Horizon',
    redirectUrl,
    email,       // Optionnel
    externalId,  // Optionnel
    message      // Optionnel
  } = bodyData;

  if (!amount || !currency || !redirectUrl) {
    return {
      statusCode: 400,
      body: JSON.stringify({
        error: 'Champs requis manquants : amount, currency, redirectUrl'
      })
    };
  }

  // 5) Construire le payload JSON pour Fapshi
  // Inclure uniquement les clés non nulles
  const payload = {
    amount:       amount,
    currency:     currency,
    description:  description,
    redirect_url: redirectUrl
  };

  // Ajouter les champs optionnels s’ils sont définis
  if (email)       payload.email = email;
  if (externalId)  payload.externalId = externalId;
  if (message)     payload.message = message;

  // 6) URL de base pour l’API Fapshi (production)
  const apiEndpoint = 'https://live.fapshi.com/initiate-pay';

  try {
    // 7) Appel POST vers Fapshi avec les headers requis
    const response = await fetch(apiEndpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-user': API_USER,
        'x-api-key': SECRET_KEY
      },
      body: JSON.stringify(payload)
    });

    // 8) Lire la réponse brute (texte)
    const rawText = await response.text();
    const contentType = response.headers.get('content-type') || '';

    // 9) Si la réponse n’est pas du JSON, renvoyer la page d’erreur brute
    if (!contentType.includes('application/json')) {
      return {
        statusCode: 502,
        body: JSON.stringify({
          error: 'Fapshi a renvoyé un contenu non JSON',
          details: rawText
        })
      };
    }

    // 10) Parser le JSON renvoyé par Fapshi
    let respJson;
    try {
      respJson = JSON.parse(rawText);
    } catch {
      return {
        statusCode: 502,
        body: JSON.stringify({
          error: 'Impossible de parser le JSON renvoyé par Fapshi',
          details: rawText
        })
      };
    }

    // 11) Si Fapshi renvoie un code d’erreur HTTP (>=400), transmettre ce JSON d’erreur
    if (!response.ok) {
      return {
        statusCode: response.status,
        body: JSON.stringify({ error: respJson })
      };
    }

    // 12) Succès : renvoyer l’URL de checkout vers le frontend
    return {
      statusCode: 200,
      body: JSON.stringify({ checkoutUrl: respJson.data.url })
    };

  } catch (error) {
    // 13) Erreur réseau ou inattendue
    return {
      statusCode: 500,
      body: JSON.stringify({ error: error.message })
    };
  }
};
