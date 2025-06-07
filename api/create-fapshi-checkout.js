// api/create-fapshi-checkout.js

// Version compatible Node 16+
const fetch = (...args) => 
  import('node-fetch').then(({default: fetch}) => fetch(...args));

exports.handler = async (event) => {
  console.log(">>> EVENT RECEIVED:", JSON.stringify({
    httpMethod: event.httpMethod,
    headers: event.headers,
    body: event.body
  }));
  
  console.log(">>> ENV CHECK:", {
    FAPSHI_API_USER: !!process.env.FAPSHI_API_USER,
    FAPSHI_SECRET_KEY: !!process.env.FAPSHI_SECRET_KEY,
    FAPSHI_WEBHOOK_URL: !!process.env.FAPSHI_WEBHOOK_URL
  });

  try {
    if (event.httpMethod !== 'POST') {
      return { statusCode: 405, body: 'Use POST only' };
    }

    const API_USER    = process.env.FAPSHI_API_USER;
    const SECRET_KEY  = process.env.FAPSHI_SECRET_KEY;
    const WEBHOOK_URL = process.env.FAPSHI_WEBHOOK_URL;
    
    if (!API_USER || !SECRET_KEY || !WEBHOOK_URL) {
      console.error('CRITICAL: Missing env vars');
      return {
        statusCode: 500,
        body: JSON.stringify({ error: 'Configuration serveur incomplète' })
      };
    }

    let body;
    try {
      body = JSON.parse(event.body);
    } catch (err) {
      return { statusCode: 400, body: JSON.stringify({ error: 'JSON invalide' }) };
    }

    const { amount, currency, redirectUrl, uid } = body;
    if (!amount || !currency || !redirectUrl || !uid) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'Paramètres manquants' })
      };
    }

    const payload = {
      amount,
      currency,
      description: 'Paiement Social Boost Horizon',
      redirect_url: redirectUrl,
      webhook_url:  WEBHOOK_URL,
      metadata: { userId: uid }
    };

    // Debug: Vérification des credentials
    console.log(">>> API Credentials:", Buffer.from(`${API_USER}:${SECRET_KEY}`).toString('base64'));
    
    // Configuration du timeout
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    
    try {
      const response = await fetch('https://live.fapshi.com/initiate-pay', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apiuser': API_USER,
          'apikey': SECRET_KEY
        },
        body: JSON.stringify(payload),
        signal: controller.signal
      });

      const rawText = await response.text();
      console.log('>>> Fapshi response:', response.status, rawText);

      if (!response.headers.get('content-type')?.includes('application/json')) {
        return {
          statusCode: 502,
          body: JSON.stringify({ error: 'Réponse invalide du processeur' })
        };
      }

      const respJson = JSON.parse(rawText);
      
      if (!response.ok) {
        return { 
          statusCode: response.status, 
          body: JSON.stringify(respJson) 
        };
      }

      const checkoutUrl = respJson.data?.url || respJson.link;
      if (!checkoutUrl) throw new Error('Structure de réponse inattendue');

      return {
        statusCode: 200,
        body: JSON.stringify({ checkoutUrl })
      };

    } catch (err) {
      if (err.name === 'AbortError') {
        console.error('Fapshi API timeout');
        return { statusCode: 504, body: JSON.stringify({ error: 'Timeout' }) };
      }
      throw err;
    } finally {
      clearTimeout(timeout);
    }

  } catch (err) {
    console.error('❌ ERREUR GRAVE:', err.stack);
    return {
      statusCode: 500,
      body: JSON.stringify({ 
        error: 'Erreur serveur',
        details: process.env.NODE_ENV === 'development' ? err.message : null
      })
    };
  }
};
