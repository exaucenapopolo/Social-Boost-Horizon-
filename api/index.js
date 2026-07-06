const express = require('express');
const cors    = require('cors');
const admin   = require('firebase-admin');
const crypto  = require('crypto');

const { sendWelcomeEmail } = require('./email-service.js');

const app = express();

app.use(cors());
app.use(express.json({ limit: '10mb' }));

app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
  next();
});

// ── Firebase Admin ──────────────────────────────────────────────
if (!admin.apps.length) {
  try {
    const privateKey = process.env.FIREBASE_PRIVATE_KEY
      ? process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n')
      : undefined;

    if (!process.env.FIREBASE_PROJECT_ID || !process.env.FIREBASE_CLIENT_EMAIL || !privateKey) {
      throw new Error('Variables Firebase manquantes (FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY)');
    }

    admin.initializeApp({
      credential: admin.credential.cert({
        projectId:   process.env.FIREBASE_PROJECT_ID,
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
        privateKey,
      }),
    });

    console.log('✅ Firebase Admin initialisé');
  } catch (error) {
    console.error('❌ Erreur Firebase :', error.message);
  }
}

const db = admin.firestore();

// ── Middleware d'authentification ───────────────────────────────
async function checkAuth(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ success: false, error: 'Token manquant' });
  }
  const token = authHeader.split(' ')[1];
  try {
    req.user = await admin.auth().verifyIdToken(token);
    next();
  } catch (error) {
    return res.status(403).json({ success: false, error: 'Token invalide ou expiré' });
  }
}

// ── Health check ────────────────────────────────────────────────
app.get('/api/health', (req, res) => {
  res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

// ── /api/register — Finalisation inscription + email bienvenue ──
app.post('/api/register', checkAuth, async (req, res) => {
  try {
    const {
      displayName,
      username,
      email,
      country,
      referralCode,
      referralCodeUsed,
      isFirstAccess
    } = req.body;

    const nameForEmail = displayName
      || req.user.name
      || (email || req.user.email || '').split('@')[0]
      || 'Nouveau Membre';

    const userEmail = email || req.user.email;

    if (!userEmail) {
      return res.status(400).json({ success: false, error: 'Email manquant.' });
    }

    let emailSent = false;
    try {
      await sendWelcomeEmail({
        email:    userEmail,
        username: nameForEmail,
        country:  country || 'Non spécifié'
      });
      emailSent = true;
      console.log(`📧 Email bienvenue envoyé à ${userEmail} (${nameForEmail})`);
    } catch (emailErr) {
      console.error(`❌ Email bienvenue NON envoyé à ${userEmail} :`, emailErr.message);
    }

    res.status(200).json({
      success:   true,
      emailSent,
      message:   emailSent
        ? 'Inscription traitée et email de bienvenue envoyé !'
        : 'Inscription traitée (email non envoyé — vérifiez les logs serveur).'
    });

  } catch (error) {
    console.error('❌ Erreur /api/register :', error.message);
    res.status(500).json({ success: false, error: 'Erreur interne du serveur.' });
  }
});

// ── /api/send-welcome — Envoi manuel d'un email de bienvenue ───
app.post('/api/send-welcome', checkAuth, async (req, res) => {
  try {
    const { email, username, country } = req.body;
    await sendWelcomeEmail({
      email:    email    || req.user.email,
      username: username || req.user.name || 'Utilisateur',
      country:  country  || 'Non spécifié'
    });
    res.json({ success: true, message: 'Email envoyé avec succès' });
  } catch (error) {
    console.error('❌ Erreur /api/send-welcome :', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ── /api/user/profile ───────────────────────────────────────────
app.get('/api/user/profile', checkAuth, async (req, res) => {
  try {
    const uid     = req.user.uid;
    const userDoc = await db.collection('users').doc(uid).get();

    if (!userDoc.exists) {
      return res.json({
        success: true,
        profile: {
          displayName:   req.user.name || '',
          email:         req.user.email || '',
          photoURL:      req.user.picture || null,
          phone:         '',
          country:       '',
          balance:       0,
          totalOrders:   0,
          createdAt:     new Date().toISOString(),
          settings:      {},
          resellerLevel: 'bronze',
        }
      });
    }

    const data = userDoc.data();
    res.json({
      success: true,
      profile: {
        displayName:   data.displayName || data.username || req.user.name || '',
        email:         data.email       || req.user.email || '',
        photoURL:      data.photoURL    || req.user.picture || null,
        phone:         data.phone       || '',
        country:       data.country     || '',
        balance:       data.balance     || 0,
        totalOrders:   data.totalOrders || 0,
        createdAt:     data.createdAt   || new Date().toISOString(),
        settings:      data.settings    || {},
        resellerLevel: data.resellerLevel || 'bronze',
        lastSignIn:    data.lastSignIn  || null,
      }
    });
  } catch (error) {
    console.error('❌ Erreur /api/user/profile :', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ── /api/update-profile ─────────────────────────────────────────
app.post('/api/update-profile', checkAuth, async (req, res) => {
  const { displayName, email, phone, country, photoURL, newPassword } = req.body;
  const uid = req.user.uid;

  try {
    const updateData  = {};
    const authUpdates = {};

    if (displayName !== undefined) { updateData.displayName = displayName; authUpdates.displayName = displayName; }
    if (email       !== undefined)   updateData.email       = email;
    if (phone       !== undefined)   updateData.phone       = phone;
    if (country     !== undefined)   updateData.country     = country;
    if (photoURL    !== undefined) { updateData.photoURL    = photoURL; authUpdates.photoURL = photoURL; }

    if (Object.keys(authUpdates).length > 0) {
      await admin.auth().updateUser(uid, authUpdates);
    }

    if (newPassword) {
      if (newPassword.length < 6) {
        return res.status(400).json({ success: false, error: 'Le mot de passe doit contenir au moins 6 caractères' });
      }
      await admin.auth().updateUser(uid, { password: newPassword });
    }

    await db.collection('users').doc(uid).set(updateData, { merge: true });
    res.json({ success: true, message: 'Profil mis à jour avec succès' });
  } catch (error) {
    console.error('❌ Erreur /api/update-profile :', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ── /api/user/settings ──────────────────────────────────────────
app.post('/api/user/settings', checkAuth, async (req, res) => {
  const { settings } = req.body;
  if (!settings || typeof settings !== 'object') {
    return res.status(400).json({ success: false, error: 'Paramètres invalides' });
  }
  try {
    await db.collection('users').doc(req.user.uid).set({ settings }, { merge: true });
    res.json({ success: true, settings });
  } catch (error) {
    console.error('❌ Erreur /api/user/settings :', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ── /api/user/api-key-info ──────────────────────────────────────
app.get('/api/user/api-key-info', checkAuth, async (req, res) => {
  try {
    const userDoc = await db.collection('users').doc(req.user.uid).get();
    const data    = userDoc.data();
    if (data && data.apiKey) {
      res.json({
        success:   true,
        hasApiKey: true,
        prefix:    data.apiKey.substring(0, 8),
        createdAt: data.apiKeyCreatedAt || new Date().toISOString(),
      });
    } else {
      res.json({ success: true, hasApiKey: false });
    }
  } catch (error) {
    console.error('❌ Erreur /api/user/api-key-info :', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ── /api/user/generate-api-key ──────────────────────────────────
app.post('/api/user/generate-api-key', checkAuth, async (req, res) => {
  try {
    const newKey = 'sbh_' + crypto.randomBytes(24).toString('hex');
    const prefix = newKey.substring(0, 8);
    await db.collection('users').doc(req.user.uid).set({
      apiKey:           newKey,
      apiKeyCreatedAt:  admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });
    res.json({ success: true, apiKey: newKey, prefix });
  } catch (error) {
    console.error('❌ Erreur /api/user/generate-api-key :', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ── /api/user/revoke-api-key ────────────────────────────────────
app.post('/api/user/revoke-api-key', checkAuth, async (req, res) => {
  try {
    await db.collection('users').doc(req.user.uid).update({
      apiKey:          admin.firestore.FieldValue.delete(),
      apiKeyCreatedAt: admin.firestore.FieldValue.delete(),
    });
    res.json({ success: true });
  } catch (error) {
    console.error('❌ Erreur /api/user/revoke-api-key :', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ============================================================================
// ── NOUVELLES ROUTES : MORETHANPANEL (MTP) ──────────────────────────────────
// ============================================================================

// ── /api/mtp/services — Récupérer la liste des services MTP ──
app.get('/api/mtp/services', async (req, res) => {
  try {
    const MTP_API_KEY = process.env.MORETHANPANEL_API_KEY;
    const MTP_API_URL = 'https://morethanpanel.com/api/v2';
    
    if (!MTP_API_KEY) {
      throw new Error("Clé API MoreThanPanel manquante dans les variables d'environnement.");
    }

    // Taux de conversion et marge (Variables Vercel, sinon valeurs par défaut)
    const RATE_USD_TO_XAF = parseFloat(process.env.RATE_USD_TO_XAF || '650');
    const MARGIN_MULTIPLIER = parseFloat(process.env.MARGIN_MULTIPLIER || '2.0'); // 2.0 = 100% de bénéfice

    // Appel à l'API du fournisseur
    const response = await fetch(`${MTP_API_URL}?key=${MTP_API_KEY}&action=services`);
    const data = await response.json();

    if (!Array.isArray(data)) {
      throw new Error("Réponse invalide du fournisseur MTP.");
    }

    // Formatage pour ton Frontend
    const formattedServices = data.map(service => {
      const originalPrice = parseFloat(service.rate);
      const finalPriceXAF = Math.round(originalPrice * RATE_USD_TO_XAF * MARGIN_MULTIPLIER);

      return {
        id: parseInt(service.service),
        name: service.name,
        category: service.category,
        priceXAF: finalPriceXAF,
        min: parseInt(service.min),
        max: parseInt(service.max),
        refill: service.refill === true || service.refill === '1',
        type: service.type,
        desc: service.description || '',
        isPackage: service.type === 'package',
        isPerOne: service.type === 'package', // Les packages sont souvent à l'unité
        isCustomComments: service.type === 'custom_comments' || service.name.toLowerCase().includes('custom comment')
      };
    });

    res.status(200).json({ success: true, services: formattedServices });

  } catch (error) {
    console.error('❌ Erreur MTP services :', error.message);
    res.status(500).json({ success: false, error: 'Erreur lors de la récupération des services.' });
  }
});

// ── /api/mtp/order — Passer une commande sur MTP ──
app.post('/api/mtp/order', checkAuth, async (req, res) => {
  try {
    const uid = req.user.uid;
    const { serviceId, link, quantity, comments } = req.body;

    if (!serviceId || !link) {
      return res.status(400).json({ success: false, error: 'Données de commande incomplètes (serviceId ou link manquant).' });
    }

    const MTP_API_KEY = process.env.MORETHANPANEL_API_KEY;
    const MTP_API_URL = 'https://morethanpanel.com/api/v2';
    const RATE_USD_TO_XAF = parseFloat(process.env.RATE_USD_TO_XAF || '650');
    const MARGIN_MULTIPLIER = parseFloat(process.env.MARGIN_MULTIPLIER || '2.0');

    // 1. Récupérer le vrai prix du service depuis MTP pour sécuriser la transaction
    const servicesRes = await fetch(`${MTP_API_URL}?key=${MTP_API_KEY}&action=services`);
    const servicesData = await servicesRes.json();
    const serviceInfo = servicesData.find(s => parseInt(s.service) === parseInt(serviceId));

    if (!serviceInfo) {
      return res.status(404).json({ success: false, error: 'Service introuvable chez le fournisseur.' });
    }

    // 2. Calcul de la quantité finale et du prix
    const finalUnitPriceXAF = parseFloat(serviceInfo.rate) * RATE_USD_TO_XAF * MARGIN_MULTIPLIER;
    let finalQuantity = parseInt(quantity);
    
    if (comments) {
      const lines = comments.split('\n').filter(l => l.trim() !== '');
      finalQuantity = lines.length;
    }

    if (!finalQuantity || finalQuantity < parseInt(serviceInfo.min)) {
      return res.status(400).json({ success: false, error: `Quantité invalide. Minimum requis : ${serviceInfo.min}` });
    }

    const isPackage = serviceInfo.type === 'package';
    const totalCostXAF = isPackage ? (finalUnitPriceXAF * finalQuantity) : ((finalUnitPriceXAF / 1000) * finalQuantity);
    const totalCostRounded = Math.round(totalCostXAF);

    // 3. Débit sécurisé via une Transaction Firestore
    const userRef = db.collection('users').doc(uid);
    let newBalance = 0;

    await db.runTransaction(async (transaction) => {
      const userDoc = await transaction.get(userRef);
      if (!userDoc.exists) {
        throw new Error("Utilisateur introuvable dans la base de données.");
      }

      const currentBalance = userDoc.data().balance || 0;
      if (currentBalance < totalCostRounded) {
        throw new Error(`Solde insuffisant. Requis: ${totalCostRounded} FCFA, Actuel: ${currentBalance} FCFA`);
      }

      newBalance = currentBalance - totalCostRounded;
      
      // On incrémente aussi le total des commandes
      const currentOrders = userDoc.data().totalOrders || 0;
      transaction.update(userRef, { 
          balance: newBalance,
          totalOrders: currentOrders + 1
      });
    });

    // 4. Envoi de la commande à MoreThanPanel
    const mtpParams = new URLSearchParams();
    mtpParams.append('key', MTP_API_KEY);
    mtpParams.append('action', 'add');
    mtpParams.append('service', serviceId);
    mtpParams.append('link', link);
    
    if (comments) {
      mtpParams.append('comments', comments);
    } else {
      mtpParams.append('quantity', finalQuantity);
    }

    const orderRes = await fetch(MTP_API_URL, {
      method: 'POST',
      body: mtpParams
    });
    const orderData = await orderRes.json();

    // 5. Gestion de la réponse de MTP
    if (orderData.error) {
      // Échec chez le fournisseur : on rembourse l'utilisateur
      await db.collection('users').doc(uid).update({ 
          balance: newBalance + totalCostRounded,
          totalOrders: admin.firestore.FieldValue.increment(-1)
      });
      throw new Error(`Erreur fournisseur : ${orderData.error}`);
    }

    // 6. Succès de la commande
    res.status(200).json({
      success: true,
      orderId: orderData.order,
      newBalance: newBalance,
      message: 'Commande passée avec succès !'
    });

  } catch (error) {
    console.error('❌ Erreur traitement commande MTP :', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ── 404 ─────────────────────────────────────────────────────────
app.use((req, res) => {
  res.status(404).json({
    success: false,
    error:   `Route non trouvée : ${req.method} ${req.path}`,
  });
});

// ── Erreur globale ──────────────────────────────────────────────
app.use((err, req, res, next) => {
  console.error('❌ Erreur globale :', err.stack);
  res.status(500).json({ success: false, error: err.message || 'Erreur interne du serveur' });
});

module.exports = app;
    
