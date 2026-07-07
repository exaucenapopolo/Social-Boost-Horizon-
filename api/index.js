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
app.get('/api/mtp/services', async (req, res) => {
  try {
    const now = Date.now();
    if (_mtpServicesCache && (now - _mtpServicesCacheTime) < MTP_CACHE_TTL) {
      return res.json({ success: true, services: _mtpServicesCache, cached: true });
    }
    const rawServices = await callMTP({ action: 'services' });
    if (!Array.isArray(rawServices)) {
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
    res.json({ success: true, services });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ── POST /api/mtp/order ──────────────────────────────────────────
app.post('/api/mtp/order', checkAuth, async (req, res) => {
  const { serviceId, link, quantity, comments } = req.body;
  const uid = req.user.uid;
  if (!serviceId || !link) {
    return res.status(400).json({ success: false, error: 'serviceId et link sont requis.' });
  }
  try {
    const allServices = _mtpServicesCache || (await callMTP({ action: 'services' }));
    const service = allServices.find(s => parseInt(s.service || s.id) === parseInt(serviceId));
    if (!service) {
      return res.status(400).json({ success: false, error: 'Service introuvable ou expiré.' });
    }
    const rate      = parseFloat(service.rate) || 0;
    const priceXAF  = Math.round(rate * MTP_USD_TO_XAF * MTP_MULTIPLIER);
    const qty       = parseInt(quantity);
    const isPackage = (service.type || '').toLowerCase().includes('package');
    const cost      = isPackage ? priceXAF : Math.round((priceXAF / 1000) * qty);

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

    const orderParams = { action: 'add', service: serviceId, link, quantity: qty };
    if (comments) orderParams.comments = comments;
    const orderResult = await callMTP(orderParams);

    if (orderResult.error) {
      return res.status(400).json({ success: false, error: 'Erreur fournisseur : ' + orderResult.error });
    }
    if (!orderResult.order) {
      return res.status(400).json({ success: false, error: 'Commande non confirmée.' });
    }

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

    res.json({ success: true, orderId: finalOrderId, newBalance });
  } catch (error) {
    if (error.message.toLowerCase().includes('insuffisant')) {
      return res.status(400).json({ success: false, error: error.message });
    }
    res.status(500).json({ success: false, error: 'Erreur technique. Veuillez réessayer.' });
  }
});

// ── GET /api/mtp/user-orders ─────────────────────────────────────
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
    res.status(500).json({ success: false, error: error.message });
  }
});

// ── GET /api/mtp/order-status/:orderId ──────────────────────────
app.get('/api/mtp/order-status/:orderId', checkAuth, async (req, res) => {
  const { orderId } = req.params;
  const uid         = req.user.uid;
  try {
    const snapshot = await db.collection('autoOrders')
      .where('orderId', '==', orderId).where('userId', '==', uid).limit(1).get();
    if (snapshot.empty) return res.status(404).json({ success: false, error: 'Commande introuvable.' });

    const orderDoc  = snapshot.docs[0];
    const orderData = orderDoc.data();
    const statusResult = await callMTP({ action: 'status', order: orderData.providerOrderId });

    if (statusResult.error) return res.status(400).json({ success: false, error: 'Erreur: ' + statusResult.error });

    const newStatus  = MTP_STATUS_MAP[statusResult.status] || statusResult.status || 'En attente';
    const startCount = parseInt(statusResult.start_count)  || 0;
    const remains    = parseInt(statusResult.remains)       || 0;

    await orderDoc.ref.update({
      status:             newStatus,
      providerStartCount: startCount,
      providerRemains:    remains,
      lastChecked:        admin.firestore.FieldValue.serverTimestamp(),
    });

    res.json({ success: true, status: newStatus, providerStatus: statusResult.status, startCount, remains });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ── POST /api/mtp/refill ─────────────────────────────────────────
app.post('/api/mtp/refill', checkAuth, async (req, res) => {
  const { orderId } = req.body;
  const uid         = req.user.uid;
  if (!orderId) return res.status(400).json({ success: false, error: 'orderId requis.' });
  try {
    const snapshot = await db.collection('autoOrders')
      .where('orderId', '==', orderId).where('userId', '==', uid).limit(1).get();
    if (snapshot.empty) return res.status(404).json({ success: false, error: 'Commande introuvable.' });

    const orderDoc  = snapshot.docs[0];
    const orderData = orderDoc.data();
    if (!orderData.refill && orderData.refill !== undefined) {
      return res.status(400).json({ success: false, error: 'Ce service ne supporte pas le refill.' });
    }

    const result = await callMTP({ action: 'refill', order: orderData.providerOrderId });
    if (result.error) return res.status(400).json({ success: false, error: 'Erreur: ' + result.error });

    await orderDoc.ref.update({
      lastRefill: admin.firestore.FieldValue.serverTimestamp(),
      refillId: result.refill || null,
    });
    res.json({ success: true, refillId: result.refill });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ── POST /api/mtp/cancel ─────────────────────────────────────────
app.post('/api/mtp/cancel', checkAuth, async (req, res) => {
  const { orderId } = req.body;
  const uid         = req.user.uid;
  if (!orderId) return res.status(400).json({ success: false, error: 'orderId requis.' });
  try {
    const snapshot = await db.collection('autoOrders')
      .where('orderId', '==', orderId).where('userId', '==', uid).limit(1).get();
    if (snapshot.empty) return res.status(404).json({ success: false, error: 'Commande introuvable.' });

    const orderDoc  = snapshot.docs[0];
    const orderData = orderDoc.data();

    if (orderData.refunded) return res.status(400).json({ success: false, error: 'Déjà remboursée.' });
    if (['Terminé', 'Completed'].includes(orderData.status)) return res.status(400).json({ success: false, error: 'Impossible.' });

    try { await callMTP({ action: 'cancel', orders: orderData.providerOrderId }); } catch (mtpErr) { }

    let refundAmount = orderData.priceXAF || 0;
    if (orderData.status === 'Partiel' || orderData.status === 'Partial') {
      const qty     = orderData.quantity || 1;
      const remains = orderData.providerRemains !== undefined ? orderData.providerRemains : qty;
      refundAmount  = Math.round((remains / qty) * refundAmount);
    }

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
    res.json({ success: true, refundedAmount: refundAmount });
  } catch (error) {
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
    const nameForEmail = displayName || req.user.name || (email || req.user.email || '').split('@')[0] || 'Nouveau Membre';
    const userEmail = email || req.user.email;
    if (!userEmail) return res.status(400).json({ success: false, error: 'Email manquant.' });

    let emailSent = false;
    try {
      await sendWelcomeEmail({ email: userEmail, username: nameForEmail, country: country || 'Non spécifié' });
      emailSent = true;
    } catch (emailErr) {}

    res.status(200).json({ success: true, emailSent });
  } catch (error) {
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
          displayName: req.user.name || '', email: req.user.email || '', photoURL: req.user.picture || null,
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
        phone:         data.phone       || '', country: data.country || '',
        balance:       data.balance     || 0, totalOrders: data.totalOrders || 0,
        createdAt:     data.createdAt   || new Date().toISOString(),
        settings:      data.settings    || {}, resellerLevel: data.resellerLevel || 'bronze',
        lastSignIn:    data.lastSignIn  || null,
      }
    });
  } catch (error) {
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
    res.status(500).json({ success: false, error: error.message });
  }
});

// ── /api/user/settings ──────────────────────────────────────────
app.post('/api/user/settings', checkAuth, async (req, res) => {
  const { settings } = req.body;
  if (!settings || typeof settings !== 'object') return res.status(400).json({ success: false, error: 'Paramètres invalides' });
  try {
    await db.collection('users').doc(req.user.uid).set({ settings }, { merge: true });
    res.json({ success: true, settings });
  } catch (error) {
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
      apiKey: admin.firestore.FieldValue.delete(), apiKeyCreatedAt: admin.firestore.FieldValue.delete(),
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
app.post('/api/create-fapshi-checkout', checkAuth, async (req, res) => {
  const uid = req.user.uid;
  const { amount, currency, description, redirectUrl, phone } = req.body;

  if (!amount || !redirectUrl) return res.status(400).json({ success: false, error: 'amount et redirectUrl requis.' });
  const amountNum = Math.round(Number(amount));
  if (isNaN(amountNum) || amountNum < 100) return res.status(400).json({ success: false, error: 'Montant invalide.' });

  const API_USER   = process.env.FAPSHI_API_USER;
  const SECRET_KEY = process.env.FAPSHI_SECRET_KEY;

  if (!API_USER || !SECRET_KEY) return res.status(500).json({ success: false, error: 'Configuration Fapshi incomplète.' });

  const webhookBase = process.env.FAPSHI_WEBHOOK_URL || `https://${req.headers['x-forwarded-host'] || req.headers.host}`;
  const webhookUrl = `${webhookBase}/api/fapshi-webhook`;

  const payload = {
    amount: amountNum, currency: currency || 'XAF', description: description || 'Recharge Social Boost Horizon',
    redirect_url: redirectUrl, webhook_url: webhookUrl, ...(phone ? { phone } : {}),
  };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12000);

  try {
    const fapshiRes = await fetch('https://live.fapshi.com/initiate-pay', {
      method:  'POST', headers: { 'Content-Type': 'application/json', 'apiuser': API_USER, 'apikey':  SECRET_KEY },
      body: JSON.stringify(payload), signal: controller.signal,
    });
    clearTimeout(timer);

    const rawText = await fapshiRes.text();
    let respJson;
    try { respJson = JSON.parse(rawText); } catch { return res.status(502).json({ success: false, error: 'Réponse Fapshi non-JSON' }); }

    if (!fapshiRes.ok) return res.status(fapshiRes.status).json({ success: false, error: respJson.message || respJson.error });

    const checkoutUrl   = respJson.data?.url || respJson.link || respJson.url;
    const fapshiTransId = respJson.transId   || respJson.data?.transId || null;

    if (!checkoutUrl) return res.status(502).json({ success: false, error: 'URL manquante dans la réponse Fapshi.' });

    const transDocId = fapshiTransId || db.collection('fapshiTransactions').doc().id;
    await db.collection('fapshiTransactions').doc(transDocId).set({
      fapshiTransId:   fapshiTransId, userId: uid, amount: amountNum,
      currency: currency || 'XAF', description: description || 'Recharge SBH',
      phone: phone || null, status: 'PENDING',
      dateInitiated: admin.firestore.FieldValue.serverTimestamp(), checkoutUrl,
    });

    if (phone) await db.collection('users').doc(uid).set({ paymentPhone: phone }, { merge: true });

    return res.json({ success: true, checkoutUrl });
  } catch (err) {
    clearTimeout(timer);
    if (err.name === 'AbortError') return res.status(504).json({ success: false, error: 'Délai dépassé: Fapshi ne répond pas.' });
    return res.status(500).json({ success: false, error: 'Erreur communication avec Fapshi.' });
  }
});

// ── GET /api/fapshi-webhook ──────────────────────────────────────
app.get('/api/fapshi-webhook', (req, res) => {
  res.status(200).send("Endpoint Webhook actif. Fapshi utilise la méthode POST.");
});

// ── POST /api/fapshi-webhook ─────────────────────────────────────
app.post('/api/fapshi-webhook', async (req, res) => {
  const { status, amount, transId } = req.body;
  if (status !== 'SUCCESSFUL') return res.status(200).json({ message: 'Statut ignoré.' });
  if (!transId || isNaN(Number(amount))) return res.status(400).json({ error: 'Données invalides.' });

  const amountNum = Number(amount);
  const transRef  = db.collection('fapshiTransactions').doc(transId);

  try {
    const transDoc = await transRef.get();
    if (!transDoc.exists) return res.status(200).json({ message: 'Transaction inconnue.' });

    const transData = transDoc.data();
    if (transData.status === 'CONFIRMED') return res.status(200).json({ message: 'Déjà confirmée.' });

    const userId = transData.userId;
    if (!userId) return res.status(500).json({ error: 'userId manquant.' });

    await transRef.update({
      status: 'CONFIRMED', amountConfirmed: amountNum, dateConfirmed: admin.firestore.FieldValue.serverTimestamp(),
    });

    const userRef = db.collection('users').doc(userId);
    await db.runTransaction(async (t) => {
      const userDoc = await t.get(userRef);
      if (!userDoc.exists) {
        t.set(userRef, { balance: amountNum });
      } else {
        const newBalance = (userDoc.data().balance || 0) + amountNum;
        t.update(userRef, { balance: newBalance });
      }
    });

    // Parrainage bonus
    let bonusApplied = false;
    try {
      const filleulDoc = await userRef.get();
      const parrainUid = filleulDoc.exists ? (filleulDoc.data().referredBy || null) : null;
      if (parrainUid) {
        const bonusAmount = Math.floor(amountNum * 0.05);
        if (bonusAmount > 0) {
          const parrainRef = db.collection('users').doc(parrainUid);
          await parrainRef.set({ referralBalance: admin.firestore.FieldValue.increment(bonusAmount) }, { merge: true });
          await parrainRef.collection('referrals').add({
            refereeUid: userId, amount: amountNum, referrerShare: bonusAmount,
            type: 'deposit_bonus_fapshi', transactionId: transId,
            date: admin.firestore.FieldValue.serverTimestamp(), status: 'completed',
          });
          bonusApplied = true;
        }
      }
    } catch (e) {}

    return res.status(200).json({ message: 'Webhook traité.', bonusApplied });
  } catch (err) {
    return res.status(500).json({ error: 'Erreur webhook.' });
  }
});

// ── POST /api/fapshi/verify-transaction ──────────────────────────
// Vérifie le statut d'une transaction UNIQUE en faisant les lectures avant les écritures
app.post('/api/fapshi/verify-transaction', checkAuth, async (req, res) => {
  const uid = req.user.uid;
  const { transId } = req.body;
  const API_USER   = process.env.FAPSHI_API_USER;
  const SECRET_KEY = process.env.FAPSHI_SECRET_KEY;

  if (!transId) return res.status(400).json({ success: false, error: 'ID de transaction requis.' });
  if (!API_USER || !SECRET_KEY) return res.status(500).json({ success: false, error: 'Clés Fapshi manquantes.' });

  try {
    const transRef = db.collection('fapshiTransactions').doc(transId);
    const transDoc = await transRef.get();

    if (!transDoc.exists || transDoc.data().userId !== uid) {
      return res.status(404).json({ success: false, error: "Transaction introuvable pour ce compte." });
    }

    const transData = transDoc.data();
    if (transData.status === 'CONFIRMED') {
      return res.json({ success: true, status: 'CONFIRMED', message: "La transaction est déjà confirmée." });
    }

    // Récupérer l'ID exact de Fapshi s'il est différent du doc ID
    const fapshiID = transData.fapshiTransId || transId;
    
    // Interroger l'API Fapshi
    const fapshiRes = await fetch(`https://live.fapshi.com/payment-status/${fapshiID}`, {
      method: 'GET',
      headers: { 'apiuser': API_USER, 'apikey': SECRET_KEY }
    });

    if (!fapshiRes.ok) {
      return res.status(502).json({ success: false, error: `Erreur Fapshi : ${fapshiRes.status}` });
    }

    const statusData = await fapshiRes.json();
    const paymentObj = Array.isArray(statusData) ? statusData[0] : statusData;
    const paymentStatus = paymentObj.status || paymentObj.paymentStatus || statusData.status;

    if (paymentStatus === 'SUCCESSFUL') {
      const amountNum = Number(paymentObj.amount || transData.amount);
      const userRef = db.collection('users').doc(uid);

      // LE CORRECTIF EST ICI : Toutes les lectures (t.get) sont faites AVANT les écritures (t.set / t.update)
      await db.runTransaction(async (t) => {
        // 1. On lit toutes les données d'abord
        const freshTransDoc = await t.get(transRef);
        const userDoc = await t.get(userRef);

        if (freshTransDoc.exists && freshTransDoc.data().status === 'CONFIRMED') {
          return; // Sécurité anti-double exécution
        }

        // 2. On effectue toutes les écritures ensuite
        t.update(transRef, {
          status: 'CONFIRMED',
          amountConfirmed: amountNum,
          dateConfirmed: admin.firestore.FieldValue.serverTimestamp(),
        });

        const currentBalance = userDoc.exists ? (userDoc.data().balance || 0) : 0;
        t.set(userRef, { balance: currentBalance + amountNum }, { merge: true });
      });

      // Bonus de parrainage (hors de la transaction principale pour éviter de tout bloquer)
      try {
        const userDocData = await userRef.get();
        const parrainUid = userDocData.exists ? (userDocData.data().referredBy || null) : null;
        if (parrainUid) {
          const bonusAmount = Math.floor(amountNum * 0.05);
          if (bonusAmount > 0) {
            const parrainRef = db.collection('users').doc(parrainUid);
            await parrainRef.set({ referralBalance: admin.firestore.FieldValue.increment(bonusAmount) }, { merge: true });
            await parrainRef.collection('referrals').add({
              refereeUid: uid, amount: amountNum, referrerShare: bonusAmount,
              type: 'deposit_bonus_fapshi', transactionId: transId,
              date: admin.firestore.FieldValue.serverTimestamp(), status: 'completed',
            });
          }
        }
      } catch (refErr) {}

      return res.json({ success: true, status: 'CONFIRMED' });

    } else if (paymentStatus === 'FAILED' || paymentStatus === 'EXPIRED') {
      await transRef.update({
        status: 'FAILED',
        dateUpdated: admin.firestore.FieldValue.serverTimestamp()
      });
      return res.json({ success: true, status: 'FAILED' });
    } else {
      // PENDING ou autre statut intermédiaire
      return res.json({ success: true, status: 'PENDING' });
    }

  } catch (error) {
    console.error('❌ /api/fapshi/verify-transaction:', error.message);
    res.status(500).json({ success: false, error: 'Erreur technique lors de la vérification.' });
  }
});

// ── GET /api/fapshi/transactions ─────────────────────────────────
app.get('/api/fapshi/transactions', checkAuth, async (req, res) => {
  try {
    const uid = req.user.uid;
    const snapshot = await db.collection('fapshiTransactions')
      .where('userId', '==', uid).orderBy('dateInitiated', 'desc').limit(20).get();
    const transactions = snapshot.docs.map(doc => ({
      id: doc.id, ...doc.data(),
      dateInitiated: doc.data().dateInitiated || null,
      dateConfirmed: doc.data().dateConfirmed || null,
    }));
    res.json({ success: true, transactions });
  } catch (error) {
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