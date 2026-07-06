const express = require('express');
const cors = require('cors');
const admin = require('firebase-admin');
const crypto = require('crypto');

const app = express();

// Configuration des Middlewares de base
app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: '10mb' })); // Support pour les photos de profil volumineuses en base64

// Initialisation sécurisée de Firebase Admin pour Vercel
if (!admin.apps.length) {
  try {
    const privateKey = process.env.FIREBASE_PRIVATE_KEY
      ? process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n')
      : undefined;

    if (!process.env.FIREBASE_PROJECT_ID || !process.env.FIREBASE_CLIENT_EMAIL || !privateKey) {
      console.error('❌ Variables d\'environnement Firebase manquantes dans Vercel !');
      throw new Error('Configuration Firebase incomplète');
    }

    admin.initializeApp({
      credential: admin.credential.cert({
        projectId: process.env.FIREBASE_PROJECT_ID,
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
        privateKey: privateKey,
      }),
    });
    console.log('✅ Firebase Admin initialisé avec succès');
  } catch (error) {
    console.error('❌ Erreur critique d\'initialisation Firebase :', error);
  }
}

const db = admin.firestore();

// Middleware de vérification du Token Firebase (Authentification)
async function checkAuth(req, res, next) {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ success: false, error: 'Utilisateur non authentifié (Pas de token)' });
    }

    const token = authHeader.split(' ')[1];
    const decodedToken = await admin.auth().verifyIdToken(token);
    req.user = decodedToken; // Injecte les données utilisateur (uid, email...) dans la requête
    next();
  } catch (error) {
    console.error('Erreur de validation du token :', error);
    return res.status(401).json({ success: false, error: 'Session expirée ou token invalide' });
  }
}

// =====================================================
//  ROUTES API
// =====================================================

// 1. Récupérer le profil complet de l'utilisateur
app.get('/api/user/profile', checkAuth, async (req, res) => {
  try {
    const userDoc = await db.collection('users').doc(req.user.uid).get();
    
    if (!userDoc.exists) {
      // Si l'utilisateur n'existe pas encore en BDD, on renvoie des valeurs par défaut
      return res.json({
        success: true,
        profile: {
          displayName: req.user.name || '',
          email: req.user.email || '',
          bio: '',
          phone: '',
          photoURL: req.user.picture || ''
        }
      });
    }

    res.json({ success: true, profile: userDoc.data() });
  } catch (error) {
    console.error('Erreur GET /api/user/profile :', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// 2. Mettre à jour le profil utilisateur
app.post('/api/user/update-profile', checkAuth, async (req, res) => {
  try {
    const { displayName, bio, phone, photoURL } = req.body;
    
    const updateData = {
      uid: req.user.uid,
      email: req.user.email,
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    };

    if (displayName !== undefined) updateData.displayName = displayName;
    if (bio !== undefined) updateData.bio = bio;
    if (phone !== undefined) updateData.phone = phone;
    if (photoURL !== undefined) updateData.photoURL = photoURL;

    // Mise à jour ou création du document dans Firestore
    await db.collection('users').doc(req.user.uid).set(updateData, { merge: true });

    // Optionnel : Mettre également à jour le profil dans Firebase Auth pour la cohérence
    if (displayName || photoURL) {
      const authUpdates = {};
      if (displayName) authUpdates.displayName = displayName;
      if (photoURL) authUpdates.photoURL = photoURL;
      await admin.auth().updateUser(req.user.uid, authUpdates);
    }

    res.json({ success: true, message: 'Profil mis à jour avec succès !' });
  } catch (error) {
    console.error('Erreur POST /api/user/update-profile :', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// 3. Générer une clé API unique
app.post('/api/user/generate-api-key', checkAuth, async (req, res) => {
  try {
    const rawKey = crypto.randomBytes(32).toString('hex');
    const prefix = "sbh_";
    const newKey = prefix + rawKey;

    await db.collection('users').doc(req.user.uid).update({
      apiKey: newKey,
      apiKeyCreatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    res.json({ success: true, apiKey: newKey, prefix });
  } catch (error) {
    console.error('Erreur /api/user/generate-api-key :', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// 4. Révoquer la clé API
app.post('/api/user/revoke-api-key', checkAuth, async (req, res) => {
  try {
    await db.collection('users').doc(req.user.uid).update({
      apiKey: admin.firestore.FieldValue.delete(),
      apiKeyCreatedAt: admin.firestore.FieldValue.delete(),
    });
    res.json({ success: true });
  } catch (error) {
    console.error('Erreur /api/user/revoke-api-key :', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// =====================================================
//  GESTION DES ERREURS (GARANTIT DU JSON EN RETOUR)
// =====================================================

// Capture les routes inconnues
app.use((req, res) => {
  res.status(404).json({
    success: false,
    error: `Route non trouvée sur le serveur : ${req.method} ${req.path}`,
  });
});

// Capture les plantages globaux du code
app.use((err, req, res, next) => {
  console.error('❌ Erreur globale serveur :', err.stack);
  res.status(500).json({
    success: false,
    error: 'Une erreur interne est survenue sur le serveur.',
    details: err.message
  });
});

module.exports = app;
      
