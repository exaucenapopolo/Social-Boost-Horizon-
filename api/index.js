const express = require('express');
const cors = require('cors');
const admin = require('firebase-admin');

const app = express();
app.use(cors());
app.use(express.json());

// Initialisation sécurisée de Firebase Admin pour l'environnement Serverless de Vercel
if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      // Remplacement indispensable des sauts de ligne pour les clés privées sur Vercel
      privateKey: process.env.FIREBASE_PRIVATE_KEY ? process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n') : undefined,
    })
  });
}

const db = admin.firestore();

// Middleware de vérification du Jeton Firebase Auth (Bearer Token)
async function checkAuth(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ success: false, error: 'Accès non autorisé' });
  }

  const token = authHeader.split(' ')[1];
  try {
    const decodedToken = await admin.auth().verifyIdToken(token);
    req.user = decodedToken;
    next();
  } catch (error) {
    console.error('Erreur validation token:', error);
    return res.status(403).json({ success: false, error: 'Token invalide ou expiré' });
  }
}

// 1. LIRE LE PROFIL UTILISATEUR (Firestore Secure Document)
app.get('/api/user/profile', checkAuth, async (req, res) => {
  try {
    const userDoc = await db.collection('users').doc(req.user.uid).get();
    
    if (!userDoc.exists) {
      // Si le document Firestore n'existe pas encore, on renvoie les bases de l'Auth
      return res.json({
        success: true,
        profile: {
          displayName: req.user.name || '',
          email: req.user.email || '',
          photoURL: req.user.picture || null,
          balance: 0,
          totalOrders: 0,
          createdAt: new Date(),
          settings: {}
        }
      });
    }

    res.json({ success: true, profile: userDoc.data() });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// 2. METTRE À JOUR LE PROFIL (Nom, Téléphone, Pays, Mot de passe ou Photo Cloudinary)
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

    // Changement sécurisé du mot de passe si demandé
    if (newPassword && newPassword.length >= 6) {
      await admin.auth().updateUser(uid, { password: newPassword });
    }

    // Sauvegarde définitive dans le document de la base de données Firestore
    await db.collection('users').doc(uid).set(updateData, { merge: true });

    res.json({ success: true, message: 'Profil mis à jour avec succès' });
  } catch (error) {
    console.error('Erreur mise à jour profil:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// 3. ENREGISTRER LES PARAMÈTRES ET PRÉFÉRENCES
app.post('/api/user/settings', checkAuth, async (req, res) => {
  const { settings } = req.body;
  try {
    await db.collection('users').doc(req.user.uid).set({ settings }, { merge: true });
    res.json({ success: true, settings });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// 4. RÉCUPÉRER LES INFOS DE LA CLÉ API
app.get('/api/user/api-key-info', checkAuth, async (req, res) => {
  try {
    const userDoc = await db.collection('users').doc(req.user.uid).get();
    const data = userDoc.data();
    if (data && data.apiKey) {
      res.json({
        success: true,
        hasApiKey: true,
        prefix: data.apiKey.substring(0, 8),
        createdAt: data.apiKeyCreatedAt || new Date()
      });
    } else {
      res.json({ success: true, hasApiKey: false });
    }
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// 5. GÉNÉRER UNE NOUVELLE CLÉ API UNIQUE
app.post('/api/user/generate-api-key', checkAuth, async (req, res) => {
  try {
    const crypto = require('crypto');
    const newKey = 'sbh_' + crypto.randomBytes(24).toString('hex');
    const prefix = newKey.substring(0, 8);
    
    await db.collection('users').doc(req.user.uid).set({
      apiKey: newKey,
      apiKeyCreatedAt: admin.firestore.FieldValue.serverTimestamp()
    }, { merge: true });

    res.json({ success: true, apiKey: newKey, prefix });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// 6. RÉVOQUER / SUPPRIMER LA CLÉ API
app.post('/api/user/revoke-api-key', checkAuth, async (req, res) => {
  try {
    await db.collection('users').doc(req.user.uid).update({
      apiKey: admin.firestore.FieldValue.delete(),
      apiKeyCreatedAt: admin.firestore.FieldValue.delete()
    });
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

module.exports = app;
      
