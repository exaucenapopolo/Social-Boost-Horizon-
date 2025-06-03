exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      body: JSON.stringify({ error: 'Utilisez la méthode POST, pas ' + event.httpMethod })
    };
  }

  const API_USER = process.env.FAPSHI_API_USER;
  const API_KEY = process.env.FAPSHI_API_KEY;

  if (!API_USER || !API_KEY) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Clés Fapshi non définies dans les variables d’environnement (FAPSHI_API_USER ou FAPSHI_API_KEY)' })
    };
  }

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

  const apiEndpoint = 'https://live.fapshi.com/api/payments/init';

  const payload = {
    amount: amount,
    currency: currency,
    description: description || 'Paiement Fapshi',
    redirect_url: redirectUrl
  };

  try {
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

    if (!contentType.includes('application/json')) {
      return {
        statusCode: 502,
        body: JSON.stringify({
          error: 'Fapshi a renvoyé un contenu non JSON',
          details: rawText
        })
      };
    }

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

    if (!response.ok) {
      return {
        statusCode: response.status,
        body: JSON.stringify({ error: respJson })
      };
    }

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
