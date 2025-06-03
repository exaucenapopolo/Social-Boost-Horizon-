// netlify/functions/create-fapshi-checkout.js

exports.handler = async (event) => {
  // 1) On n’accepte que POST
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      body: JSON.stringify({ error: 'Utilise POST, pas ' + event.httpMethod })
    };
  }

  // 2) Récupérer les clés depuis les variables d’environnement Netlify
  const API_USER   = process.env.FAPSHI_API_USER;
  const SECRET_KEY = process.env.FAPSHI_SECRET_KEY;

  if (!API_USER || !SECRET_KEY) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Clés Fapshi non définies en variables d’environnement' })
    };
  }

  // 3) Parser le body JSON envoyé par le front-end
  let bodyData;
  try {
    bodyData = JSON.parse(event.body);
  } catch (err) {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: 'JSON mal formé dans la requête' })
    };
  }

  const { amount, currency, description, redirectUrl } = bodyData;
  if (!amount || !currency || !redirectUrl) {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: 'Paramètres manquants : amount, currency ou redirectUrl' })
    };
  }

  // 4) Construire le payload pour l’API Fapshi
  const payload = {
    amount: amount,
    currency: currency,
    description: description || 'Achat produit',
    redirect_url: redirectUrl
  };

  // 5) Définir l’endpoint Fapshi (vérifiez si vous devez utiliser un endpoint "sandbox")
  //    Par défaut, on essaie "https://api.fapshi.com/v1/checkout/create"
  //    Si vous êtes sandbox, remplacez par l’URL sandbox fournie par Fapshi (ex. "https://sandbox-api.fapshi.com/v1/checkout/create").
  const apiEndpoint = 'https://api.fapshi.com/v1/checkout/create';

  try {
    // 6) Appel à l’API Fapshi
    const response = await fetch(apiEndpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        // Authentification Fapshi
        'Authorization': `Bearer ${SECRET_KEY}`,
        'X-Fapshi-Api-User': API_USER
      },
      body: JSON.stringify(payload)
    });

    // 7) On lit la réponse brute (texte), quelle que soit sa nature (JSON ou HTML)
    const rawText = await response.text();

    // 8) On vérifie le content-type renvoyé
    const contentType = response.headers.get('content-type') || '';
    if (!contentType.includes('application/json')) {
      // Si ce n’est pas du JSON, on renvoie un 502 avec le contenu brut pour diagnostiquer
      return {
        statusCode: 502,
        body: JSON.stringify({
          error: 'L’API Fapshi a renvoyé un contenu non JSON',
          details: rawText
        })
      };
    }

    // 9) Si c’est du JSON, on peut parser
    let respJson;
    try {
      respJson = JSON.parse(rawText);
    } catch (err) {
      // Si JSON invalide
      return {
        statusCode: 502,
        body: JSON.stringify({
          error: 'Impossible de parser le JSON renvoyé par Fapshi',
          details: rawText
        })
      };
    }

    // 10) Si la réponse HTTP n’est pas OK, on renvoie l’erreur Fapshi
    if (!response.ok) {
      return {
        statusCode: response.status,
        body: JSON.stringify({ error: respJson })
      };
    }

    // 11) En cas de succès, on renvoie simplement l’URL de checkout
    return {
      statusCode: 200,
      body: JSON.stringify({ checkoutUrl: respJson.data.url })
    };

  } catch (error) {
    // 12) En cas d’erreur réseau ou autre
    return {
      statusCode: 500,
      body: JSON.stringify({ error: error.message })
    };
  }
};
