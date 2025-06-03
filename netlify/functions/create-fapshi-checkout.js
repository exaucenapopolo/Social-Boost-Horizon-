exports.handler = async (event) => {
  // 1) Vérifier que la requête est une POST
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      body: JSON.stringify({ error: 'Utilisez la méthode POST, pas ' + event.httpMethod })
    };
  }

  // 2) Récupérer les variables d'environnement
  const API_USER = process.env.FAPSHI_API_USER;
  const API_KEY = process.env.FAPSHI_API_KEY;

  if (!API_USER || !API_KEY) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Clés Fapshi non définies dans les variables d’environnement (FAPSHI_API_USER ou FAPSHI_API_KEY)' })
    };
  }

  // 3) Parser le corps de la requête
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
      body: JSON.stringify({ error: 'Champs requis : amount, currency, redirectUrl' })
    };
  }

  // 4) URL de l'API Fapshi en production
  const apiEndpoint = 'https://live.fapshi.com/api/v1/checkout/create';

  // 5) Construire le payload
  const payload = {
    amount: amount,
    currency: currency,
    description: description || 'Paiement Fapshi',
    redirect_url: redirectUrl
  };

  try {
    // 6) Appeler l’API Fapshi
    const response = await fetch(apiEndpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apiuser': API_USER,
        'apikey': API_KEY
      },
      body: JSON.stringify(payload)
    });

    const contentType = response.headers.get('content-type') || '';
    const rawText = await response.text();

    // 7) Vérifier si la réponse est du JSON
    if (!contentType.includes('application/json')) {
      return {
        statusCode: 502,
        body: JSON.stringify({
          error: 'Fapshi a renvoyé un contenu non JSON',
          details: rawText
        })
      };
    }

    // 8) Parser le JSON
    let respJson;
    try {
      respJson = JSON.parse(rawText);
    } catch (err) {
      return {
        statusCode: 502,
        body: JSON.stringify({
          error: 'Erreur de parsing JSON depuis Fapshi',
          details: rawText
        })
      };
    }

    // 9) Si la réponse est une erreur
    if (!response.ok) {
      return {
        statusCode: response.status,
        body: JSON.stringify({ error: respJson })
      };
    }

    // 10) Succès : retourner l’URL de paiement
    return {
      statusCode: 200,
      body: JSON.stringify({ checkoutUrl: respJson.data.url })
    };

  } catch (error) {
    // 11) Erreur de réseau ou interne
    return {
      statusCode: 500,
      body: JSON.stringify({ error: error.message })
    };
  }
};
