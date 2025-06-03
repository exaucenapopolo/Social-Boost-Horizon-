exports.handler = async (event) => {
  // 1) Requête POST obligatoire
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      body: JSON.stringify({ error: 'Utilise POST, pas ' + event.httpMethod })
    };
  }

  // 2) Lire les variables d’environnement
  const API_USER = process.env.FAPSHI_API_USER;
  const SECRET_KEY = process.env.FAPSHI_SECRET_KEY;

  if (!API_USER || !SECRET_KEY) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Clés Fapshi non définies dans Netlify (FAPSHI_API_USER ou FAPSHI_SECRET_KEY)' })
    };
  }

  // 3) Parser le corps JSON envoyé
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

  // 4) URL API Fapshi en production (live)
  const apiEndpoint = 'https://api.fapshi.com/api/v1/checkout/create';

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
        'Authorization': `Bearer ${SECRET_KEY}`,
        'X-Fapshi-Api-User': API_USER
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
