// Fichier à placer dans : /api/register.js

export default async function handler(req, res) {
  // Configuration des en-têtes CORS standards (Sécurité et compatibilité)
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version'
  );

  // Gestion des requêtes de pré-vérification (Preflight OPTIONS)
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // Filtrer pour n'autoriser que les requêtes POST
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Méthode non autorisée' });
  }

  try {
    const { username, email, country, referralCode } = req.body;

    if (!email) {
      return res.status(400).json({ error: "L'adresse email est obligatoire." });
    }

    // --- SÉCURISATION DES VARIABLES POUR ÉVITER LES CRASHS ---
    // Si une valeur arrive vide, on lui donne une valeur par défaut pour ne pas bloquer le serveur
    const safeUsername = username && username.trim() !== "" ? username : "Membre";
    const safeCountry = country && country.trim() !== "" ? country.toUpperCase() : "NON SPÉCIFIÉ";
    const safeReferralCode = referralCode || "Aucun code";

    const resendApiKey = process.env.RESEND_API_KEY;
    if (!resendApiKey) {
      console.error("Erreur de configuration : Clé RESEND_API_KEY introuvable.");
      return res.status(500).json({ error: "Configuration serveur incomplète pour l'envoi d'emails." });
    }

    // Requête directe vers l'API de Resend
    const resendResponse = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${resendApiKey}`
      },
      body: JSON.stringify({
        from: 'Social Boost Horizon <welcome@socialboosthorizon.com>', // Modifiez par votre domaine validé Resend
        to: [email],
        subject: 'Bienvenue chez Social Boost Horizon ! 🎉',
        html: `
          <div style="font-family: 'Segoe UI', Arial, sans-serif; line-height: 1.6; color: #1a1a1a; max-width: 600px; margin: 0 auto; padding: 30px; background-color: #ffffff; border-radius: 12px; box-shadow: 0 4px 15px rgba(0,0,0,0.05);">
            <div style="text-align: center; margin-bottom: 25px;">
              <h1 style="color: #6a0dad; margin: 0; font-size: 24px;">Bienvenue dans l'aventure ! 🚀</h1>
              <p style="color: #1e3c72; font-weight: 600; margin-top: 5px;">Social Boost Horizon</p>
            </div>
            
            <p>Bonjour <strong>@${safeUsername}</strong>,</p>
            <p>Nous sommes super heureux de vous compter parmi nous ! Votre inscription a bien été validée et votre espace est prêt. Tout est en place pour donner un coup de boost mémorable à votre présence sur les réseaux sociaux. 🔥</p>
            
            <div style="background: #f4f6f9; border-left: 4px solid #d4af37; padding: 15px; margin: 20px 0; border-radius: 0 8px 8px 0;">
              <h3 style="margin-top: 0; color: #080e1a; font-size: 16px;">Vos accès & informations :</h3>
              <p style="margin: 5px 0;"><strong>Identifiant :</strong> ${email}</p>
              <p style="margin: 5px 0;"><strong>Pays indiqué :</strong> ${safeCountry}</p>
              <p style="margin: 5px 0;"><strong>Votre Code Parrain :</strong> <span style="background: #fff; padding: 2px 6px; border: 1px dashed #6a0dad; border-radius: 4px; font-weight: bold; color: #6a0dad;">${safeReferralCode}</span></p>
            </div>

            <p>Partagez votre code parrain avec vos proches pour cumuler des avantages dès qu'ils s'inscrivent !</p>
            
            <div style="text-align: center; margin: 35px 0;">
              <a href="https://socialboosthorizon.com/dashboard.html" style="background: linear-gradient(135deg, #1e3c72, #6a0dad); color: #ffffff; padding: 14px 28px; text-decoration: none; font-weight: bold; border-radius: 8px; display: inline-block; box-shadow: 0 4px 10px rgba(106, 13, 173, 0.25);">Accéder à mon Espace Membre ☺️</a>
            </div>

            <hr style="border: 0; border-top: 1px solid #eef2f5; margin: 30px 0;">
            
            <p style="font-size: 13px; color: #666; text-align: center;">
              Besoin d'aide ? Rejoignez notre communauté en ligne ou consultez nos guides d'utilisation.<br>
              À très vite de l'autre côté !
            </p>
            
            <p style="margin-top: 25px; font-weight: bold; color: #1e3c72; text-align: center;">L'équipe Social Boost Horizon</p>
          </div>
        `
      })
    });

    const data = await resendResponse.json();

    if (!resendResponse.ok) {
      console.error("Erreur renvoyée par Resend:", data);
      return res.status(400).json({ error: "Erreur lors de l'envoi de l'email via Resend", details: data });
    }

    return res.status(200).json({ success: true, message: "Inscription enregistrée et e-mail envoyé !", id: data.id });
  } catch (error) {
    console.error("Erreur interne sur la fonction Vercel:", error);
    return res.status(500).json({ error: "Erreur interne du serveur.", details: error.message });
  }
}