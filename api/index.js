const express = require('express');
const cors = require('cors');
const admin = require('firebase-admin');
const crypto = require('crypto');

const app = express();

// Middleware
app.use(cors());
app.use(express.json({ limit: '10mb' }));

// Logging
app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
  next();
});

// Initialisation Firebase Admin (sécurisée pour Vercel)
if (!admin.apps.length) {
  try {
    const privateKey = process.env.FIREBASE_PRIVATE_KEY
      ? process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n')
      : undefined;

    if (!process.env.FIREBASE_PROJECT_ID || !process.env.FIREBASE_CLIENT_EMAIL || !privateKey) {
      console.error('❌ Variables Firebase manquantes');
      throw new Error('Configuration Firebase incomplète');
    }

    admin.initializeApp({
      credential: admin.credential.cert({
        projectId: process.env.FIREBASE_PROJECT_ID,
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
        privateKey: privateKey,
      }),
    });

    console.log('✅ Firebase Admin initialisé');
  } catch (error) {
    console.error('❌ Erreur Firebase :', error);
  }
}

const db = admin.firestore();

// =============================================
//  Middleware d’authentification
// =============================================
async function checkAuth(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ success: false, error: 'Token manquant' });
  }

  const token = authHeader.split(' ')[1];
  try {
    const decodedToken = await admin.auth().verifyIdToken(token);
    req.user = decodedToken;
    next();
  } catch (error) {
    console.error('❌ Token invalide :', error);
    return res.status(403).json({ success: false, error: 'Token invalide ou expiré' });
  }
}

// =============================================
//  ROUTES
// =============================================

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

// 1. Lire le profil et calculer les commandes
app.get('/api/user/profile', checkAuth, async (req, res) => {
  try {
    const uid = req.user.uid;
    
    // 1. Récupération des infos de l'utilisateur dans l'Auth Firebase pour des dates fiables
    const userRecord = await admin.auth().getUser(uid);
    const creationTime = userRecord.metadata.creationTime; // Date de création du compte
    const lastSignInTime = userRecord.metadata.lastSignInTime; // Dernière connexion

    // 2. Calcul du nombre réel de commandes à travers plusieurs collections
    const collectionsToSearch = ['commandes', 'orders', 'commande-automatique'];
    let realTotalOrders = 0;

    for (const collectionName of collectionsToSearch) {
      try {
        // On cherche toutes les commandes où l'ID de l'utilisateur correspond
        const snapshot = await db.collection(collectionName).where('userId', '==', uid).get();
        realTotalOrders += snapshot.size;
      } catch (err) {
        console.warn(`Collection ${collectionName} introuvable ou erreur de lecture.`);
      }
    }

    // 3. Récupération des données Firestore
    const userDoc = await db.collection('users').doc(uid).get();
    let data = userDoc.exists ? userDoc.data() : {};

    // 4. On combine et on envoie les données formatées
    res.json({
      success: true,
      profile: {
        displayName: data.displayName || req.user.name || '',
        email: data.email || req.user.email || '',
        photoURL: data.photoURL || req.user.picture || null,
        phone: data.phone || '',
        country: data.country || '',
        balance: data.balance || 0,
        currency: data.currency || 'FCFA',
        totalOrders: realTotalOrders, // On utilise le vrai total calculé
        createdAt: creationTime || new Date().toISOString(),
        settings: data.settings || {},
        resellerLevel: data.resellerLevel || 'bronze',
        lastSignIn: lastSignInTime || null,
      }
    });
  } catch (error) {
    console.error('Erreur /api/user/profile :', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// 2. Mettre à jour le profil
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

    // Mise à jour dans Firebase Auth
    const authUpdates = {};
    if (displayName) authUpdates.displayName = displayName;
    if (photoURL) authUpdates.photoURL = photoURL;

    if (Object.keys(authUpdates).length > 0) {
      await admin.auth().updateUser(uid, authUpdates);
    }

    // Changement de mot de passe
    if (newPassword) {
      if (newPassword.length < 6) {
        return res.status(400).json({ success: false, error: 'Le mot de passe doit contenir au moins 6 caractères' });
      }
      await admin.auth().updateUser(uid, { password: newPassword });
    }

    // Mise à jour Firestore
    await db.collection('users').doc(uid).set(updateData, { merge: true });

    res.json({ success: true, message: 'Profil mis à jour avec succès' });
  } catch (error) {
    console.error('Erreur /api/update-profile :', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// 3. Enregistrer les paramètres
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

// 4. Infos clé API
app.get('/api/user/api-key-info', checkAuth, async (req, res) => {
  try {
    const userDoc = await db.collection('users').doc(req.user.uid).get();
    const data = userDoc.data();
    if (data && data.apiKey) {
      res.json({
        success: true,
        hasApiKey: true,
        prefix: data.apiKey.substring(0, 8),
        createdAt: data.apiKeyCreatedAt || new Date().toISOString(), // Sécurité
      });
    } else {
      res.json({ success: true, hasApiKey: false });
    }
  } catch (error) {
    console.error('Erreur /api/user/api-key-info :', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// 5. Générer clé API (Correction de la date)
app.post('/api/user/generate-api-key', checkAuth, async (req, res) => {
  try {
    const newKey = 'sbh_' + crypto.randomBytes(24).toString('hex');
    const prefix = newKey.substring(0, 8);
    const creationDate = new Date().toISOString(); // Création d'une date ISO standardisée

    await db.collection('users').doc(req.user.uid).set({
      apiKey: newKey,
      apiKeyCreatedAt: creationDate,
    }, { merge: true });

    res.json({ success: true, apiKey: newKey, prefix, createdAt: creationDate });
  } catch (error) {
    console.error('Erreur /api/user/generate-api-key :', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// 6. Révoquer clé API
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

// 404 – toujours en JSON
app.use((req, res) => {
  res.status(404).json({
    success: false,
    error: `Route non trouvée : ${req.method} ${req.path}`,
  });
});

// Gestionnaire d'erreurs global
app.use((err, req, res, next) => {
  console.error('❌ Erreur globale :', err.stack);
  res.status(500).json({
    success: false,
    error: err.message || 'Erreur interne du serveur',
  });
});

module.exports = app;
        
