// netlify/functions/create-fapshi-checkout.js

exports.handler = async (event) => {
  // 1) N’accepte que POST
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      body: JSON.stringify({ error: 'Utilise POST, pas ' + event.httpMethod })
    };
  }

  // 2) Lire les clés depuis Netlify
  const API_USER   = process.env.FAPSHI_API_USER;
  const SECRET_KEY = process.env.FAPSHI_SECRET_KEY;

  if (!API_USER || !SECRET_KEY) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Clés Fapshi non définies' })
    };
  }

  // 3) Parser le corps JSON envoyé par le front-end
  let bodyData;
  try {
    bodyData = JSON.parse(event.body);
  } catch (err) {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: 'JSON mal formé' })
    };
  }

  const { amount, currency, description, redirectUrl } = bodyData;
  if (!amount || !currency || !redirectUrl) {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: 'Champs requis : amount, currency, redirectUrl' })
    };
  }

  // 4) URL API Fapshi (production)
  const apiEndpoint = 'https://live.fapshi.com/initiate-pay';

  const payload = {
    amount: amount,
    currency: currency,
    description: description || 'Paiement Fapshi',
    redirect_url: redirectUrl
  };

  try {
    // 5) Appel POST vers Fapshi avec les bons headers
    const response = await fetch(apiEndpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apiUser': API_USER,        // <— Nom exact du header, tel que Fapshi le décrit
        'secretKey': SECRET_KEY     // <— Nom exact du header, tel que Fapshi le décrit
      },
      body: JSON.stringify(payload)
    });

    // 6) Lire la réponse brute
    const rawText = await response.text();
    const contentType = response.headers.get('content-type') || '';

    // 7) Si ce n’est pas JSON, renvoyer l’erreur brute
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
          error: 'Impossible de parser le JSON Fapshi',
          details: rawText
        })
      };
    }

    // 9) Si Fapshi renvoie une erreur (response.ok === false)
    if (!response.ok) {
      return {
        statusCode: response.status,
        body: JSON.stringify({ error: respJson })
      };
    }

    // 10) Succès : retourner l’URL de checkout
    return {
      statusCode: 200,
      body: JSON.stringify({ checkoutUrl: respJson.data.url })
    };

  } catch (error) {
    // 11) Erreur réseau ou autre
    return {
      statusCode: 500,
      body: JSON.stringify({ error: error.message })
    };
  }
};
