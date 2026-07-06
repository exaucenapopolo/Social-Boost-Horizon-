const express = require('express');
const cors = require('cors');
const admin = require('firebase-admin');
const crypto = require('crypto');

const app = express();

// Middleware de base
app.use(cors());
app.use(express.json({ limit: '10mb' })); // Pour gérer les photos encodées en base64 si besoin

// Middleware de logging (optionnel mais utile)
app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
  next();
});

// Initialisation sécurisée de Firebase Admin pour l'environnement Serverless de Vercel
if (!admin.apps.length) {
  try {
    const privateKey = process.env.FIREBASE_PRIVATE_KEY
      ? process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n')
      : undefined;

    if (!process.env.FIREBASE_PROJECT_ID || !process.env.FIREBASE_CLIENT_EMAIL || !privateKey) {
      console.error('❌ Variables d\'environnement Firebase manquantes !');
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
    console.error('❌ Erreur d\'initialisation Firebase :', error);
    // En environnement de production, on peut laisser l'application démarrer
    // mais les routes échoueront proprement
  }
}

const db = admin.firestore();

// =====================================================
//  MIDDLEWARE D'AUTHENTIFICATION
// =====================================================
async function checkAuth(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ success: false, error: 'Accès non autorisé : token manquant' });
  }

  const token = authHeader.split(' ')[1];
  try {
    const decodedToken = await admin.auth().verifyIdToken(token);
    req.user = decodedToken;
    next();
  } catch (error) {
    console.error('❌ Erreur validation token :', error);
    return res.status(403).json({ success: false, error: 'Token invalide ou expiré' });
  }
}

// =====================================================
//  ROUTES
// =====================================================

// ---- Route de test ----
app.get('/api/health', (req, res) => {
  res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

// 1. Lire le profil utilisateur
app.get('/api/user/profile', checkAuth, async (req, res) => {
  try {
    const userDoc = await db.collection('users').doc(req.user.uid).get();

    if (!userDoc.exists) {
      // Retourner les données minimales depuis Auth
      return res.json({
        success: true,
        profile: {
          displayName: req.user.name || '',
          email: req.user.email || '',
          photoURL: req.user.picture || null,
          phone: '',
          country: '',
          balance: 0,
          totalOrders: 0,
          createdAt: new Date().toISOString(),
          settings: {},
          resellerLevel: 'bronze',
        }
      });
    }

    const data = userDoc.data();
    // On s'assure que les champs obligatoires sont présents
    res.json({
      success: true,
      profile: {
        displayName: data.displayName || req.user.name || '',
        email: data.email || req.user.email || '',
        photoURL: data.photoURL || req.user.picture || null,
        phone: data.phone || '',
        country: data.country || '',
        balance: data.balance || 0,
        totalOrders: data.totalOrders || 0,
        createdAt: data.createdAt || new Date().toISOString(),
        settings: data.settings || {},
        resellerLevel: data.resellerLevel || 'bronze',
        lastSignIn: data.lastSignIn || null,
      }
    });
  } catch (error) {
    console.error('Erreur /api/user/profile :', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// 2. Mettre à jour le profil (nom, email, téléphone, pays, photo, mot de passe)
app.post('/api/update-profile', checkAuth, async (req, res) => {
  const { displayName, email, phone, country, photoURL, newPassword } = req.body;
  const uid = req.user.uid;

  try {
    const updateData = {};
    if (displayName !== undefined) updateData.displayName = displayName;
    if (email !== undefined) updateData.email = email;
    if (phone !== undefined) updateData.phone = phone;
    if (country !== undefined) updateData.country = country;
    if (photoURL !== undefined) updateData.photoURL = photoURL;

    // Mise à jour dans Firebase Auth si applicable
    const authUpdates = {};
    if (displayName) authUpdates.displayName = displayName;
    if (photoURL) authUpdates.photoURL = photoURL;

    if (Object.keys(authUpdates).length > 0) {
      await admin.auth().updateUser(uid, authUpdates);
    }

    // Changement de mot de passe si demandé
    if (newPassword && newPassword.length >= 6) {
      await admin.auth().updateUser(uid, { password: newPassword });
    } else if (newPassword !== undefined && newPassword.length > 0 && newPassword.length < 6) {
      return res.status(400).json({ success: false, error: 'Le mot de passe doit contenir au moins 6 caractères' });
    }

    // Mise à jour Firestore
    await db.collection('users').doc(uid).set(updateData, { merge: true });

    res.json({ success: true, message: 'Profil mis à jour avec succès' });
  } catch (error) {
    console.error('Erreur /api/update-profile :', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// 3. Enregistrer les paramètres utilisateur
app.post('/api/user/settings', checkAuth, async (req, res) => {
  const { settings } = req.body;
  if (!settings || typeof settings !== 'object') {
    return res.status(400).json({ success: false, error: 'Paramètres invalides' });
  }

  try {
    await db.collection('users').doc(req.user.uid).set({ settings }, { merge: true });
    res.json({ success: true, settings });
  } catch (error) {
    console.error('Erreur /api/user/settings :', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// 4. Récupérer les infos de la clé API
app.get('/api/user/api-key-info', checkAuth, async (req, res) => {
  try {
    const userDoc = await db.collection('users').doc(req.user.uid).get();
    const data = userDoc.data();
    if (data && data.apiKey) {
      res.json({
        success: true,
        hasApiKey: true,
        prefix: data.apiKey.substring(0, 8),
        createdAt: data.apiKeyCreatedAt || new Date().toISOString(),
      });
    } else {
      res.json({ success: true, hasApiKey: false });
    }
  } catch (error) {
    console.error('Erreur /api/user/api-key-info :', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// 5. Générer une nouvelle clé API
app.post('/api/user/generate-api-key', checkAuth, async (req, res) => {
  try {
    const newKey = 'sbh_' + crypto.randomBytes(24).toString('hex');
    const prefix = newKey.substring(0, 8);

    await db.collection('users').doc(req.user.uid).set({
      apiKey: newKey,
      apiKeyCreatedAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });

    res.json({ success: true, apiKey: newKey, prefix });
  } catch (error) {
    console.error('Erreur /api/user/generate-api-key :', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// 6. Révoquer la clé API
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
//  GESTION DES ERREURS 404 ET GLOBALE
// =====================================================

// Route 404 pour toutes les autres requêtes (retourne toujours du JSON)
app.use((req, res) => {
  res.status(404).json({
    success: false,
    error: `Route non trouvée : ${req.method} ${req.path}`,
  });
});

// Gestionnaire d'erreurs global (capture les erreurs non gérées)
app.use((err, req, res, next) => {
  console.error('❌ Erreur globale :', err.stack);
  res.status(500).json({
    success: false,
    error: err.message || 'Erreur interne du serveur',
  });
});

// =====================================================
//  EXPORT POUR VERCEL (fonction serverless)
// =====================================================
module.exports = app;
