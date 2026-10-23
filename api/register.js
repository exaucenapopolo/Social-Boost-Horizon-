
'use strict';

// Point d'entrée Vercel /api/register.
// Le contenu du mail de bienvenue est désormais géré par
// api/email-service.js, afin d'éviter les modèles en double.

const admin = require('firebase-admin');
const { sendWelcomeEmail } = require('./email-service.js');

function setCorsHeaders(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'Content-Type, Authorization'
  );
  res.setHeader('Vary', 'Origin');
}

function initializeFirebaseAdmin() {
  if (admin.apps.length) return;

  const privateKey = process.env.FIREBASE_PRIVATE_KEY
    ? process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n')
    : undefined;

  if (
    !process.env.FIREBASE_PROJECT_ID ||
    !process.env.FIREBASE_CLIENT_EMAIL ||
    !privateKey
  ) {
    throw new Error(
      'Variables Firebase manquantes : FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY.'
    );
  }

  admin.initializeApp({
    credential: admin.credential.cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey,
    }),
  });
}

function escapeHtml(value, maxLength = 120) {
  return String(value == null ? '' : value)
    .trim()
    .slice(0, maxLength)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatCountry(country) {
  const raw = String(country || '').trim();

  if (!raw) return 'Non spécifié';

  // Convertit les codes pays, par exemple CM, en noms français.
  if (/^[a-z]{2}$/i.test(raw)) {
    try {
      const localizedName = new Intl.DisplayNames(
        ['fr'],
        { type: 'region' }
      ).of(raw.toUpperCase());

      if (
        localizedName &&
        localizedName !== raw.toUpperCase()
      ) {
        return escapeHtml(localizedName, 100);
      }
    } catch (_) {
      // Conserve le code reçu si la conversion est indisponible.
    }
  }

  return escapeHtml(raw, 100);
}

module.exports = async function handler(req, res) {
  setCorsHeaders(res);

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST, OPTIONS');

    return res.status(405).json({
      success: false,
      error: 'Méthode non autorisée.',
    });
  }

  if (!process.env.RESEND_API_KEY) {
    console.error(
      'RESEND_API_KEY est absent des variables serveur.'
    );

    return res.status(500).json({
      success: false,
      error: 'Configuration email serveur incomplète.',
    });
  }

  // Le mail est envoyé uniquement pour un compte authentifié.
  const authHeader = req.headers.authorization || '';

  if (!authHeader.startsWith('Bearer ')) {
    return res.status(401).json({
      success: false,
      error: 'Authentification requise.',
    });
  }

  try {
    initializeFirebaseAdmin();

    const idToken = authHeader
      .slice('Bearer '.length)
      .trim();

    const decodedToken = await admin
      .auth()
      .verifyIdToken(idToken);

    const email = String(
      decodedToken.email || ''
    ).trim();

    if (!email) {
      return res.status(401).json({
        success: false,
        error:
          'Le compte authentifié ne possède pas d’adresse email.',
      });
    }

    const body =
      req.body && typeof req.body === 'object'
        ? req.body
        : {};

    const rawName =
      (typeof body.displayName === 'string' &&
        body.displayName.trim()) ||
      (typeof body.username === 'string' &&
        body.username.trim()) ||
      decodedToken.name ||
      email.split('@')[0] ||
      'Nouveau membre';

    const username = escapeHtml(rawName, 120);
    const country = formatCountry(body.country);

    // IMPORTANT :
    // Aucun HTML de bienvenue n'est construit ici.
    // Le modèle centralisé de api/email-service.js est utilisé.
    const result = await sendWelcomeEmail({
      email,
      username,
      country,
    });

    if (result && result.error) {
      console.error(
        'Resend a refusé le mail de bienvenue :',
        result.error
      );

      return res.status(502).json({
        success: false,
        error:
          'Le fournisseur email a refusé l’envoi.',
      });
    }

    const emailId =
      (result && result.data && result.data.id) ||
      (result && result.id) ||
      null;

    console.log(
      `Email de bienvenue traité via email-service.js pour ${email}; id: ${emailId || 'non communiqué'}`
    );

    return res.status(200).json({
      success: true,
      emailSent: true,
      id: emailId,
    });
  } catch (error) {
    const invalidTokenCodes = new Set([
      'auth/argument-error',
      'auth/id-token-expired',
      'auth/id-token-revoked',
      'auth/invalid-id-token',
      'auth/user-disabled',
      'auth/user-not-found',
    ]);

    if (
      error &&
      invalidTokenCodes.has(error.code)
    ) {
      return res.status(401).json({
        success: false,
        error:
          'Jeton de connexion invalide ou expiré.',
      });
    }

    console.error(
      'Erreur dans /api/register :',
      error && error.message ? error.message : error
    );

    return res.status(500).json({
      success: false,
      error:
        'Erreur serveur lors de l’envoi du mail de bienvenue.',
    });
  }
};
                 
