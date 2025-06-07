// api/create-fapshi-checkout.js

export default async function handler(req, res) {
// Permettre CORS pour votre domaine
res.setHeader(‘Access-Control-Allow-Origin’, ‘*’);
res.setHeader(‘Access-Control-Allow-Methods’, ‘POST, OPTIONS’);
res.setHeader(‘Access-Control-Allow-Headers’, ‘Content-Type’);

if (req.method === ‘OPTIONS’) {
return res.status(200).end();
}

console.log(”>>> REQUEST RECEIVED:”, {
method: req.method,
body: req.body,
headers: req.headers
});

console.log(”>>> ENV CHECK:”, {
FAPSHI_API_USER: !!process.env.FAPSHI_API_USER,
FAPSHI_SECRET_KEY: !!process.env.FAPSHI_SECRET_KEY,
FAPSHI_WEBHOOK_URL: !!process.env.FAPSHI_WEBHOOK_URL
});

try {
if (req.method !== ‘POST’) {
return res.status(405).json({ error: ‘Méthode non autorisée’ });
}

```
const API_USER = process.env.FAPSHI_API_USER;
const SECRET_KEY = process.env.FAPSHI_SECRET_KEY;
const WEBHOOK_URL = process.env.FAPSHI_WEBHOOK_URL;

if (!API_USER || !SECRET_KEY || !WEBHOOK_URL) {
  console.error('CRITICAL: Missing env vars');
  return res.status(500).json({ error: 'Configuration serveur incomplète' });
}

const { amount, currency, redirectUrl, uid } = req.body;

if (!amount || !currency || !redirectUrl || !uid) {
  return res.status(400).json({ error: 'Paramètres manquants: amount, currency, redirectUrl, uid' });
}

const payload = {
  amount: parseFloat(amount),
  currency,
  description: 'Paiement Social Boost Horizon',
  redirect_url: redirectUrl,
  webhook_url: WEBHOOK_URL,
  metadata: { userId: uid }
};

console.log(">>> Payload envoyé à Fapshi:", payload);

// Utilisation de fetch natif (Node.js 18+ sur Vercel)
const response = await fetch('https://live.fapshi.com/initiate-pay', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'apiuser': API_USER,
    'apikey': SECRET_KEY
  },
  body: JSON.stringify(payload)
});

const responseText = await response.text();
console.log('>>> Fapshi response:', {
  status: response.status,
  statusText: response.statusText,
  body: responseText
});

let respJson;
try {
  respJson = JSON.parse(responseText);
} catch (parseError) {
  console.error('Erreur parsing JSON:', parseError);
  return res.status(502).json({ 
    error: 'Réponse invalide du processeur de paiement',
    details: responseText.substring(0, 200)
  });
}

if (!response.ok) {
  console.error('Erreur API Fapshi:', respJson);
  return res.status(response.status).json(respJson);
}

// Vérification de la structure de réponse
const checkoutUrl = respJson.data?.url || respJson.link || respJson.checkout_url;

if (!checkoutUrl) {
  console.error('Structure de réponse inattendue:', respJson);
  return res.status(502).json({ 
    error: 'URL de paiement non trouvée',
    response: respJson
  });
}

return res.status(200).json({ 
  checkoutUrl,
  transactionId: respJson.data?.id || respJson.id
});
```

} catch (error) {
console.error(‘❌ ERREUR GRAVE:’, error);
return res.status(500).json({
error: ‘Erreur serveur interne’,
details: process.env.NODE_ENV === ‘development’ ? error.message : null
});
}
}
