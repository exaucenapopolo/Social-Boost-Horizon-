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

// ═══════════════════════════════════════════════════════════════
// MoreThanPanel (MTP) API
// ═══════════════════════════════════════════════════════════════
const MTP_API_URL    = 'https://morethanpanel.com/api/v2';
const MTP_USD_TO_XAF = 620;   // Taux de conversion USD → FCFA
const MTP_MULTIPLIER = 3;     // Marge bénéficiaire x3

// Cache en mémoire (10 minutes)
let _mtpServicesCache     = null;
let _mtpServicesCacheTime = 0;
const MTP_CACHE_TTL = 10 * 60 * 1000;

// Appel générique à l'API MTP
async function callMTP(params) {
  if (!process.env.MORETHANPANEL_API_KEY) {
    throw new Error('MORETHANPANEL_API_KEY non définie.');
  }
  const body = new URLSearchParams({ key: process.env.MORETHANPANEL_API_KEY, ...params });
  const res  = await fetch(MTP_API_URL, {
    method: 'POST',
    body,
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  });
  if (!res.ok) throw new Error(`MTP HTTP ${res.status}`);
  return res.json();
}

// Détection de la plateforme à partir du nom du service + lien
function detectPlatformName(serviceName, link) {
  const n = ((serviceName || '') + ' ' + (link || '')).toLowerCase();
  if (n.includes('instagram'))                    return 'Instagram';
  if (n.includes('facebook') || n.includes('fb.com')) return 'Facebook';
  if (n.includes('tiktok'))                       return 'TikTok';
  if (n.includes('youtube') || n.includes('youtu.be')) return 'YouTube';
  if (n.includes('twitter') || n.includes('x.com'))  return 'X (Twitter)';
  if (n.includes('telegram') || n.includes('t.me')) return 'Telegram';
  if (n.includes('whatsapp'))                     return 'WhatsApp';
  if (n.includes('linkedin'))                     return 'LinkedIn';
  if (n.includes('spotify'))                      return 'Spotify';
  if (n.includes('twitch'))                       return 'Twitch';
  if (n.includes('discord'))                      return 'Discord';
  if (n.includes('snapchat'))                     return 'Snapchat';
  if (n.includes('pinterest'))                    return 'Pinterest';
  if (n.includes('soundcloud'))                   return 'SoundCloud';
  if (n.includes('threads'))                      return 'Threads';
  if (n.includes('reddit'))                       return 'Reddit';
  if (n.includes('google'))                       return 'Google';
  if (n.includes('netflix'))                      return 'Netflix';
  if (n.includes('free fire') || n.includes('freefire')) return 'Free Fire';
  if (n.includes('kick'))                         return 'Kick';
  return 'Autre';
}

// Mappage statut MTP → statut français
const MTP_STATUS_MAP = {
  'Pending':    'En attente',
  'In progress': 'En cours',
  'Processing': 'En cours',
  'Completed':  'Terminé',
  'Partial':    'Partiel',
  'Canceled':   'Annulé',
};

// ── GET /api/mtp/services ────────────────────────────────────────
// Charge et met en cache tous les services MTP.
// Le frontend l'appelle au chargement de commande-automatique.html.
app.get('/api/mtp/services', async (req, res) => {
  try {
    const now = Date.now();

    // Servir depuis le cache si encore valide
    if (_mtpServicesCache && (now - _mtpServicesCacheTime) < MTP_CACHE_TTL) {
      return res.json({ success: true, services: _mtpServicesCache, cached: true });
    }

    const rawServices = await callMTP({ action: 'services' });

    if (!Array.isArray(rawServices)) {
      console.error('MTP services: réponse invalide', rawServices);
      return res.status(500).json({ success: false, error: 'Réponse MTP invalide' });
    }

    const services = rawServices.map(s => {
      const rate    = parseFloat(s.rate) || 0;
      const priceXAF = Math.round(rate * MTP_USD_TO_XAF * MTP_MULTIPLIER);
      return {
        id:       parseInt(s.service),
        name:     s.name,
        category: s.category || '',
        type:     s.type     || '',
        min:      parseInt(s.min),
        max:      parseInt(s.max),
        rate,
        priceXAF,
        refill: s.refill  === true || s.refill  === 'true',
        cancel: s.cancel  === true || s.cancel  === 'true',
        desc:   s.description || null,
      };
    });

    _mtpServicesCache     = services;
    _mtpServicesCacheTime = now;

    console.log(`✅ MTP: ${services.length} services chargés et mis en cache`);
    res.json({ success: true, services });

  } catch (error) {
    console.error('❌ /api/mtp/services :', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ── POST /api/mtp/order ──────────────────────────────────────────
// Passe une commande chez MTP, débite le solde, enregistre dans Firestore.
app.post('/api/mtp/order', checkAuth, async (req, res) => {
  const { serviceId, link, quantity, comments } = req.body;
  const uid = req.user.uid;

  if (!serviceId || !link) {
    return res.status(400).json({ success: false, error: 'serviceId et link sont requis.' });
  }

  try {
    // 1. Retrouver le service (depuis le cache ou l'API)
    const allServices = _mtpServicesCache || (await callMTP({ action: 'services' }));
    const service = allServices.find(s => parseInt(s.service || s.id) === parseInt(serviceId));

    if (!service) {
      return res.status(400).json({ success: false, error: 'Service introuvable ou expiré.' });
    }

    // 2. Calculer le coût exact
    const rate      = parseFloat(service.rate) || 0;
    const priceXAF  = Math.round(rate * MTP_USD_TO_XAF * MTP_MULTIPLIER);
    const qty       = parseInt(quantity);
    const isPackage = (service.type || '').toLowerCase().includes('package');
    const cost      = isPackage ? priceXAF : Math.round((priceXAF / 1000) * qty);

    // 3. Vérification rapide du solde (avant la transaction)
    const userDoc = await db.collection('users').doc(uid).get();
    if (!userDoc.exists) {
      return res.status(404).json({ success: false, error: 'Utilisateur introuvable.' });
    }

    const currentBalance = userDoc.data().balance || 0;
    if (currentBalance < cost) {
      return res.status(400).json({
        success: false,
        error: `Solde insuffisant. Requis : ${cost.toLocaleString('fr-FR')} FCFA — Disponible : ${currentBalance.toLocaleString('fr-FR')} FCFA`,
      });
    }

    // 4. Passer la commande chez MTP
    const orderParams = { action: 'add', service: serviceId, link, quantity: qty };
    if (comments) orderParams.comments = comments;

    const orderResult = await callMTP(orderParams);

    if (orderResult.error) {
      return res.status(400).json({ success: false, error: 'Erreur fournisseur : ' + orderResult.error });
    }
    if (!orderResult.order) {
      return res.status(400).json({ success: false, error: 'Commande non confirmée par le fournisseur.' });
    }

    // 5. Transaction Firestore : débit + enregistrement
    let finalOrderId, newBalance;

    await db.runTransaction(async (transaction) => {
      const counterRef      = db.collection('counters').doc('autoOrders');
      const freshUserRef    = db.collection('users').doc(uid);
      const counterDoc      = await transaction.get(counterRef);
      const freshUserDoc    = await transaction.get(freshUserRef);

      const freshBalance = freshUserDoc.data().balance || 0;
      if (freshBalance < cost) throw new Error('Solde insuffisant (vérifié pendant le traitement).');

      const nextId   = ((counterDoc.exists ? counterDoc.data().lastId : 0) || 0) + 1;
      finalOrderId   = `SBH-AUTO-${nextId}`;
      newBalance     = freshBalance - cost;

      const platform = detectPlatformName(service.name || '', link);

      transaction.set(counterRef, { lastId: nextId }, { merge: true });
      transaction.update(freshUserRef, { balance: newBalance });

      const orderRef = db.collection('autoOrders').doc();
      transaction.set(orderRef, {
        orderId:          finalOrderId,
        userId:           uid,
        provider:         'mtp',
        providerOrderId:  orderResult.order,
        serviceId:        parseInt(serviceId),
        serviceName:      service.name,
        platform,
        link,
        quantity:         qty,
        priceXAF:         cost,
        status:           'En attente',
        createdAt:        admin.firestore.FieldValue.serverTimestamp(),
        providerStartCount: 0,
        providerRemains:  qty,
        refunded:         false,
      });
    });

    console.log(`✅ Commande MTP ${finalOrderId} créée — providerOrderId: ${orderResult.order}`);
    res.json({ success: true, orderId: finalOrderId, newBalance });

  } catch (error) {
    console.error('❌ /api/mtp/order :', error.message);
    if (error.message.toLowerCase().includes('insuffisant')) {
      return res.status(400).json({ success: false, error: error.message });
    }
    res.status(500).json({ success: false, error: 'Erreur technique. Veuillez réessayer.' });
  }
});

// ── GET /api/mtp/user-orders ─────────────────────────────────────
// Renvoie toutes les commandes automatiques de l'utilisateur connecté.
app.get('/api/mtp/user-orders', checkAuth, async (req, res) => {
  try {
    const uid = req.user.uid;
    const snapshot = await db.collection('autoOrders')
      .where('userId', '==', uid)
      .orderBy('createdAt', 'desc')
      .limit(100)
      .get();

    const orders = snapshot.docs.map(doc => {
      const data = doc.data();
      return {
        id:               doc.id,
        orderId:          data.orderId,
        provider:         data.provider         || 'mtp',
        providerOrderId:  data.providerOrderId,
        serviceId:        data.serviceId,
        serviceName:      data.serviceName       || 'Service automatique',
        platform:         data.platform          || '',
        link:             data.link              || '',
        quantity:         data.quantity          || 0,
        priceXAF:         data.priceXAF          || 0,
        status:           data.status            || 'En attente',
        createdAt:        data.createdAt,
        providerStartCount: data.providerStartCount || 0,
        providerRemains:  data.providerRemains   !== undefined ? data.providerRemains : (data.quantity || 0),
        refunded:         data.refunded          || false,
        refundedAmount:   data.refundedAmount    || 0,
        lastChecked:      data.lastChecked       || null,
      };
    });

    res.json({ success: true, orders });

  } catch (error) {
    console.error('❌ /api/mtp/user-orders :', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ── GET /api/mtp/order-status/:orderId ──────────────────────────
// Vérifie le statut chez MTP et met à jour Firestore.
app.get('/api/mtp/order-status/:orderId', checkAuth, async (req, res) => {
  const { orderId } = req.params;
  const uid         = req.user.uid;

  try {
    // Retrouver la commande dans Firestore
    const snapshot = await db.collection('autoOrders')
      .where('orderId', '==', orderId)
      .where('userId', '==', uid)
      .limit(1)
      .get();

    if (snapshot.empty) {
      return res.status(404).json({ success: false, error: 'Commande introuvable.' });
    }

    const orderDoc  = snapshot.docs[0];
    const orderData = orderDoc.data();

    // Interroger MTP
    const statusResult = await callMTP({ action: 'status', order: orderData.providerOrderId });

    if (statusResult.error) {
      return res.status(400).json({ success: false, error: 'Erreur fournisseur : ' + statusResult.error });
    }

    const newStatus  = MTP_STATUS_MAP[statusResult.status] || statusResult.status || 'En attente';
    const startCount = parseInt(statusResult.start_count)  || 0;
    const remains    = parseInt(statusResult.remains)       || 0;

    // Mise à jour Firestore
    await orderDoc.ref.update({
      status:             newStatus,
      providerStartCount: startCount,
      providerRemains:    remains,
      lastChecked:        admin.firestore.FieldValue.serverTimestamp(),
    });

    console.log(`🔄 Statut MTP ${orderId}: ${statusResult.status} → ${newStatus}`);
    res.json({
      success:        true,
      status:         newStatus,
      providerStatus: statusResult.status,
      startCount,
      remains,
    });

  } catch (error) {
    console.error('❌ /api/mtp/order-status :', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ── POST /api/mtp/refill ─────────────────────────────────────────
// Demande un rechargement de la commande chez MTP.
app.post('/api/mtp/refill', checkAuth, async (req, res) => {
  const { orderId } = req.body;
  const uid         = req.user.uid;

  if (!orderId) {
    return res.status(400).json({ success: false, error: 'orderId requis.' });
  }

  try {
    const snapshot = await db.collection('autoOrders')
      .where('orderId', '==', orderId)
      .where('userId', '==', uid)
      .limit(1)
      .get();

    if (snapshot.empty) {
      return res.status(404).json({ success: false, error: 'Commande introuvable.' });
    }

    const orderDoc  = snapshot.docs[0];
    const orderData = orderDoc.data();

    if (!orderData.refill && orderData.refill !== undefined) {
      return res.status(400).json({ success: false, error: 'Ce service ne supporte pas le refill.' });
    }

    const result = await callMTP({ action: 'refill', order: orderData.providerOrderId });

    if (result.error) {
      return res.status(400).json({ success: false, error: 'Erreur fournisseur : ' + result.error });
    }

    await orderDoc.ref.update({
      lastRefill:   admin.firestore.FieldValue.serverTimestamp(),
      refillId:     result.refill || null,
    });

    console.log(`🔄 Refill demandé pour ${orderId} — refillId: ${result.refill}`);
    res.json({ success: true, refillId: result.refill });

  } catch (error) {
    console.error('❌ /api/mtp/refill :', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ── POST /api/mtp/cancel ─────────────────────────────────────────
// Annule la commande et rembourse l'utilisateur.
app.post('/api/mtp/cancel', checkAuth, async (req, res) => {
  const { orderId } = req.body;
  const uid         = req.user.uid;

  if (!orderId) {
    return res.status(400).json({ success: false, error: 'orderId requis.' });
  }

  try {
    const snapshot = await db.collection('autoOrders')
      .where('orderId', '==', orderId)
      .where('userId', '==', uid)
      .limit(1)
      .get();

    if (snapshot.empty) {
      return res.status(404).json({ success: false, error: 'Commande introuvable.' });
    }

    const orderDoc  = snapshot.docs[0];
    const orderData = orderDoc.data();

    if (orderData.refunded) {
      return res.status(400).json({ success: false, error: 'Cette commande a déjà été remboursée.' });
    }
    if (['Terminé', 'Completed'].includes(orderData.status)) {
      return res.status(400).json({ success: false, error: 'Impossible d\'annuler une commande terminée.' });
    }

    // Tenter d'annuler chez MTP (on continue même si ça échoue)
    try {
      await callMTP({ action: 'cancel', orders: orderData.providerOrderId });
    } catch (mtpErr) {
      console.warn(`⚠️ Annulation MTP ${orderId} échouée:`, mtpErr.message);
    }

    // Calculer le remboursement
    // Si partiel : calculer proportionnellement
    let refundAmount = orderData.priceXAF || 0;
    if (orderData.status === 'Partiel' || orderData.status === 'Partial') {
      const qty     = orderData.quantity || 1;
      const remains = orderData.providerRemains !== undefined ? orderData.providerRemains : qty;
      refundAmount  = Math.round((remains / qty) * refundAmount);
    }

    // Transaction : rembourser + marquer comme annulé
    await db.runTransaction(async (transaction) => {
      const userRef  = db.collection('users').doc(uid);
      const userSnap = await transaction.get(userRef);
      const oldBal   = (userSnap.data() || {}).balance || 0;

      transaction.update(userRef, { balance: oldBal + refundAmount });
      transaction.update(orderDoc.ref, {
        status:         'Annulé',
        refunded:       true,
        refundedAmount: refundAmount,
        cancelledAt:    admin.firestore.FieldValue.serverTimestamp(),
      });
    });

    console.log(`✅ Commande ${orderId} annulée — remboursé: ${refundAmount} FCFA`);
    res.json({ success: true, refundedAmount: refundAmount });

  } catch (error) {
    console.error('❌ /api/mtp/cancel :', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ═══════════════════════════════════════════════════════════════
// Routes utilisateur (existantes)
// ═══════════════════════════════════════════════════════════════

// ── /api/register ───────────────────────────────────────────────
app.post('/api/register', checkAuth, async (req, res) => {
  try {
    const { displayName, username, email, country } = req.body;

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
      await sendWelcomeEmail({ email: userEmail, username: nameForEmail, country: country || 'Non spécifié' });
      emailSent = true;
      console.log(`📧 Email bienvenue → ${userEmail}`);
    } catch (emailErr) {
      console.error(`❌ Email bienvenue NON envoyé à ${userEmail} :`, emailErr.message);
    }

    res.status(200).json({
      success: true,
      emailSent,
      message: emailSent ? 'Email envoyé !' : 'Inscription ok (email non envoyé — vérifiez les logs).',
    });
  } catch (error) {
    console.error('❌ /api/register :', error.message);
    res.status(500).json({ success: false, error: 'Erreur interne.' });
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
          displayName: req.user.name || '',
          email:       req.user.email || '',
          photoURL:    req.user.picture || null,
          phone: '', country: '', balance: 0, totalOrders: 0,
          createdAt: new Date().toISOString(), settings: {}, resellerLevel: 'bronze',
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
    console.error('❌ /api/user/profile :', error.message);
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
    if (email       !== undefined) updateData.email   = email;
    if (phone       !== undefined) updateData.phone   = phone;
    if (country     !== undefined) updateData.country = country;
    if (photoURL    !== undefined) { updateData.photoURL = photoURL; authUpdates.photoURL = photoURL; }
    if (Object.keys(authUpdates).length > 0) await admin.auth().updateUser(uid, authUpdates);
    if (newPassword) {
      if (newPassword.length < 6) return res.status(400).json({ success: false, error: 'Mot de passe trop court.' });
      await admin.auth().updateUser(uid, { password: newPassword });
    }
    await db.collection('users').doc(uid).set(updateData, { merge: true });
    res.json({ success: true, message: 'Profil mis à jour.' });
  } catch (error) {
    console.error('❌ /api/update-profile :', error.message);
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
    console.error('❌ /api/user/settings :', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ── /api/user/api-key-info ──────────────────────────────────────
app.get('/api/user/api-key-info', checkAuth, async (req, res) => {
  try {
    const userDoc = await db.collection('users').doc(req.user.uid).get();
    const data    = userDoc.data();
    if (data && data.apiKey) {
      res.json({ success: true, hasApiKey: true, prefix: data.apiKey.substring(0, 8), createdAt: data.apiKeyCreatedAt || new Date().toISOString() });
    } else {
      res.json({ success: true, hasApiKey: false });
    }
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ── /api/user/generate-api-key ──────────────────────────────────
app.post('/api/user/generate-api-key', checkAuth, async (req, res) => {
  try {
    const newKey = 'sbh_' + crypto.randomBytes(24).toString('hex');
    await db.collection('users').doc(req.user.uid).set({
      apiKey: newKey, apiKeyCreatedAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });
    res.json({ success: true, apiKey: newKey, prefix: newKey.substring(0, 8) });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ── /api/user/revoke-api-key ────────────────────────────────────
app.post('/api/user/revoke-api-key', checkAuth, async (req, res) => {
  try {
    await db.collection('users').doc(req.user.uid).update({
      apiKey: admin.firestore.FieldValue.delete(),
      apiKeyCreatedAt: admin.firestore.FieldValue.delete(),
    });
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ═══════════════════════════════════════════════════════════════
// Fapshi – Paiement Mobile Money (Cameroun)
// ═══════════════════════════════════════════════════════════════

// ── POST /api/create-fapshi-checkout ────────────────────────────
// Initie un paiement Fapshi, enregistre la transaction PENDING dans
// Firestore et renvoie l'URL de paiement au client.
app.post('/api/create-fapshi-checkout', checkAuth, async (req, res) => {
  const uid = req.user.uid;
  const { amount, currency, description, redirectUrl, phone } = req.body;

  if (!amount || !redirectUrl) {
    return res.status(400).json({ success: false, error: 'amount et redirectUrl sont requis.' });
  }

  const amountNum = Math.round(Number(amount));
  if (isNaN(amountNum) || amountNum < 100) {
    return res.status(400).json({ success: false, error: 'Montant invalide (minimum 100 FCFA).' });
  }

  const API_USER   = process.env.FAPSHI_API_USER;
  const SECRET_KEY = process.env.FAPSHI_SECRET_KEY;

  if (!API_USER || !SECRET_KEY) {
    console.error('❌ Fapshi: variables FAPSHI_API_USER ou FAPSHI_SECRET_KEY manquantes');
    return res.status(500).json({ success: false, error: 'Configuration Fapshi incomplète.' });
  }

  // URL du webhook : env var ou construite depuis l'hôte de la requête
  const webhookBase = process.env.FAPSHI_WEBHOOK_URL
    || `https://${req.headers['x-forwarded-host'] || req.headers.host}`;
  const webhookUrl = `${webhookBase}/api/fapshi-webhook`;

  const payload = {
    amount:      amountNum,
    currency:    currency || 'XAF',
    description: description || 'Recharge Social Boost Horizon',
    redirect_url: redirectUrl,
    webhook_url:  webhookUrl,
    ...(phone ? { phone } : {}),
  };

  console.log(`>>> Fapshi checkout — user:${uid} amount:${amountNum} webhook:${webhookUrl}`);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12000);

  try {
    const fapshiRes = await fetch('https://live.fapshi.com/initiate-pay', {
      method:  'POST',
      headers: {
        'Content-Type': 'application/json',
        'apiuser': API_USER,
        'apikey':  SECRET_KEY,
      },
      body:   JSON.stringify(payload),
      signal: controller.signal,
    });
    clearTimeout(timer);

    const rawText = await fapshiRes.text();
    console.log('>>> Fapshi response:', fapshiRes.status, rawText.substring(0, 300));

    let respJson;
    try {
      respJson = JSON.parse(rawText);
    } catch {
      return res.status(502).json({ success: false, error: 'Réponse Fapshi non-JSON', details: rawText });
    }

    if (!fapshiRes.ok) {
      const errMsg = respJson.message || respJson.error || `Erreur Fapshi ${fapshiRes.status}`;
      return res.status(fapshiRes.status).json({ success: false, error: errMsg });
    }

    const checkoutUrl   = respJson.data?.url || respJson.link || respJson.url;
    const fapshiTransId = respJson.transId   || respJson.data?.transId || null;

    if (!checkoutUrl) {
      console.error('❌ Fapshi: URL de paiement manquante', respJson);
      return res.status(502).json({ success: false, error: 'URL de paiement manquante dans la réponse Fapshi.' });
    }

    // Enregistrer la transaction avec statut PENDING avant redirection
    const transDocId = fapshiTransId || db.collection('fapshiTransactions').doc().id;
    await db.collection('fapshiTransactions').doc(transDocId).set({
      fapshiTransId:   fapshiTransId,
      userId:          uid,
      amount:          amountNum,
      currency:        currency || 'XAF',
      description:     description || 'Recharge Social Boost Horizon',
      phone:           phone || null,
      status:          'PENDING',
      dateInitiated:   admin.firestore.FieldValue.serverTimestamp(),
      checkoutUrl,
    });

    // Sauvegarder le numéro de paiement pour les prochaines fois
    if (phone) {
      await db.collection('users').doc(uid).set({ paymentPhone: phone }, { merge: true });
    }

    console.log(`✅ Transaction Fapshi (${transDocId}) créée — statut PENDING — user: ${uid}`);
    return res.json({ success: true, checkoutUrl });

  } catch (err) {
    clearTimeout(timer);
    if (err.name === 'AbortError') {
      console.error('❌ Fapshi: timeout');
      return res.status(504).json({ success: false, error: 'Délai dépassé: Fapshi ne répond pas.' });
    }
    console.error('❌ /api/create-fapshi-checkout :', err.message);
    return res.status(500).json({ success: false, error: 'Erreur lors de la communication avec Fapshi.' });
  }
});

// ── POST /api/fapshi-webhook ─────────────────────────────────────
// Appelé par Fapshi lors de la confirmation du paiement.
// Aucune authentification Firebase (requête entrante de Fapshi).
app.post('/api/fapshi-webhook', async (req, res) => {
  console.log('>>> Fapshi Webhook reçu:', JSON.stringify(req.body, null, 2));

  const { status, amount, transId } = req.body;

  if (status !== 'SUCCESSFUL') {
    console.warn(`>>> Statut "${status}" ignoré (non-SUCCESSFUL).`);
    return res.status(200).json({ message: 'Statut non-SUCCESSFUL ignoré.' });
  }

  if (!transId || isNaN(Number(amount))) {
    console.error('❌ Webhook Fapshi: transId ou amount invalide', { transId, amount });
    return res.status(400).json({ error: 'Données webhook invalides (transId ou amount manquant).' });
  }

  const amountNum = Number(amount);
  const transRef  = db.collection('fapshiTransactions').doc(transId);

  try {
    const transDoc = await transRef.get();

    if (!transDoc.exists) {
      console.error(`❌ Transaction ${transId} introuvable dans fapshiTransactions`);
      return res.status(200).json({ message: 'Transaction inconnue, ignorée.' });
    }

    const transData = transDoc.data();

    // Éviter les doubles confirmations
    if (transData.status === 'CONFIRMED') {
      console.warn(`⚠️ Transaction ${transId} déjà confirmée — ignorée.`);
      return res.status(200).json({ message: 'Déjà confirmée.' });
    }

    const userId = transData.userId;
    if (!userId) {
      console.error(`❌ userId manquant dans la transaction ${transId}`);
      return res.status(500).json({ error: 'userId manquant dans la transaction.' });
    }

    // 1. Marquer la transaction CONFIRMED
    await transRef.update({
      status:        'CONFIRMED',
      amountConfirmed: amountNum,
      dateConfirmed: admin.firestore.FieldValue.serverTimestamp(),
    });

    // 2. Mettre à jour le solde utilisateur (transaction atomique)
    const userRef = db.collection('users').doc(userId);
    await db.runTransaction(async (t) => {
      const userDoc = await t.get(userRef);
      if (!userDoc.exists) {
        t.set(userRef, { balance: amountNum });
        console.warn(`⚠️ Utilisateur ${userId} créé avec solde initial ${amountNum}.`);
      } else {
        const newBalance = (userDoc.data().balance || 0) + amountNum;
        t.update(userRef, { balance: newBalance });
        console.log(`✅ Solde mis à jour: ${userId} — +${amountNum} FCFA → ${newBalance} FCFA`);
      }
    });

    // 3. Bonus parrainage 5% (non bloquant)
    let bonusApplied = false;
    try {
      const filleulDoc  = await userRef.get();
      const parrainUid  = filleulDoc.exists ? (filleulDoc.data().referredBy || null) : null;

      if (parrainUid) {
        const bonusAmount = Math.floor(amountNum * 0.05);
        if (bonusAmount > 0) {
          const parrainRef = db.collection('users').doc(parrainUid);
          await parrainRef.set(
            { referralBalance: admin.firestore.FieldValue.increment(bonusAmount) },
            { merge: true }
          );
          await parrainRef.collection('referrals').add({
            refereeUid:    userId,
            amount:        amountNum,
            referrerShare: bonusAmount,
            type:          'deposit_bonus_fapshi',
            transactionId: transId,
            date:          admin.firestore.FieldValue.serverTimestamp(),
            status:        'completed',
          });
          bonusApplied = true;
          console.log(`🎁 Bonus parrainage: ${bonusAmount} FCFA → ${parrainUid}`);
        }
      }
    } catch (referralErr) {
      console.error('⚠️ Erreur bonus parrainage (non bloquante):', referralErr.message);
    }

    return res.status(200).json({ message: 'Webhook traité avec succès.', bonusApplied });

  } catch (err) {
    console.error('❌ /api/fapshi-webhook :', err.message);
    return res.status(500).json({ error: 'Erreur interne lors du traitement du webhook.' });
  }
});

// ── GET /api/fapshi/transactions ─────────────────────────────────
// Renvoie les 20 dernières transactions Fapshi de l'utilisateur connecté.
// Utilisé par fonds.html pour l'historique (en complément du listener Firestore).
app.get('/api/fapshi/transactions', checkAuth, async (req, res) => {
  try {
    const uid = req.user.uid;
    const snapshot = await db.collection('fapshiTransactions')
      .where('userId', '==', uid)
      .orderBy('dateInitiated', 'desc')
      .limit(20)
      .get();

    const transactions = snapshot.docs.map(doc => ({
      id:            doc.id,
      ...doc.data(),
      dateInitiated: doc.data().dateInitiated || null,
      dateConfirmed: doc.data().dateConfirmed || null,
    }));

    res.json({ success: true, transactions });
  } catch (error) {
    console.error('❌ /api/fapshi/transactions :', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ── 404 ─────────────────────────────────────────────────────────
app.use((req, res) => {
  res.status(404).json({ success: false, error: `Route non trouvée : ${req.method} ${req.path}` });
});

// ── Erreur globale ──────────────────────────────────────────────
app.use((err, req, res, next) => {
  console.error('❌ Erreur globale :', err.stack);
  res.status(500).json({ success: false, error: err.message || 'Erreur interne.' });
});

module.exports = app;
