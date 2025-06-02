// netlify/functions/create-fapshi-checkout.js

// Si ton runtime Netlify est Node 18+ ou plus récent, 'fetch' est déjà disponible.
// Dans ce cas, TU PEUX COMMENTER la ligne ci‑dessous.
const fetch = require('node-fetch'); // Sinon, si tu as installé "node-fetch" en dépendance, laisse cette ligne.

exports.handler = async (event) => {
  // On ne veut que des requêtes POST
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      body: JSON.stringify({ error: 'Utilise POST, pas ' + event.httpMethod }),
    };
  }

  // Récupérer les clés depuis les variables d'environnement Netlify
  const API_USER   = process.env.FAPSHI_API_USER;
  const SECRET_KEY = process.env.FAPSHI_SECRET_KEY;

  if (!API_USER || !SECRET_KEY) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Clés Fapshi non définies en variables d’environnement' }),
    };
  }

  // Parser le body JSON envoyé par le front-end
  let bodyData;
  try {
    bodyData = JSON.parse(event.body);
  } catch (err) {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: 'JSON mal formé dans la requête' }),
    };
  }

  const { amount, currency, description, redirectUrl } = bodyData;
  if (!amount || !currency || !redirectUrl) {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: 'Paramètres manquants : amount, currency ou redirectUrl' }),
    };
  }

  // Construire le payload pour Fapshi
  const payload = {
    amount: amount,
    currency: currency,
    description: description || 'Achat produit',
    redirect_url: redirectUrl
  };

  // URL de l’API Fapshi pour créer un lien de checkout en mode sandbox
  const apiEndpoint = 'https://api.fapshi.com/v1/checkout/create';

  try {
    const response = await fetch(apiEndpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${SECRET_KEY}`,
        'X-Fapshi-Api-User': API_USER
      },
      body: JSON.stringify(payload)
    });

    const respJson = await response.json();
    if (!response.ok) {
      return {
        statusCode: response.status,
        body: JSON.stringify({ error: respJson })
      };
    }

    // En cas de succès, renvoyer l'URL de checkout au front-end
    return {
      statusCode: 200,
      body: JSON.stringify({ checkoutUrl: respJson.data.url })
    };
  } catch (error) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: error.message })
    };
  }
};
