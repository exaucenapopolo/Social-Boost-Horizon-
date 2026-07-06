// Fichier : /api/register.js
const { sendWelcomeEmail } = require('./email-service.js');

export default async function handler(req, res) {
  // 1. Autoriser ton site web à communiquer avec cette API (CORS)
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version'
  );

  // 2. Gérer la pré-requête du navigateur
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Méthode non autorisée' });
  }

  try {
    const { email, username, country } = req.body;

    if (!email) {
      return res.status(400).json({ error: "L'adresse email est requise." });
    }

    // 3. Appel direct à TA fonction dans TON fichier email-service.js
    await sendWelcomeEmail({
      email: email,
      username: username,
      country: country || 'Non spécifié'
    });

    return res.status(200).json({ success: true, message: "Email de bienvenue envoyé avec succès !" });
  } catch (error) {
    console.error("❌ Erreur dans l'API register:", error);
    return res.status(500).json({ error: "Erreur lors de l'envoi de l'email", details: error.message });
  }
}
