const express = require('express');
const cors    = require('cors');
const admin   = require('firebase-admin');
const crypto  = require('crypto');

const { sendWelcomeEmail, sendPartnershipEmail, sendAdminUserMessage } = require('./email-service.js');

const app = express();

app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'x-admin-password', 'X-Api-Key'],
  exposedHeaders: ['X-Api-Key']
}));
app.use(express.json({ limit: '10mb' }));

app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
  next();
});

function getTimestampMs(val) {
  if (!val) return 0;
  if (typeof val.toDate === 'function') { try { return val.toDate().getTime(); } catch(_){} }
  if (val instanceof Date) return val.getTime();
  if (typeof val === 'number') return val;
  if (typeof val === 'object' && (val._seconds !== undefined || val.seconds !== undefined)) {
    return Number(val._seconds !== undefined ? val._seconds : val.seconds) * 1000;
  }
  const parsed = new Date(val).getTime();
  return isNaN(parsed) ? 0 : parsed;
}

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

function addAdminOperationLog(transaction, details = {}) {
  const ref = db.collection('adminOperationLogs').doc();
  transaction.set(ref, {
    type: details.type || 'operation',
    category: details.category || 'autre',
    action: details.action || 'Opération',
    userId: details.userId || null,
    amountXAF: Number(details.amountXAF || 0),
    provider: details.provider || null,
    transactionId: details.transactionId || null,
    status: details.status || 'CONFIRMED',
    balanceBefore: details.balanceBefore == null ? null : Number(details.balanceBefore),
    balanceAfter: details.balanceAfter == null ? null : Number(details.balanceAfter),
    serviceName: details.serviceName || null,
    source: details.source || 'system',
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  });
}

const SBH_WA_DISPLAY = '+1 (423) 675-2034';
const SBH_WA_LINK    = 'https://wa.me/14236752034';
const SBH_SITE_URL   = 'https://socialboosthorizon.com/';
const SBH_DASHBOARD  = 'https://socialboosthorizon.com/dashboard';

// ═══════════════════════════════════════════════════════════════
// ✅ FIX #1 : Champs de date connus par collection (codés en dur
// pour éviter toute détection hasardeuse)
// ═══════════════════════════════════════════════════════════════
const KNOWN_DATE_FIELD = {
  'commandes': 'date',               // EXO (order-exo.js)
  'autoOrders': 'createdAt',         // MTP, AfriqueBoost, SMMWiz
  'fapshiTransactions': 'createdAt', // Fapshi
  'paymentTransactions': 'createdAt',// NelsiusPay
  'transactions': 'createdAt',       // Swychr (create-swychr.js)
  'orders': 'createdAt',
  'orders_automatique': 'createdAt',
  'orders_avancee': 'createdAt',
  'orders_standard_revendeur': 'createdAt',
  'welcomeGiftClaims': 'createdAt',
  'users': 'createdAt',
  'stores': 'createdAt',
  'payments': 'createdAt',
  'rechargements': 'createdAt',
  'recharges': 'createdAt',
  'partnerRequests': 'createdAt',
};

// ═══════════════════════════════════════════════════════════════
// ✅ FIX #2 : Fournisseur connu par collection (évite le bug
// du provider null qui empêchait de calculer la marge EXO)
// ═══════════════════════════════════════════════════════════════
const KNOWN_PROVIDER_BY_COLLECTION = {
  'commandes': 'EXO',                // order-exo.js
  'fapshiTransactions': 'Fapshi',
  'paymentTransactions': 'NelsiusPay',
  'transactions': 'Swychr',          // create-swychr.js
};

function giftNeedsLinkConfirmation(giftType) {
  return giftType === 'likes' || giftType === 'tiktok';
}
function giftPlainLabel(giftType) {
  if (giftType === 'money')  return '25 FCFA crédités sur votre solde';
  if (giftType === 'likes')  return '25 Likes offerts';
  if (giftType === 'tiktok') return '1000 Vues TikTok offertes';
  return 'cadeau de bienvenue';
}
function giftAgeInDays(createdAtValue) {
  const ms = getTimestampMs(createdAtValue);
  if (!ms) return null;
  return Math.max(0, Math.floor((Date.now() - ms) / (24 * 60 * 60 * 1000)));
}
function giftAgeLabel(createdAtValue) {
  const d = giftAgeInDays(createdAtValue);
  if (d === null) return 'récemment';
  if (d === 0) return "aujourd'hui";
  if (d === 1) return 'hier';
  return `il y a ${d} jours`;
}

function localDateKey(date = new Date()) {
  const shifted = new Date(date.getTime() + 60 * 60 * 1000);
  const y = shifted.getUTCFullYear();
  const m = String(shifted.getUTCMonth() + 1).padStart(2, '0');
  const d = String(shifted.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

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

app.get('/api/health', (req, res) => {
  res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

const MTP_API_URL    = 'https://morethanpanel.com/api/v2';
const MTP_USD_TO_XAF = 650;
const MTP_MULTIPLIER = 2.5;

const EXO_API_URL    = 'https://exosupplier.com/api/v2';
const EXO_USD_TO_XAF = 650;
const EXO_MULTIPLIER = 1.51;

const AFRIQUEBOOST_API_URL = 'https://afriqueboost.com/api/v2';
const AFB_MULTIPLIER       = 2.5;

const SMMWIZ_API_URL      = 'https://smmwiz.com/api/v2';
const SMMWIZ_USD_TO_XAF   = 650;
const SMMWIZ_MULTIPLIER   = 3.5;

const SMMGEN_API_URL      = 'https://my.smmgen.com/api/v2';
const SMMGEN_USD_TO_XAF   = 650;
const SMMGEN_MULTIPLIER   = 3.5;

function detectPlatformName(serviceName, link) {
  const n = ((serviceName || '') + ' ' + (link || '')).toLowerCase();
  if (n.includes('instagram')) return 'Instagram';
  if (n.includes('facebook') || n.includes('fb.com')) return 'Facebook';
  if (n.includes('tiktok')) return 'TikTok';
  if (n.includes('youtube') || n.includes('youtu.be')) return 'YouTube';
  if (n.includes('twitter') || n.includes('x.com')) return 'X (Twitter)';
  if (n.includes('telegram') || n.includes('t.me')) return 'Telegram';
  if (n.includes('whatsapp')) return 'WhatsApp';
  if (n.includes('linkedin')) return 'LinkedIn';
  if (n.includes('spotify')) return 'Spotify';
  if (n.includes('twitch')) return 'Twitch';
  if (n.includes('discord')) return 'Discord';
  if (n.includes('snapchat')) return 'Snapchat';
  if (n.includes('pinterest')) return 'Pinterest';
  if (n.includes('soundcloud')) return 'SoundCloud';
  if (n.includes('threads')) return 'Threads';
  if (n.includes('reddit')) return 'Reddit';
  if (n.includes('google')) return 'Google';
  if (n.includes('netflix')) return 'Netflix';
  if (n.includes('free fire') || n.includes('freefire')) return 'Free Fire';
  if (n.includes('kick')) return 'Kick';
  return 'Autre';
}

const MTP_STATUS_MAP = {
  'Pending':     'En attente',
  'In progress': 'En cours',
  'Processing':  'En cours',
  'Completed':   'Terminé',
  'Partial':     'Partiel',
  'Canceled':    'Annulé',
};

async function callMTP(params) {
  if (!process.env.MORETHANPANEL_API_KEY) throw new Error('MORETHANPANEL_API_KEY non définie.');
  const body = new URLSearchParams({ key: process.env.MORETHANPANEL_API_KEY, ...params });
  const res  = await fetch(MTP_API_URL, {
    method: 'POST', body, headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  });
  if (!res.ok) throw new Error(`MTP HTTP ${res.status}`);
  return res.json();
}

async function callExo(params) {
  if (!process.env.EXO_API_KEY) throw new Error('EXO_API_KEY manquante');
  const body = new URLSearchParams({ key: process.env.EXO_API_KEY, ...params });
  const res = await fetch(EXO_API_URL, {
    method: 'POST', body, headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  });
  if (!res.ok) throw new Error(`EXO HTTP ${res.status}`);
  return res.json();
}

async function callAfriqueBoost(params) {
  if (!process.env.ADVANCED_PROVIDER_API_KEY) throw new Error('ADVANCED_PROVIDER_API_KEY non définie.');
  const body = new URLSearchParams({ key: process.env.ADVANCED_PROVIDER_API_KEY, ...params });
  const res  = await fetch(AFRIQUEBOOST_API_URL, {
    method: 'POST', body, headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  });
  if (!res.ok) throw new Error(`AfriqueBoost HTTP ${res.status}`);
  return res.json();
}

async function callSmmWiz(params) {
  if (!process.env.SMMWIZ_API_KEY) throw new Error('SMMWIZ_API_KEY non définie.');
  const body = new URLSearchParams({ key: process.env.SMMWIZ_API_KEY, ...params });
  const res  = await fetch(SMMWIZ_API_URL, {
    method: 'POST', body, headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  });
  if (!res.ok) throw new Error(`SMMWiz HTTP ${res.status}`);
  return res.json();
}

async function callSmmGen(params) {
  if (!process.env.SMMGEN_API_KEY) throw new Error('SMMGEN_API_KEY non définie.');
  const body = new URLSearchParams({ key: process.env.SMMGEN_API_KEY, ...params });
  const res  = await fetch(SMMGEN_API_URL, {
    method: 'POST', body, headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  });
  if (!res.ok) throw new Error(`SMMGen HTTP ${res.status}`);
  return res.json();
}

let _mtpServicesCache     = null;
let _mtpServicesCacheTime = 0;
const MTP_CACHE_TTL = 10 * 60 * 1000;

app.get('/api/mtp/services', async (req, res) => {
  try {
    const now = Date.now();
    if (_mtpServicesCache && (now - _mtpServicesCacheTime) < MTP_CACHE_TTL) {
      return res.json({ success: true, services: _mtpServicesCache, cached: true });
    }
    const rawServices = await callMTP({ action: 'services' });
    if (!Array.isArray(rawServices)) return res.status(500).json({ success: false, error: 'Réponse MTP invalide' });
    const services = rawServices.map(s => {
      const rate    = parseFloat(s.rate) || 0;
      const priceXAF = Math.round(rate * MTP_USD_TO_XAF * MTP_MULTIPLIER);
      return {
        id: parseInt(s.service), name: s.name, category: s.category || '', type: s.type || '',
        min: parseInt(s.min), max: parseInt(s.max), rate, priceXAF,
        refill: s.refill === true || s.refill === 'true', cancel: s.cancel === true || s.cancel === 'true',
        desc: s.description || null,
      };
    });
    _mtpServicesCache = services; _mtpServicesCacheTime = now;
    res.json({ success: true, services });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/api/mtp/order', checkAuth, async (req, res) => {
  const { serviceId, link, quantity, comments } = req.body;
  const uid = req.user.uid;
  if (!serviceId || !link) return res.status(400).json({ success: false, error: 'serviceId et link sont requis.' });
  try {
    const allServices = _mtpServicesCache || (await callMTP({ action: 'services' }));
    const service = allServices.find(s => parseInt(s.service || s.id) === parseInt(serviceId));
    if (!service) return res.status(400).json({ success: false, error: 'Service introuvable ou expiré.' });

    const rate = parseFloat(service.rate) || 0;
    const providerPricePer1000XAF = Math.round(rate * MTP_USD_TO_XAF);
    const priceXAF = Math.round(rate * MTP_USD_TO_XAF * MTP_MULTIPLIER);
    const qty = parseInt(quantity);
    const isPackage = (service.type || '').toLowerCase().includes('package');
    const cost = isPackage ? priceXAF : Math.round((priceXAF / 1000) * qty);
    const providerCostXAF = isPackage ? providerPricePer1000XAF : Math.round((providerPricePer1000XAF / 1000) * qty);
    const estimatedProfitXAF = cost - providerCostXAF;

    const userDoc = await db.collection('users').doc(uid).get();
    if (!userDoc.exists) return res.status(404).json({ success: false, error: 'Utilisateur introuvable.' });

    const currentBalance = userDoc.data().balance || 0;
    if (currentBalance < cost) {
      return res.status(400).json({
        success: false, error: `Solde insuffisant. Requis : ${cost.toLocaleString('fr-FR')} FCFA — Disponible : ${currentBalance.toLocaleString('fr-FR')} FCFA`,
      });
    }

    const orderParams = { action: 'add', service: serviceId, link, quantity: qty };
    if (comments) orderParams.comments = comments;
    const orderResult = await callMTP(orderParams);

    if (orderResult.error) return res.status(400).json({ success: false, error: 'Erreur fournisseur : ' + orderResult.error });
    if (!orderResult.order) return res.status(400).json({ success: false, error: 'Commande non confirmée.' });

    let finalOrderId, newBalance;
    await db.runTransaction(async (transaction) => {
      const counterRef = db.collection('counters').doc('autoOrders');
      const freshUserRef = db.collection('users').doc(uid);

      const counterDoc = await transaction.get(counterRef);
      const freshUserDoc = await transaction.get(freshUserRef);

      const freshBalance = freshUserDoc.data().balance || 0;
      if (freshBalance < cost) throw new Error('Solde insuffisant (vérifié pendant le traitement).');

      const nextId = ((counterDoc.exists ? counterDoc.data().lastId : 0) || 0) + 1;
      finalOrderId = `SBH-AUTO-${nextId}`;
      newBalance = freshBalance - cost;
      const platform = detectPlatformName(service.name || '', link);

      transaction.set(counterRef, { lastId: nextId }, { merge: true });
      transaction.update(freshUserRef, {
        balance: newBalance,
        totalOrders: admin.firestore.FieldValue.increment(1),
        totalSpent: admin.firestore.FieldValue.increment(cost),
        adminOrderCount: admin.firestore.FieldValue.increment(1),
        adminTotalSpent: admin.firestore.FieldValue.increment(cost),
        adminTotalProfit: admin.firestore.FieldValue.increment(estimatedProfitXAF),
        adminLastOrderAt: admin.firestore.FieldValue.serverTimestamp(),
        adminLastOrderAtMs: Date.now(),
      });

      const orderRef = db.collection('autoOrders').doc();
      transaction.set(orderRef, {
        orderId: finalOrderId, userId: uid, provider: 'mtp', providerOrderId: orderResult.order,
        serviceId: parseInt(serviceId), serviceName: service.name, platform, link, quantity: qty,
        priceXAF: cost, providerCostXAF, estimatedProfitXAF,
        providerMultiplier: MTP_MULTIPLIER, profitCalculationVersion: 1,
        status: 'En attente', createdAt: admin.firestore.FieldValue.serverTimestamp(),
        providerStartCount: 0, providerRemains: qty, refunded: false, refundedAmount: 0,
      });
      addAdminOperationLog(transaction, { type: 'order_debit', category: 'commande', action: 'Commande passée', userId: uid, amountXAF: cost, provider: 'MTP', transactionId: finalOrderId, status: 'CONFIRMED', balanceBefore: freshBalance, balanceAfter: newBalance, serviceName: service.name, source: 'order-api' });
    });
    res.json({ success: true, orderId: finalOrderId, newBalance });
  } catch (error) {
    if (error.message.toLowerCase().includes('insuffisant')) return res.status(400).json({ success: false, error: error.message });
    res.status(500).json({ success: false, error: 'Erreur technique. Veuillez réessayer.' });
  }
});

app.get('/api/mtp/user-orders', checkAuth, async (req, res) => {
  try {
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    const uid = req.user.uid;
    const snapshot = await db.collection('autoOrders').where('userId', '==', uid).get();
    let orders = snapshot.docs.map(doc => {
      const data = doc.data();
      return {
        id: doc.id, orderId: data.orderId, provider: data.provider || 'mtp', providerOrderId: data.providerOrderId,
        serviceId: data.serviceId, serviceName: data.serviceName || 'Service automatique', platform: data.platform || '',
        link: data.link || '', quantity: data.quantity || 0, priceXAF: data.priceXAF || 0, status: data.status || 'En attente',
        createdAt: data.createdAt, providerStartCount: data.providerStartCount || 0,
        providerRemains: data.providerRemains !== undefined ? data.providerRemains : (data.quantity || 0),
        refunded: data.refunded || false, refundedAmount: data.refundedAmount || 0, lastChecked: data.lastChecked || null,
      };
    });
    orders.sort((a, b) => getTimestampMs(b.createdAt) - getTimestampMs(a.createdAt));
    if (orders.length > 50) orders = orders.slice(0, 50);
    res.json({ success: true, orders });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.get('/api/mtp/order-status/:orderId', checkAuth, async (req, res) => {
  const { orderId } = req.params;
  const uid = req.user.uid;
  try {
    const snapshot = await db.collection('autoOrders').where('orderId', '==', orderId).limit(1).get();
    if (snapshot.empty) return res.status(404).json({ success: false, error: 'Commande introuvable.' });

    const orderDoc = snapshot.docs[0];
    const orderData = orderDoc.data();
    if (orderData.userId !== uid) return res.status(403).json({ success: false, error: 'Accès refusé.' });

    const statusResult = await callMTP({ action: 'status', order: orderData.providerOrderId });

    if (statusResult.error) return res.status(400).json({ success: false, error: 'Erreur: ' + statusResult.error });

    const newStatus = MTP_STATUS_MAP[statusResult.status] || statusResult.status || 'En attente';
    const startCount = parseInt(statusResult.start_count) || 0;
    const remains = parseInt(statusResult.remains) || 0;

    let refundAmount = 0;
    let isRefunded = orderData.refunded || false;

    if (!isRefunded && (newStatus === 'Annulé' || newStatus === 'Canceled' || newStatus === 'Partiel' || newStatus === 'Partial')) {
      let totalCost = orderData.priceXAF || 0;
      if (newStatus === 'Partiel' || newStatus === 'Partial') {
        const qty = orderData.quantity || 1;
        const rem = remains !== undefined ? remains : qty;
        refundAmount = Math.round((rem / qty) * totalCost);
      } else {
        refundAmount = totalCost;
      }

      if (refundAmount > 0) {
        await db.runTransaction(async (t) => {
          const freshOrder = await t.get(orderDoc.ref);
          if (freshOrder.data().refunded) return;

          const userRef = db.collection('users').doc(uid);
          const userDoc = await t.get(userRef);
          const bal = userDoc.exists ? (userDoc.data().balance || 0) : 0;

          t.update(userRef, { balance: bal + refundAmount });
          addAdminOperationLog(t, { type: 'order_refund', category: 'remboursement', action: 'Remboursement de commande', userId: uid, amountXAF: refundAmount, provider: 'MTP', transactionId: orderData.orderId || orderId, status: 'CONFIRMED', balanceBefore: bal, balanceAfter: bal + refundAmount, source: 'order-status' });
          t.update(orderDoc.ref, {
            status: newStatus, providerStartCount: startCount, providerRemains: remains,
            refunded: true, refundedAmount: refundAmount, lastChecked: admin.firestore.FieldValue.serverTimestamp()
          });
        });
        isRefunded = true;
      }
    } else {
      await orderDoc.ref.update({
        status: newStatus, providerStartCount: startCount, providerRemains: remains,
        lastChecked: admin.firestore.FieldValue.serverTimestamp(),
      });
    }
    res.json({ success: true, status: newStatus, providerStatus: statusResult.status, startCount, remains, refunded: isRefunded, refundAmount });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/api/mtp/refill', checkAuth, async (req, res) => {
  const { orderId } = req.body;
  const uid = req.user.uid;
  if (!orderId) return res.status(400).json({ success: false, error: 'orderId requis.' });
  try {
    const snapshot = await db.collection('autoOrders').where('orderId', '==', orderId).limit(1).get();
    if (snapshot.empty) return res.status(404).json({ success: false, error: 'Commande introuvable.' });

    const orderDoc = snapshot.docs[0];
    const orderData = orderDoc.data();
    if (orderData.userId !== uid) return res.status(403).json({ success: false, error: 'Accès refusé.' });
    if (!orderData.refill && orderData.refill !== undefined) return res.status(400).json({ success: false, error: 'Ce service ne supporte pas le refill.' });

    const result = await callMTP({ action: 'refill', order: orderData.providerOrderId });
    if (result.error) return res.status(400).json({ success: false, error: 'Erreur: ' + result.error });

    await orderDoc.ref.update({ lastRefill: admin.firestore.FieldValue.serverTimestamp(), refillId: result.refill || null });
    res.json({ success: true, refillId: result.refill });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/api/mtp/cancel', checkAuth, async (req, res) => {
  const { orderId } = req.body;
  const uid = req.user.uid;
  if (!orderId) return res.status(400).json({ success: false, error: 'orderId requis.' });
  try {
    const snapshot = await db.collection('autoOrders').where('orderId', '==', orderId).limit(1).get();
    if (snapshot.empty) return res.status(404).json({ success: false, error: 'Commande introuvable.' });

    const orderDoc = snapshot.docs[0];
    const orderData = orderDoc.data();
    if (orderData.userId !== uid) return res.status(403).json({ success: false, error: 'Accès refusé.' });

    const currentStatus = (orderData.status || '').toLowerCase();

    if (orderData.refunded) return res.status(400).json({ success: false, error: 'Cette commande a déjà été remboursée.' });
    if (!['en attente', 'pending', 'en cours', 'in progress', 'processing'].includes(currentStatus)) {
        return res.status(400).json({ success: false, error: 'Cette commande ne peut plus être annulée, son statut ne le permet pas.' });
    }

    try { await callMTP({ action: 'cancel', orders: orderData.providerOrderId }); }
    catch (mtpErr) { console.error("MTP Cancel Error:", mtpErr); }

    res.json({
        success: true,
        message: "Demande d'annulation transmise au fournisseur. Le remboursement sera effectué automatiquement dès que le fournisseur confirmera l'annulation."
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/api/exo/cancel', checkAuth, async (req, res) => {
    try {
        const uid = req.user.uid;
        const { orderId } = req.body;

        if (!orderId) return res.status(400).json({ success: false, error: 'ID de commande manquant.' });

        const orderRef = db.collection('commandes').doc(orderId);
        const orderDoc = await orderRef.get();

        if (!orderDoc.exists) return res.status(404).json({ success: false, error: 'Commande introuvable.' });

        const orderData = orderDoc.data();
        if (orderData.userId !== uid) return res.status(403).json({ success: false, error: 'Accès refusé.' });
        if (orderData.isRefunded) return res.status(400).json({ success: false, error: 'Cette commande a déjà été remboursée.' });

        const currentStatus = (orderData.status || '').toLowerCase();
        if (!['en attente', 'pending', 'en cours', 'in progress', 'processing'].includes(currentStatus)) {
            return res.status(400).json({ success: false, error: 'Action impossible : la commande est déjà terminée ou annulée.' });
        }

        let exoData = await callExo({ action: 'cancel', order: orderData.exoOrderId });

        if (exoData.error && exoData.error.toLowerCase().includes('incorrect action')) {
            return res.status(400).json({ success: false, error: "Le fournisseur n'autorise pas l'annulation de cette commande en cours." });
        }

        return res.status(200).json({
            success: true,
            message: "La demande d'annulation a bien été transmise au fournisseur."
        });
    } catch (error) {
        console.error("Erreur annulation:", error);
        return res.status(500).json({ success: false, error: error.message || 'Erreur technique serveur.' });
    }
});

app.post('/api/exo/refill', checkAuth, async (req, res) => {
  const { orderId } = req.body;
  const uid = req.user.uid;

  if (!orderId) {
    return res.status(400).json({ success: false, error: 'ID de commande (orderId) requis.' });
  }

  try {
    const orderRef = db.collection('commandes').doc(orderId);
    const orderDoc = await orderRef.get();

    if (!orderDoc.exists) {
      return res.status(404).json({ success: false, error: 'Commande introuvable.' });
    }

    const orderData = orderDoc.data();

    if (orderData.userId !== uid) {
      return res.status(403).json({ success: false, error: 'Accès refusé. Cette commande ne vous appartient pas.' });
    }

    if (!orderData.exoOrderId) {
      return res.status(400).json({ success: false, error: 'Impossible de traiter la demande : identifiant fournisseur manquant pour cette commande.' });
    }

    const exoResult = await callExo({
      action: 'refill',
      order: orderData.exoOrderId
    });

    if (exoResult.error) {
      return res.status(400).json({
        success: false,
        error: `Erreur du fournisseur: ${exoResult.error}`
      });
    }

    if (!exoResult.refill) {
      return res.status(500).json({ success: false, error: 'Réponse inattendue du fournisseur (aucun ID de refill retourné).' });
    }

    await orderRef.update({
      lastRefill: admin.firestore.FieldValue.serverTimestamp(),
      refillId: exoResult.refill,
      refillStatus: 'En attente',
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    });

    res.json({
      success: true,
      message: 'Demande de refill transmise avec succès au fournisseur.',
      refillId: exoResult.refill
    });

  } catch (error) {
    console.error("Erreur lors de la demande de refill EXO:", error);
    res.status(500).json({
      success: false,
      error: error.message || 'Erreur technique lors de la demande de refill.'
    });
  }
});

app.post('/api/exo/refill-status', checkAuth, async (req, res) => {
  const { refillId, orderId } = req.body;
  const uid = req.user.uid;

  if (!refillId) {
    return res.status(400).json({ success: false, error: 'ID de refill (refillId) requis.' });
  }

  try {
    if (orderId) {
      const orderRef = db.collection('commandes').doc(orderId);
      const orderDoc = await orderRef.get();
      if (orderDoc.exists && orderDoc.data().userId !== uid) {
        return res.status(403).json({ success: false, error: 'Accès refusé.' });
      }
    }

    const exoResult = await callExo({
      action: 'refill_status',
      refill: refillId
    });

    if (exoResult.error) {
      return res.status(400).json({ success: false, error: `Erreur fournisseur: ${exoResult.error}` });
    }

    if (orderId && exoResult.status) {
      await db.collection('commandes').doc(orderId).update({
        refillStatus: exoResult.status,
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      });
    }

    res.json({
      success: true,
      status: exoResult.status,
      refillId: refillId
    });

  } catch (error) {
    console.error("Erreur lors de la vérification du statut de refill:", error);
    res.status(500).json({ success: false, error: 'Erreur technique lors de la vérification du statut.' });
  }
});

app.post('/api/exo-status', checkAuth, async (req, res) => {
    const { orderId } = req.body;
    const uid = req.user.uid;
    try {
        const orderRef = db.collection('commandes').doc(orderId);
        const orderDoc = await orderRef.get();

        if (!orderDoc.exists || orderDoc.data().userId !== uid) return res.status(404).json({ success: false, error: 'Commande introuvable.' });

        const orderData = orderDoc.data();
        if (!orderData.exoOrderId) return res.status(400).json({ success: false, error: 'Pas de numéro de suivi fournisseur.' });

        const exoData = await callExo({ action: 'status', order: orderData.exoOrderId });
        if (exoData.error) return res.status(400).json({ success: false, error: exoData.error });

        const statusMap = { 'Pending': 'En attente', 'In progress': 'En cours', 'Processing': 'En cours', 'Completed': 'Terminée', 'Partial': 'Partiel', 'Canceled': 'Annulée' };
        let mappedStatus = statusMap[exoData.status] || exoData.status || 'En attente';
        const remains = parseInt(exoData.remains) || 0;

        let refundAmount = 0;
        let isRefunded = orderData.isRefunded || false;

        if (!isRefunded && (mappedStatus === 'Annulée' || mappedStatus === 'Partiel')) {
            const totalCost = orderData.totalCost || orderData.finalCost || orderData.cost || 0;
            if (mappedStatus === 'Partiel') {
                const qty = orderData.quantity || 1;
                refundAmount = Math.round((remains / qty) * totalCost);
            } else {
                refundAmount = totalCost;
            }

            if (refundAmount > 0) {
                await db.runTransaction(async (t) => {
                    const freshOrder = await t.get(orderRef);
                    if (freshOrder.data().isRefunded) return;

                    const userRef = db.collection('users').doc(uid);
                    const userDoc = await t.get(userRef);
                    const bal = userDoc.exists ? (userDoc.data().balance || 0) : 0;

                    t.update(userRef, { balance: bal + refundAmount });
                    addAdminOperationLog(t, { type: 'order_refund', category: 'remboursement', action: 'Remboursement de commande', userId: uid, amountXAF: refundAmount, provider: 'EXO', transactionId: orderData.orderId || orderData.exoOrderId || orderId, status: 'CONFIRMED', balanceBefore: bal, balanceAfter: bal + refundAmount, source: 'order-status' });
                    t.update(orderRef, {
                        status: mappedStatus, exoRemains: remains, isRefunded: true,
                        refundAmount: refundAmount, updatedAt: admin.firestore.FieldValue.serverTimestamp()
                    });
                });
                isRefunded = true;
            }
        } else {
            await orderRef.update({ status: mappedStatus, exoRemains: remains, updatedAt: admin.firestore.FieldValue.serverTimestamp() });
        }
        res.json({ success: true, status: mappedStatus, remains, refunded: isRefunded, refundAmount });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

let _afbServicesCache     = null;
let _afbServicesCacheTime = 0;

app.get('/api/afriqueboost/services', async (req, res) => {
  try {
    const now = Date.now();
    if (_afbServicesCache && (now - _afbServicesCacheTime) < MTP_CACHE_TTL) {
      return res.json({ success: true, services: _afbServicesCache, cached: true });
    }
    const rawServices = await callAfriqueBoost({ action: 'services' });
    if (!Array.isArray(rawServices)) return res.status(500).json({ success: false, error: 'Réponse AfriqueBoost invalide' });

    const services = rawServices.map(s => {
      const rateXAF  = parseFloat(s.rate) || 0;
      const priceXAF = Math.round(rateXAF * AFB_MULTIPLIER);
      return {
        id: parseInt(s.service), name: s.name, category: s.category || '', type: s.type || '',
        min: parseInt(s.min), max: parseInt(s.max), rate: rateXAF, priceXAF,
        refill: s.refill === true || s.refill === 'true' || s.refill === 1,
        cancel: s.cancel === true || s.cancel === 'true' || s.cancel === 1,
        desc: s.description || null, provider: 'afriqueboost'
      };
    });

    _afbServicesCache = services; _afbServicesCacheTime = now;
    res.json({ success: true, services });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/api/afriqueboost/order', checkAuth, async (req, res) => {
  const { serviceId, link, quantity, comments } = req.body;
  const uid = req.user.uid;
  if (!serviceId || !link) return res.status(400).json({ success: false, error: 'serviceId et link sont requis.' });
  try {
    const allServices = _afbServicesCache || (await callAfriqueBoost({ action: 'services' }));
    const service = allServices.find(s => parseInt(s.service || s.id) === parseInt(serviceId));
    if (!service) return res.status(400).json({ success: false, error: 'Service AfriqueBoost introuvable.' });

    const rateXAF = parseFloat(service.rate) || 0;
    const providerPricePer1000XAF = Math.round(rateXAF);
    const priceXAF = Math.round(rateXAF * AFB_MULTIPLIER);
    const qty = parseInt(quantity);
    const isPackage = (service.type || '').toLowerCase().includes('package');
    const cost = isPackage ? priceXAF : Math.round((priceXAF / 1000) * qty);
    const providerCostXAF = isPackage ? providerPricePer1000XAF : Math.round((providerPricePer1000XAF / 1000) * qty);
    const estimatedProfitXAF = cost - providerCostXAF;

    const userDoc = await db.collection('users').doc(uid).get();
    if (!userDoc.exists) return res.status(404).json({ success: false, error: 'Utilisateur introuvable.' });

    const currentBalance = userDoc.data().balance || 0;
    if (currentBalance < cost) {
      return res.status(400).json({
        success: false, error: `Solde insuffisant. Requis : ${cost.toLocaleString('fr-FR')} FCFA`,
      });
    }

    const orderParams = { action: 'add', service: serviceId, link, quantity: qty };
    if (comments) orderParams.comments = comments;
    const orderResult = await callAfriqueBoost(orderParams);

    if (orderResult.error) return res.status(400).json({ success: false, error: 'Erreur AfriqueBoost: ' + orderResult.error });
    if (!orderResult.order) return res.status(400).json({ success: false, error: 'Commande non confirmée.' });

    let finalOrderId, newBalance;
    await db.runTransaction(async (transaction) => {
      const counterRef = db.collection('counters').doc('autoOrders');
      const freshUserRef = db.collection('users').doc(uid);

      const counterDoc = await transaction.get(counterRef);
      const freshUserDoc = await transaction.get(freshUserRef);

      const freshBalance = freshUserDoc.data().balance || 0;
      if (freshBalance < cost) throw new Error('Solde insuffisant (vérifié pendant le traitement).');

      const nextId = ((counterDoc.exists ? counterDoc.data().lastId : 0) || 0) + 1;
      finalOrderId = `SBH-AUTO-${nextId}`;
      newBalance = freshBalance - cost;
      const platform = detectPlatformName(service.name || '', link);

      transaction.set(counterRef, { lastId: nextId }, { merge: true });
      transaction.update(freshUserRef, {
        balance: newBalance,
        totalOrders: admin.firestore.FieldValue.increment(1),
        totalSpent: admin.firestore.FieldValue.increment(cost),
        adminOrderCount: admin.firestore.FieldValue.increment(1),
        adminTotalSpent: admin.firestore.FieldValue.increment(cost),
        adminTotalProfit: admin.firestore.FieldValue.increment(estimatedProfitXAF),
        adminLastOrderAt: admin.firestore.FieldValue.serverTimestamp(),
        adminLastOrderAtMs: Date.now(),
      });

      const orderRef = db.collection('autoOrders').doc();
      transaction.set(orderRef, {
        orderId: finalOrderId, userId: uid, provider: 'afriqueboost', providerOrderId: orderResult.order,
        serviceId: parseInt(serviceId), serviceName: service.name, platform, link, quantity: qty,
        priceXAF: cost, providerCostXAF, estimatedProfitXAF,
        providerMultiplier: AFB_MULTIPLIER, profitCalculationVersion: 1,
        status: 'En attente', createdAt: admin.firestore.FieldValue.serverTimestamp(),
        providerStartCount: 0, providerRemains: qty, refunded: false, refundedAmount: 0,
      });
      addAdminOperationLog(transaction, { type: 'order_debit', category: 'commande', action: 'Commande passée', userId: uid, amountXAF: cost, provider: 'AFRIQUEBOOST', transactionId: finalOrderId, status: 'CONFIRMED', balanceBefore: freshBalance, balanceAfter: newBalance, serviceName: service.name, source: 'order-api' });
    });

    res.json({ success: true, orderId: finalOrderId, newBalance });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Erreur technique. Veuillez réessayer.' });
  }
});

app.get('/api/afriqueboost/status/:orderId', checkAuth, async (req, res) => {
  const { orderId } = req.params;
  const uid = req.user.uid;
  try {
    const snapshot = await db.collection('autoOrders').where('orderId', '==', orderId).limit(1).get();
    if (snapshot.empty) return res.status(404).json({ success: false, error: 'Commande introuvable.' });

    const orderDoc = snapshot.docs[0];
    const orderData = orderDoc.data();
    if (orderData.userId !== uid) return res.status(403).json({ success: false, error: 'Accès refusé.' });

    const statusResult = await callAfriqueBoost({ action: 'status', order: orderData.providerOrderId });

    if (statusResult.error) return res.status(400).json({ success: false, error: 'Erreur AfriqueBoost: ' + statusResult.error });

    const newStatus = MTP_STATUS_MAP[statusResult.status] || statusResult.status || 'En attente';
    const startCount = parseInt(statusResult.start_count) || 0;
    const remains = parseInt(statusResult.remains) || 0;

    let refundAmount = 0;
    let isRefunded = orderData.refunded || false;

    if (!isRefunded && (newStatus === 'Annulé' || newStatus === 'Canceled' || newStatus === 'Partiel' || newStatus === 'Partial')) {
      let totalCost = orderData.priceXAF || 0;
      if (newStatus === 'Partiel' || newStatus === 'Partial') {
        const qty = orderData.quantity || 1;
        const rem = remains !== undefined ? remains : qty;
        refundAmount = Math.round((rem / qty) * totalCost);
      } else {
        refundAmount = totalCost;
      }

      if (refundAmount > 0) {
        await db.runTransaction(async (t) => {
          const freshOrder = await t.get(orderDoc.ref);
          if (freshOrder.data().refunded) return;

          const userRef = db.collection('users').doc(uid);
          const userDoc = await t.get(userRef);
          const bal = userDoc.exists ? (userDoc.data().balance || 0) : 0;

          t.update(userRef, { balance: bal + refundAmount });
          addAdminOperationLog(t, { type: 'order_refund', category: 'remboursement', action: 'Remboursement de commande', userId: uid, amountXAF: refundAmount, provider: 'AFRIQUEBOOST', transactionId: orderData.orderId || orderId, status: 'CONFIRMED', balanceBefore: bal, balanceAfter: bal + refundAmount, source: 'order-status' });
          t.update(orderDoc.ref, {
            status: newStatus, providerStartCount: startCount, providerRemains: remains,
            refunded: true, refundedAmount: refundAmount, lastChecked: admin.firestore.FieldValue.serverTimestamp()
          });
        });
        isRefunded = true;
      }
    } else {
      await orderDoc.ref.update({ status: newStatus, providerStartCount: startCount, providerRemains: remains, lastChecked: admin.firestore.FieldValue.serverTimestamp() });
    }
    res.json({ success: true, status: newStatus, providerStatus: statusResult.status, startCount, remains, refunded: isRefunded, refundAmount });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/api/afriqueboost/refill', checkAuth, async (req, res) => {
  const { orderId } = req.body;
  const uid = req.user.uid;
  if (!orderId) return res.status(400).json({ success: false, error: 'orderId requis.' });
  try {
    const snapshot = await db.collection('autoOrders').where('orderId', '==', orderId).limit(1).get();
    if (snapshot.empty) return res.status(404).json({ success: false, error: 'Commande introuvable.' });

    const orderDoc = snapshot.docs[0];
    const orderData = orderDoc.data();
    if (orderData.userId !== uid) return res.status(403).json({ success: false, error: 'Accès refusé.' });

    const result = await callAfriqueBoost({ action: 'refill', order: orderData.providerOrderId });
    if (result.error) return res.status(400).json({ success: false, error: 'Erreur AfriqueBoost: ' + result.error });

    await orderDoc.ref.update({ lastRefill: admin.firestore.FieldValue.serverTimestamp(), refillId: result.refill || null });
    res.json({ success: true, refillId: result.refill });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

let _smmwizServicesCache     = null;
let _smmwizServicesCacheTime = 0;
const SMMWIZ_CACHE_TTL = 10 * 60 * 1000;

function getSmmWizPricingMode(type) {
  const t = (type || 'Default').toLowerCase();
  if (t === 'package') return 'package';
  if (t === 'custom comments') return 'per_unit';
  if (t === 'usernames') return 'per_unit';
  if (t === 'usernames + hashtags') return 'per_unit';
  if (t === 'hashtag scraper') return 'per_unit';
  if (t === 'username scraper') return 'per_unit';
  if (t === 'media / likers') return 'per_unit';
  if (t === 'poll') return 'per_unit';
  if (t === 'groups') return 'per_unit';
  if (t === 'runs/interval') return 'per_1000';
  if (t === 'traffic') return 'per_1000';
  return 'per_1000';
}

function buildSmmWizOrderParams(service, body) {
  const type = (service.type || 'Default').toLowerCase();
  const params = {
    action: 'add',
    service: service.service || service.id,
    link: body.link,
  };

  switch (type) {
    case 'default':
      params.quantity = parseInt(body.quantity) || 0;
      break;
    case 'package':
      break;
    case 'custom comments':
      params.comments = body.comments || '';
      break;
    case 'usernames':
      params.usernames = body.usernames || '';
      break;
    case 'usernames + hashtags':
      params.usernames = body.usernames || '';
      params.hashtags = body.hashtags || '';
      break;
    case 'hashtag scraper':
      params.hashtag = body.hashtag || '';
      params.quantity = parseInt(body.quantity) || 0;
      break;
    case 'username scraper':
      params.username = body.username || '';
      params.quantity = parseInt(body.quantity) || 0;
      break;
    case 'media / likers':
      params.media = body.media || '';
      params.quantity = parseInt(body.quantity) || 0;
      break;
    case 'poll':
      params.answer_number = body.answer_number || '';
      params.quantity = parseInt(body.quantity) || 0;
      break;
    case 'groups':
      params.groups = body.groups || '';
      params.quantity = parseInt(body.quantity) || 0;
      break;
    case 'runs/interval':
      params.runs = body.runs || '';
      params.interval = body.interval || '';
      params.quantity = parseInt(body.quantity) || 0;
      break;
    case 'traffic':
      params.country = body.country || '';
      params.device = body.device || '';
      params.type_of_traffic = body.type_of_traffic || '';
      if (body.google_keyword) params.google_keyword = body.google_keyword;
      if (body.referring_url) params.referring_url = body.referring_url;
      params.quantity = parseInt(body.quantity) || 0;
      break;
    default:
      params.quantity = parseInt(body.quantity) || 0;
  }

  return params;
}

function computeSmmWizCost(service, qty, pricingMode) {
  const rate = parseFloat(service.rate) || 0;
  const priceXAF = Math.round(rate * SMMWIZ_USD_TO_XAF * SMMWIZ_MULTIPLIER);

  if (pricingMode === 'package') {
    return priceXAF;
  } else if (pricingMode === 'per_unit') {
    return Math.round(priceXAF * qty);
  } else {
    return Math.round((priceXAF / 1000) * qty);
  }
}

app.get('/api/smmwiz/services', async (req, res) => {
  try {
    const now = Date.now();
    if (_smmwizServicesCache && (now - _smmwizServicesCacheTime) < SMMWIZ_CACHE_TTL) {
      return res.json({ success: true, services: _smmwizServicesCache, cached: true });
    }
    const rawServices = await callSmmWiz({ action: 'services' });
    if (!Array.isArray(rawServices)) return res.status(500).json({ success: false, error: 'Réponse SMMWiz invalide' });

    const services = rawServices.map(s => {
      const rate = parseFloat(s.rate) || 0;
      const priceXAF = Math.round(rate * SMMWIZ_USD_TO_XAF * SMMWIZ_MULTIPLIER);
      const type = s.type || 'Default';
      const pricingMode = getSmmWizPricingMode(type);

      return {
        id: parseInt(s.service),
        provider: 'smmwiz',
        providerServiceId: parseInt(s.service),
        name: s.name,
        category: s.category || '',
        type: type,
        rate: rate,
        min: parseInt(s.min) || 0,
        max: parseInt(s.max) || 0,
        refill: s.refill === true || s.refill === 'true',
        cancel: s.cancel === true || s.cancel === 'true',
        priceXAF: priceXAF,
        pricingMode: pricingMode,
        desc: s.description || null,
      };
    });

    _smmwizServicesCache = services;
    _smmwizServicesCacheTime = now;
    res.json({ success: true, services });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/api/smmwiz/order', checkAuth, async (req, res) => {
  const uid = req.user.uid;
  const { serviceId, link } = req.body;

  if (!serviceId || !link) {
    return res.status(400).json({ success: false, error: 'serviceId et link sont requis.' });
  }

  try {
    let allServices;
    if (_smmwizServicesCache) {
      allServices = _smmwizServicesCache;
    } else {
      allServices = await callSmmWiz({ action: 'services' });
    }

    const service = allServices.find(s => parseInt(s.service || s.id) === parseInt(serviceId));
    if (!service) {
      return res.status(400).json({ success: false, error: 'Service SMMWiz introuvable.' });
    }

    if (service.provider && service.provider !== 'smmwiz') {
      return res.status(400).json({ success: false, error: 'Ce service n\'appartient pas à SMMWiz.' });
    }

    const type = service.type || 'Default';
    const pricingMode = getSmmWizPricingMode(type);

    let qty = 0;
    if (pricingMode === 'package') {
      qty = 1;
    } else if (type.toLowerCase() === 'custom comments') {
      qty = (req.body.comments || '').split('\n').filter(l => l.trim()).length;
    } else {
      qty = parseInt(req.body.quantity) || 0;
    }

    if (pricingMode !== 'package') {
      if (qty < (service.min || 0)) {
        return res.status(400).json({ success: false, error: `Quantité minimale : ${service.min}` });
      }
      if (qty > (service.max || 0)) {
        return res.status(400).json({ success: false, error: `Quantité maximale : ${service.max}` });
      }
    }

    const cost = computeSmmWizCost(service, qty, pricingMode);
    const providerRateXAF = Math.round((parseFloat(service.rate) || 0) * SMMWIZ_USD_TO_XAF);
    const providerCostXAF = pricingMode === 'package'
      ? providerRateXAF
      : pricingMode === 'per_unit'
        ? Math.round(providerRateXAF * qty)
        : Math.round((providerRateXAF / 1000) * qty);
    const estimatedProfitXAF = cost - providerCostXAF;

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

    const orderParams = buildSmmWizOrderParams(service, req.body);
    const orderResult = await callSmmWiz(orderParams);

    if (orderResult.error) {
      return res.status(400).json({ success: false, error: 'Erreur fournisseur : ' + orderResult.error });
    }
    if (!orderResult.order) {
      return res.status(400).json({ success: false, error: 'Commande non confirmée.' });
    }

    const providerOrderId = orderResult.order;

    let finalOrderId, newBalance;
    await db.runTransaction(async (transaction) => {
      const counterRef = db.collection('counters').doc('autoOrders');
      const freshUserRef = db.collection('users').doc(uid);

      const counterDoc = await transaction.get(counterRef);
      const freshUserDoc = await transaction.get(freshUserRef);

      const freshBalance = freshUserDoc.data().balance || 0;
      if (freshBalance < cost) {
        throw new Error('Solde insuffisant (vérifié pendant le traitement).');
      }

      const nextId = ((counterDoc.exists ? counterDoc.data().lastId : 0) || 0) + 1;
      finalOrderId = `SBH-AUTO-${nextId}`;
      newBalance = freshBalance - cost;
      const platform = detectPlatformName(service.name || '', link);

      transaction.set(counterRef, { lastId: nextId }, { merge: true });
      transaction.update(freshUserRef, {
        balance: newBalance,
        totalOrders: admin.firestore.FieldValue.increment(1),
        totalSpent: admin.firestore.FieldValue.increment(cost),
        adminOrderCount: admin.firestore.FieldValue.increment(1),
        adminTotalSpent: admin.firestore.FieldValue.increment(cost),
        adminTotalProfit: admin.firestore.FieldValue.increment(estimatedProfitXAF),
        adminLastOrderAt: admin.firestore.FieldValue.serverTimestamp(),
        adminLastOrderAtMs: Date.now(),
      });

      const orderRef = db.collection('autoOrders').doc();
      transaction.set(orderRef, {
        orderId: finalOrderId,
        userId: uid,
        provider: 'smmwiz',
        providerOrderId: providerOrderId,
        providerServiceId: parseInt(serviceId),
        serviceId: parseInt(serviceId),
        serviceName: service.name,
        serviceType: type,
        platform: platform,
        link: link,
        quantity: qty,
        priceXAF: cost,
        providerCostXAF,
        estimatedProfitXAF,
        providerMultiplier: SMMWIZ_MULTIPLIER,
        profitCalculationVersion: 1,
        status: 'En attente',
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        providerStartCount: 0,
        providerRemains: qty,
        refunded: false,
        refundedAmount: 0,
        orderParams: JSON.stringify(orderParams),
      });
      addAdminOperationLog(transaction, { type: 'order_debit', category: 'commande', action: 'Commande passée', userId: uid, amountXAF: cost, provider: 'SMMWIZ', transactionId: finalOrderId, status: 'CONFIRMED', balanceBefore: freshBalance, balanceAfter: newBalance, serviceName: service.name, source: 'order-api' });
    });

    res.json({ success: true, orderId: finalOrderId, newBalance });

  } catch (error) {
    console.error('SMMWiz order error:', error);
    if (error.message.toLowerCase().includes('insuffisant')) {
      return res.status(400).json({ success: false, error: error.message });
    }
    res.status(500).json({ success: false, error: 'Erreur technique. Veuillez réessayer.' });
  }
});

app.get('/api/smmwiz/order-status/:orderId', checkAuth, async (req, res) => {
  const { orderId } = req.params;
  const uid = req.user.uid;

  try {
    const snapshot = await db.collection('autoOrders').where('orderId', '==', orderId).limit(1).get();
    if (snapshot.empty) {
      return res.status(404).json({ success: false, error: 'Commande introuvable.' });
    }

    const orderDoc = snapshot.docs[0];
    const orderData = orderDoc.data();

    if (orderData.userId !== uid) {
      return res.status(403).json({ success: false, error: 'Accès refusé.' });
    }

    if (orderData.provider !== 'smmwiz') {
      return res.status(400).json({ success: false, error: 'Cette commande n\'est pas une commande SMMWiz.' });
    }

    const statusResult = await callSmmWiz({ action: 'status', order: orderData.providerOrderId });

    if (statusResult.error) {
      return res.status(400).json({ success: false, error: 'Erreur SMMWiz: ' + statusResult.error });
    }

    const newStatus = MTP_STATUS_MAP[statusResult.status] || statusResult.status || 'En attente';
    const startCount = parseInt(statusResult.start_count) || 0;
    const remains = parseInt(statusResult.remains) || 0;
    const charge = parseFloat(statusResult.charge) || 0;

    let refundAmount = 0;
    let isRefunded = orderData.refunded || false;

    if (!isRefunded && (newStatus === 'Annulé' || newStatus === 'Canceled' || newStatus === 'Partiel' || newStatus === 'Partial')) {
      let totalCost = orderData.priceXAF || 0;

      if (newStatus === 'Partiel' || newStatus === 'Partial') {
        const qty = orderData.quantity || 1;
        const rem = remains !== undefined ? remains : qty;
        refundAmount = Math.round((rem / qty) * totalCost);
      } else {
        refundAmount = totalCost;
      }

      if (refundAmount > 0) {
        await db.runTransaction(async (t) => {
          const freshOrder = await t.get(orderDoc.ref);
          if (freshOrder.data().refunded) return;

          const userRef = db.collection('users').doc(uid);
          const userDoc = await t.get(userRef);
          const bal = userDoc.exists ? (userDoc.data().balance || 0) : 0;

          t.update(userRef, { balance: bal + refundAmount });
          addAdminOperationLog(t, { type: 'order_refund', category: 'remboursement', action: 'Remboursement de commande', userId: uid, amountXAF: refundAmount, provider: 'SMMWIZ', transactionId: orderData.orderId || orderId, status: 'CONFIRMED', balanceBefore: bal, balanceAfter: bal + refundAmount, source: 'order-status' });
          t.update(orderDoc.ref, {
            status: newStatus,
            providerStartCount: startCount,
            providerRemains: remains,
            providerCharge: charge,
            refunded: true,
            refundedAmount: refundAmount,
            lastChecked: admin.firestore.FieldValue.serverTimestamp()
          });
        });
        isRefunded = true;
      }
    } else {
      await orderDoc.ref.update({
        status: newStatus,
        providerStartCount: startCount,
        providerRemains: remains,
        providerCharge: charge,
        lastChecked: admin.firestore.FieldValue.serverTimestamp()
      });
    }

    res.json({
      success: true,
      status: newStatus,
      providerStatus: statusResult.status,
      startCount: startCount,
      remains: remains,
      charge: charge,
      refunded: isRefunded,
      refundAmount: refundAmount
    });

  } catch (error) {
    console.error('SMMWiz status error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/api/smmwiz/refill', checkAuth, async (req, res) => {
  const { orderId } = req.body;
  const uid = req.user.uid;

  if (!orderId) {
    return res.status(400).json({ success: false, error: 'orderId requis.' });
  }

  try {
    const snapshot = await db.collection('autoOrders').where('orderId', '==', orderId).limit(1).get();
    if (snapshot.empty) {
      return res.status(404).json({ success: false, error: 'Commande introuvable.' });
    }

    const orderDoc = snapshot.docs[0];
    const orderData = orderDoc.data();

    if (orderData.userId !== uid) {
      return res.status(403).json({ success: false, error: 'Accès refusé.' });
    }

    if (orderData.provider !== 'smmwiz') {
      return res.status(400).json({ success: false, error: 'Cette commande n\'est pas une commande SMMWiz.' });
    }

    let serviceSupportsRefill = true;
    if (_smmwizServicesCache) {
      const svc = _smmwizServicesCache.find(s => s.id === orderData.providerServiceId);
      if (svc && svc.refill === false) {
        serviceSupportsRefill = false;
      }
    }

    if (!serviceSupportsRefill) {
      return res.status(400).json({ success: false, error: 'Ce service ne supporte pas le refill.' });
    }

    const result = await callSmmWiz({ action: 'refill', order: orderData.providerOrderId });

    if (result.error) {
      return res.status(400).json({ success: false, error: 'Erreur SMMWiz: ' + result.error });
    }

    await orderDoc.ref.update({
      lastRefill: admin.firestore.FieldValue.serverTimestamp(),
      refillId: result.refill || null,
      refillStatus: 'En attente',
    });

    res.json({ success: true, refillId: result.refill });

  } catch (error) {
    console.error('SMMWiz refill error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/api/smmwiz/refill-status', checkAuth, async (req, res) => {
  const { refillId, orderId } = req.body;
  const uid = req.user.uid;

  if (!refillId) {
    return res.status(400).json({ success: false, error: 'refillId requis.' });
  }

  try {
    if (orderId) {
      const orderRef = db.collection('autoOrders').doc(orderId);
      const orderDoc = await orderRef.get();
      if (orderDoc.exists && orderDoc.data().userId !== uid) {
        return res.status(403).json({ success: false, error: 'Accès refusé.' });
      }
    }

    const result = await callSmmWiz({ action: 'refill_status', refill: refillId });

    if (result.error) {
      return res.status(400).json({ success: false, error: 'Erreur SMMWiz: ' + result.error });
    }

    if (orderId && result.status) {
      await db.collection('autoOrders').doc(orderId).update({
        refillStatus: result.status,
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      });
    }

    res.json({ success: true, status: result.status, refillId: refillId });

  } catch (error) {
    console.error('SMMWiz refill status error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/api/smmwiz/cancel', checkAuth, async (req, res) => {
  const { orderId } = req.body;
  const uid = req.user.uid;

  if (!orderId) {
    return res.status(400).json({ success: false, error: 'orderId requis.' });
  }

  try {
    const snapshot = await db.collection('autoOrders').where('orderId', '==', orderId).limit(1).get();
    if (snapshot.empty) {
      return res.status(404).json({ success: false, error: 'Commande introuvable.' });
    }

    const orderDoc = snapshot.docs[0];
    const orderData = orderDoc.data();

    if (orderData.userId !== uid) {
      return res.status(403).json({ success: false, error: 'Accès refusé.' });
    }

    if (orderData.provider !== 'smmwiz') {
      return res.status(400).json({ success: false, error: 'Cette commande n\'est pas une commande SMMWiz.' });
    }

    if (orderData.refunded) {
      return res.status(400).json({ success: false, error: 'Cette commande a déjà été remboursée.' });
    }

    const currentStatus = (orderData.status || '').toLowerCase();
    if (!['en attente', 'pending', 'en cours', 'in progress', 'processing'].includes(currentStatus)) {
      return res.status(400).json({ success: false, error: 'Cette commande ne peut plus être annulée, son statut ne le permet pas.' });
    }

    const cancelResult = await callSmmWiz({ action: 'cancel', orders: orderData.providerOrderId });

    if (Array.isArray(cancelResult)) {
      const entry = cancelResult.find(r => parseInt(r.order) === parseInt(orderData.providerOrderId));
      if (entry && entry.cancel && entry.cancel.error) {
        return res.status(400).json({ success: false, error: 'Erreur SMMWiz: ' + entry.cancel.error });
      }
    } else if (cancelResult.error) {
      return res.status(400).json({ success: false, error: 'Erreur SMMWiz: ' + cancelResult.error });
    }

    res.json({
      success: true,
      message: "Demande d'annulation transmise au fournisseur. Le remboursement sera effectué automatiquement dès que le fournisseur confirmera l'annulation."
    });

  } catch (error) {
    console.error('SMMWiz cancel error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

app.get('/api/smmgen/services', async (req, res) => {
  return res.redirect(307, '/api/smmwiz/services');
});

app.post('/api/smmgen/order', checkAuth, async (req, res) => {
  return app._router.handle({ ...req, url: '/api/smmwiz/order', originalUrl: '/api/smmwiz/order' }, res, () => {});
});

app.get('/api/smmgen/order-status/:orderId', checkAuth, async (req, res) => {
  const { orderId } = req.params;
  const uid = req.user.uid;

  try {
    const snapshot = await db.collection('autoOrders').where('orderId', '==', orderId).limit(1).get();
    if (snapshot.empty) {
      return res.status(404).json({ success: false, error: 'Commande introuvable.' });
    }

    const orderDoc = snapshot.docs[0];
    const orderData = orderDoc.data();

    if (orderData.userId !== uid) {
      return res.status(403).json({ success: false, error: 'Accès refusé.' });
    }

    if (orderData.provider === 'smmgen') {
      return res.status(410).json({
        success: false,
        error: 'Cette commande provient de l\'ancien fournisseur SMMGen qui n\'est plus actif. Le suivi n\'est plus disponible. Contactez le support si nécessaire.'
      });
    }

    if (orderData.provider === 'smmwiz') {
      const statusResult = await callSmmWiz({ action: 'status', order: orderData.providerOrderId });

      if (statusResult.error) {
        return res.status(400).json({ success: false, error: 'Erreur SMMWiz: ' + statusResult.error });
      }

      const newStatus = MTP_STATUS_MAP[statusResult.status] || statusResult.status || 'En attente';
      const startCount = parseInt(statusResult.start_count) || 0;
      const remains = parseInt(statusResult.remains) || 0;
      const charge = parseFloat(statusResult.charge) || 0;

      let refundAmount = 0;
      let isRefunded = orderData.refunded || false;

      if (!isRefunded && (newStatus === 'Annulé' || newStatus === 'Canceled' || newStatus === 'Partiel' || newStatus === 'Partial')) {
        let totalCost = orderData.priceXAF || 0;
        if (newStatus === 'Partiel' || newStatus === 'Partial') {
          const qty = orderData.quantity || 1;
          const rem = remains !== undefined ? remains : qty;
          refundAmount = Math.round((rem / qty) * totalCost);
        } else {
          refundAmount = totalCost;
        }

        if (refundAmount > 0) {
          await db.runTransaction(async (t) => {
            const freshOrder = await t.get(orderDoc.ref);
            if (freshOrder.data().refunded) return;

            const userRef = db.collection('users').doc(uid);
            const userDoc = await t.get(userRef);
            const bal = userDoc.exists ? (userDoc.data().balance || 0) : 0;

            t.update(userRef, { balance: bal + refundAmount });
            addAdminOperationLog(t, { type: 'order_refund', category: 'remboursement', action: 'Remboursement de commande', userId: uid, amountXAF: refundAmount, provider: 'SMMGEN', transactionId: orderData.orderId || orderId, status: 'CONFIRMED', balanceBefore: bal, balanceAfter: bal + refundAmount, source: 'order-status' });
            t.update(orderDoc.ref, {
              status: newStatus,
              providerStartCount: startCount,
              providerRemains: remains,
              providerCharge: charge,
              refunded: true,
              refundedAmount: refundAmount,
              lastChecked: admin.firestore.FieldValue.serverTimestamp()
            });
          });
          isRefunded = true;
        }
      } else {
        await orderDoc.ref.update({
          status: newStatus,
          providerStartCount: startCount,
          providerRemains: remains,
          providerCharge: charge,
          lastChecked: admin.firestore.FieldValue.serverTimestamp()
        });
      }

      return res.json({
        success: true,
        status: newStatus,
        providerStatus: statusResult.status,
        startCount: startCount,
        remains: remains,
        charge: charge,
        refunded: isRefunded,
        refundAmount: refundAmount
      });
    }

    return res.status(400).json({ success: false, error: 'Fournisseur non reconnu pour cette commande.' });

  } catch (error) {
    console.error('SMMGen compat status error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/api/smmgen/refill', checkAuth, async (req, res) => {
  const { orderId } = req.body;
  const uid = req.user.uid;

  if (!orderId) {
    return res.status(400).json({ success: false, error: 'orderId requis.' });
  }

  try {
    const snapshot = await db.collection('autoOrders').where('orderId', '==', orderId).limit(1).get();
    if (snapshot.empty) {
      return res.status(404).json({ success: false, error: 'Commande introuvable.' });
    }

    const orderDoc = snapshot.docs[0];
    const orderData = orderDoc.data();

    if (orderData.userId !== uid) {
      return res.status(403).json({ success: false, error: 'Accès refusé.' });
    }

    if (orderData.provider === 'smmgen') {
      return res.status(410).json({
        success: false,
        error: 'Le refill n\'est plus disponible pour les commandes de l\'ancien fournisseur SMMGen.'
      });
    }

    if (orderData.provider === 'smmwiz') {
      const result = await callSmmWiz({ action: 'refill', order: orderData.providerOrderId });

      if (result.error) {
        return res.status(400).json({ success: false, error: 'Erreur SMMWiz: ' + result.error });
      }

      await orderDoc.ref.update({
        lastRefill: admin.firestore.FieldValue.serverTimestamp(),
        refillId: result.refill || null,
        refillStatus: 'En attente',
      });

      return res.json({ success: true, refillId: result.refill });
    }

    return res.status(400).json({ success: false, error: 'Fournisseur non reconnu pour cette commande.' });

  } catch (error) {
    console.error('SMMGen compat refill error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/api/smmgen/refill-status', checkAuth, async (req, res) => {
  const { refillId, orderId } = req.body;
  const uid = req.user.uid;

  if (!refillId) {
    return res.status(400).json({ success: false, error: 'refillId requis.' });
  }

  try {
    if (orderId) {
      const orderRef = db.collection('autoOrders').doc(orderId);
      const orderDoc = await orderRef.get();
      if (orderDoc.exists && orderDoc.data().userId !== uid) {
        return res.status(403).json({ success: false, error: 'Accès refusé.' });
      }
    }

    const result = await callSmmWiz({ action: 'refill_status', refill: refillId });

    if (result.error) {
      return res.status(400).json({ success: false, error: 'Erreur SMMWiz: ' + result.error });
    }

    if (orderId && result.status) {
      await db.collection('autoOrders').doc(orderId).update({
        refillStatus: result.status,
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      });
    }

    res.json({ success: true, status: result.status, refillId: refillId });

  } catch (error) {
    console.error('SMMGen compat refill status error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/api/smmgen/cancel', checkAuth, async (req, res) => {
  const { orderId } = req.body;
  const uid = req.user.uid;

  if (!orderId) {
    return res.status(400).json({ success: false, error: 'orderId requis.' });
  }

  try {
    const snapshot = await db.collection('autoOrders').where('orderId', '==', orderId).limit(1).get();
    if (snapshot.empty) {
      return res.status(404).json({ success: false, error: 'Commande introuvable.' });
    }

    const orderDoc = snapshot.docs[0];
    const orderData = orderDoc.data();

    if (orderData.userId !== uid) {
      return res.status(403).json({ success: false, error: 'Accès refusé.' });
    }

    if (orderData.provider === 'smmgen') {
      return res.status(410).json({
        success: false,
        error: 'L\'annulation n\'est plus disponible pour les commandes de l\'ancien fournisseur SMMGen.'
      });
    }

    if (orderData.provider === 'smmwiz') {
      if (orderData.refunded) {
        return res.status(400).json({ success: false, error: 'Cette commande a déjà été remboursée.' });
      }

      const currentStatus = (orderData.status || '').toLowerCase();
      if (!['en attente', 'pending', 'en cours', 'in progress', 'processing'].includes(currentStatus)) {
        return res.status(400).json({ success: false, error: 'Cette commande ne peut plus être annulée, son statut ne le permet pas.' });
      }

      const cancelResult = await callSmmWiz({ action: 'cancel', orders: orderData.providerOrderId });

      if (Array.isArray(cancelResult)) {
        const entry = cancelResult.find(r => parseInt(r.order) === parseInt(orderData.providerOrderId));
        if (entry && entry.cancel && entry.cancel.error) {
          return res.status(400).json({ success: false, error: 'Erreur SMMWiz: ' + entry.cancel.error });
        }
      } else if (cancelResult.error) {
        return res.status(400).json({ success: false, error: 'Erreur SMMWiz: ' + cancelResult.error });
      }

      return res.json({
        success: true,
        message: "Demande d'annulation transmise au fournisseur. Le remboursement sera effectué automatiquement dès que le fournisseur confirmera l'annulation."
      });
    }

    return res.status(400).json({ success: false, error: 'Fournisseur non reconnu pour cette commande.' });

  } catch (error) {
    console.error('SMMGen compat cancel error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

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

app.get('/api/user/profile', checkAuth, async (req, res) => {
  try {
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    const uid = req.user.uid;
    const userDoc = await db.collection('users').doc(uid).get();

    if (!userDoc.exists) {
      return res.json({
        success: true,
        profile: {
          displayName: req.user.name || '', email: req.user.email || '', photoURL: req.user.picture || null,
          phone: '', country: '', balance: 0, totalOrders: 0, createdAt: new Date().toISOString(), settings: {}, resellerLevel: 'bronze',
          memberBadge: 'Nouveau membre'
        }
      });
    }
    const data = userDoc.data();

    const createdAtMs = data.createdAt ? getTimestampMs(data.createdAt) : Date.now();
    const diffMonths = Math.floor((Date.now() - createdAtMs) / (1000 * 60 * 60 * 24 * 30.44));

    let memberBadge = "Nouveau membre";
    if (diffMonths > 0) {
      memberBadge = `Membre depuis ${diffMonths} mois`;
    }

    res.json({
      success: true,
      profile: {
        displayName: data.displayName || data.username || req.user.name || '', email: data.email || req.user.email || '',
        photoURL: data.photoURL || req.user.picture || null, phone: data.phone || '', country: data.country || '',
        balance: data.balance || 0, totalOrders: data.totalOrders || 0, createdAt: data.createdAt || new Date().toISOString(),
        settings: data.settings || {}, resellerLevel: data.resellerLevel || 'bronze', lastSignIn: data.lastSignIn || null,
        memberBadge
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/api/update-profile', checkAuth, async (req, res) => {
  try {
    const uid = req.user.uid;
    const { displayName, phone, country, settings, photoURL } = req.body;

    const updateData = {};
    if (displayName !== undefined) updateData.displayName = displayName;
    if (phone !== undefined) updateData.phone = phone;
    if (country !== undefined) updateData.country = country;
    if (settings !== undefined) updateData.settings = settings;
    if (photoURL !== undefined) updateData.photoURL = photoURL;

    updateData.updatedAt = admin.firestore.FieldValue.serverTimestamp();

    await db.collection('users').doc(uid).set(updateData, { merge: true });

    res.json({ success: true, message: 'Profil mis à jour avec succès.' });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Erreur lors de la mise à jour du profil.' });
  }
});

app.post('/api/user/settings', checkAuth, async (req, res) => {
  try {
    const uid = req.user.uid;
    const body = req.body || {};
    const newSettings = (body.settings && typeof body.settings === 'object')
      ? body.settings
      : body;

    if (!newSettings || typeof newSettings !== 'object' || Object.keys(newSettings).length === 0) {
      return res.status(400).json({ success: false, error: 'Aucun paramètre fourni.' });
    }

    const ALLOWED_SETTINGS = [
      'emailNotifications', 'whatsappNotifications', 'promoNotifications',
      'profileVisible', 'hideBalance', 'privateHistory',
      'defaultSpeed', 'confirmOrder', 'soundsAnimations'
    ];

    const updatePayload = {};
    for (const [key, value] of Object.entries(newSettings)) {
      if (ALLOWED_SETTINGS.includes(key)) {
        updatePayload[`settings.${key}`] = Boolean(value);
      }
    }

    if (Object.keys(updatePayload).length === 0) {
      return res.status(400).json({ success: false, error: 'Aucun paramètre valide fourni.' });
    }

    updatePayload.updatedAt = admin.firestore.FieldValue.serverTimestamp();

    const userRef = db.collection('users').doc(uid);
    await userRef.set(updatePayload, { merge: true });

    const freshDoc = await userRef.get();
    const savedSettings = freshDoc.exists ? (freshDoc.data().settings || {}) : {};

    res.json({
      success: true,
      settings: savedSettings,
      message: 'Paramètres mis à jour avec succès.'
    });
  } catch (error) {
    console.error('Erreur /api/user/settings:', error);
    res.status(500).json({ success: false, error: 'Erreur lors de la mise à jour des paramètres.' });
  }
});

app.get('/api/user/api-key-info', checkAuth, async (req, res) => {
  try {
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    const uid = req.user.uid;
    const userDoc = await db.collection('users').doc(uid).get();

    if (!userDoc.exists) return res.status(404).json({ success: false, error: 'Utilisateur introuvable.' });

    const data = userDoc.data();
    if (data.apiKey) {
      let prefix = data.apiKeyPrefix;
      if (!prefix && typeof data.apiKey === 'string') {
        prefix = data.apiKey.substring(0, 20);
      }
      res.json({
        success: true,
        hasApiKey: true,
        hasKey: true,
        prefix: prefix,
        createdAt: data.apiKeyCreatedAt
      });
    } else {
      res.json({ success: true, hasApiKey: false, hasKey: false });
    }
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/api/user/generate-api-key', checkAuth, async (req, res) => {
  try {
    const uid = req.user.uid;

    const newApiKey = 'sbh_live_' + crypto.randomBytes(24).toString('hex');
    const prefix = newApiKey.substring(0, 20);

    await db.collection('users').doc(uid).set({
      apiKey: newApiKey,
      apiKeyPrefix: prefix,
      apiKeyCreatedAt: admin.firestore.FieldValue.serverTimestamp()
    }, { merge: true });

    const freshDoc = await db.collection('users').doc(uid).get();
    const createdAt = freshDoc.exists ? freshDoc.data().apiKeyCreatedAt : null;

    res.json({
      success: true,
      apiKey: newApiKey,
      prefix: prefix,
      createdAt: createdAt
    });
  } catch (error) {
    console.error('Erreur /api/user/generate-api-key:', error);
    res.status(500).json({ success: false, error: 'Erreur lors de la génération de la clé API.' });
  }
});

app.post('/api/user/revoke-api-key', checkAuth, async (req, res) => {
  try {
    const uid = req.user.uid;
    const userRef = db.collection('users').doc(uid);
    const userDoc = await userRef.get();

    if (!userDoc.exists) {
      return res.json({ success: true, message: 'Aucune clé à révoquer.' });
    }

    await userRef.update({
      apiKey: admin.firestore.FieldValue.delete(),
      apiKeyPrefix: admin.firestore.FieldValue.delete(),
      apiKeyCreatedAt: admin.firestore.FieldValue.delete(),
    });

    res.json({ success: true, message: 'Clé API révoquée avec succès.' });
  } catch (error) {
    console.error('Erreur /api/user/revoke-api-key:', error);
    res.status(500).json({ success: false, error: 'Erreur lors de la révocation de la clé API.' });
  }
});
app.get('/api/user/reveal-api-key', checkAuth, async (req, res) => {
  try {
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    const uid = req.user.uid;
    const userDoc = await db.collection('users').doc(uid).get();

    if (!userDoc.exists || !userDoc.data().apiKey) {
      return res.status(404).json({ success: false, error: 'Aucune clé API active.' });
    }

    res.json({ success: true, apiKey: userDoc.data().apiKey });
  } catch (error) {
    console.error('Erreur /api/user/reveal-api-key:', error);
    res.status(500).json({ success: false, error: 'Erreur interne.' });
  }
});

async function bumpDailyCounter(field, date = new Date()) {
  try {
    await db.collection('dailyCounters').doc(localDateKey(date)).set({
      [field]: admin.firestore.FieldValue.increment(1),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });
  } catch (e) { console.warn('bumpDailyCounter error:', e.message); }
}

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

  let finalEmail = req.user.email || '';
  let finalName  = req.user.name || 'Client';

  try {
    const userDoc = await db.collection('users').doc(uid).get();
    if (userDoc.exists) {
      const uData = userDoc.data();
      finalEmail = uData.email || finalEmail; finalName = uData.displayName || uData.username || finalName;
    }
  } catch (e) {}

  const payload = {
    amount: amountNum, currency: currency || 'XAF', description: description || 'Recharge',
    redirect_url: redirectUrl, webhook_url: webhookUrl, phone: phone || '', email: finalEmail, name: finalName
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

    const checkoutUrl = respJson.data?.url || respJson.link || respJson.url;
    const fapshiTransId = respJson.transId || respJson.data?.transId || null;

    if (!checkoutUrl) return res.status(502).json({ success: false, error: 'URL manquante.' });

    const transDocId = fapshiTransId || db.collection('fapshiTransactions').doc().id;
    await db.collection('fapshiTransactions').doc(transDocId).set({
      fapshiTransId: fapshiTransId, userId: uid, amount: amountNum, currency: currency || 'XAF',
      description: payload.description, phone: phone || null, status: 'PENDING',
      dateInitiated: admin.firestore.FieldValue.serverTimestamp(), checkoutUrl,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    await upsertDepositOperationLog({ provider: 'Fapshi', transactionId: transDocId, userId: uid, amountXAF: amountNum, status: 'PENDING', action: 'Recharge initiée', source: 'fapshi-init' });

    return res.json({ success: true, checkoutUrl });
  } catch (err) {
    clearTimeout(timer);
    return res.status(500).json({ success: false, error: 'Erreur communication avec Fapshi.' });
  }
});

app.post('/api/fapshi-webhook', async (req, res) => {
  const { status, amount, transId } = req.body;
  const incomingStatus = String(status || '').toUpperCase();
  if (incomingStatus !== 'SUCCESSFUL') {
    const failedStatuses = new Set(['FAILED', 'EXPIRED', 'CANCELLED', 'CANCELED', 'REVERSED']);
    if (transId && failedStatuses.has(incomingStatus)) {
      try {
        const failedRef = db.collection('fapshiTransactions').doc(String(transId));
        const failedDoc = await failedRef.get();
        if (failedDoc.exists && String(failedDoc.data()?.status || '').toUpperCase() !== 'CONFIRMED') {
          const tx = failedDoc.data() || {};
          await failedRef.update({ status: 'FAILED', failureReason: incomingStatus, lastChecked: admin.firestore.FieldValue.serverTimestamp() });
          await upsertDepositOperationLog({ provider: 'Fapshi', transactionId: transId, userId: tx.userId, amountXAF: Number(tx.amount || amount || 0), status: 'FAILED', action: 'Recharge échouée', source: 'fapshi-webhook' });
        }
      } catch (auditError) {
        console.warn('[Fapshi] Impossible de journaliser le statut:', auditError.message);
      }
    }
    return res.status(200).json({ message: 'Statut non confirmé reçu.' });
  }

  const amountNum = Number(amount);
  const transRef = db.collection('fapshiTransactions').doc(transId);

  try {
    const transDoc = await transRef.get();
    if (!transDoc.exists || transDoc.data().status === 'CONFIRMED') return res.status(200).json({ message: 'OK' });

    const transData = transDoc.data();
    await transRef.update({ status: 'CONFIRMED', amountConfirmed: amountNum, dateConfirmed: admin.firestore.FieldValue.serverTimestamp() });

    const userRef = db.collection('users').doc(transData.userId);
    let balanceBefore = 0, balanceAfter = amountNum;
    await db.runTransaction(async (t) => {
      const userDoc = await t.get(userRef);
      balanceBefore = userDoc.exists ? Number(userDoc.data().balance || 0) : 0;
      balanceAfter = balanceBefore + amountNum;
      if (!userDoc.exists) t.set(userRef, { balance: balanceAfter });
      else t.update(userRef, { balance: balanceAfter });
    });
    await recordDailyDepositCredit(transData.userId, amountNum, 'Fapshi', transId, balanceBefore, balanceAfter);
    await bumpDailyCounter('deposits');
    return res.status(200).json({ message: 'Webhook traité.' });
  } catch (err) {
    return res.status(500).json({ error: 'Erreur webhook.' });
  }
});

app.post('/api/fapshi-check-status', checkAuth, async (req, res) => {
  const { transId } = req.body;
  const uid = req.user.uid;

  if (!transId) {
    return res.status(400).json({ success: false, error: 'transId requis.' });
  }

  try {
    const transRef = db.collection('fapshiTransactions').doc(transId);
    const transDoc = await transRef.get();

    if (!transDoc.exists) {
      return res.status(404).json({ success: false, error: 'Transaction introuvable.' });
    }

    const transData = transDoc.data();

    if (transData.userId !== uid) {
      return res.status(403).json({ success: false, error: 'Accès non autorisé.' });
    }

    if (transData.status === 'CONFIRMED') {
      return res.json({ success: true, status: 'CONFIRMED', alreadyCredited: true });
    }

    const fapshiTransId = transData.fapshiTransId || transId;
    const API_USER = process.env.FAPSHI_API_USER;
    const SECRET_KEY = process.env.FAPSHI_SECRET_KEY;

    if (!API_USER || !SECRET_KEY) {
      throw new Error('Configuration Fapshi incomplète.');
    }

    const fapshiRes = await fetch(`https://live.fapshi.com/payment-status/${fapshiTransId}`, {
      headers: {
        'apiuser': API_USER,
        'apikey': SECRET_KEY,
        'Content-Type': 'application/json'
      }
    });

    if (!fapshiRes.ok) {
      const errorText = await fapshiRes.text();
      throw new Error(`Fapshi API error: ${fapshiRes.status} - ${errorText}`);
    }

    const fapshiData = await fapshiRes.json();

    let status = fapshiData.status || 'PENDING';
    const statusUpper = status.toUpperCase();

    let updatedStatus = statusUpper;
    let credited = false;

    if (statusUpper === 'SUCCESSFUL') {
      if (transData.status === 'CONFIRMED') {
        credited = true;
      } else {
        const amountToCredit = transData.amount || 0;
        if (amountToCredit > 0) {
          const userRef = db.collection('users').doc(uid);
          let balanceBefore = 0, balanceAfter = amountToCredit;
          await db.runTransaction(async (t) => {
            const userDoc = await t.get(userRef);
            balanceBefore = userDoc.exists ? Number(userDoc.data().balance || 0) : 0;
            balanceAfter = balanceBefore + amountToCredit;
            if (userDoc.exists) t.update(userRef, { balance: balanceAfter });
            else t.set(userRef, { balance: balanceAfter }, { merge: true });
            t.update(transRef, {
              status: 'CONFIRMED',
              dateConfirmed: admin.firestore.FieldValue.serverTimestamp()
            });
          });
          await recordDailyDepositCredit(uid, amountToCredit, 'Fapshi', transId, balanceBefore, balanceAfter);
          await bumpDailyCounter('deposits');
          credited = true;
          updatedStatus = 'CONFIRMED';
        } else {
          await transRef.update({ status: 'FAILED' });
          updatedStatus = 'FAILED';
        }
      }
    } else if (statusUpper === 'PENDING' || statusUpper === 'WAITING' || statusUpper === 'INITIATED') {
      await transRef.update({ lastChecked: admin.firestore.FieldValue.serverTimestamp() });
      updatedStatus = 'PENDING';
    } else if (statusUpper === 'FAILED' || statusUpper === 'EXPIRED' || statusUpper === 'CANCELED' || statusUpper === 'REVERSED') {
      await transRef.update({ status: 'FAILED' });
      updatedStatus = 'FAILED';
    } else {
      await transRef.update({ status: statusUpper });
      updatedStatus = statusUpper;
    }

    if (updatedStatus !== 'CONFIRMED') {
      await upsertDepositOperationLog({
        provider: 'Fapshi', transactionId: transId, userId: uid,
        amountXAF: Number(transData.amount || 0), status: updatedStatus,
        action: updatedStatus === 'FAILED' ? 'Recharge échouée' : 'Recharge en attente',
        source: 'fapshi-status',
      });
    }

    return res.json({
      success: true,
      status: updatedStatus,
      credited: credited,
      fapshiStatus: status
    });

  } catch (error) {
    console.error('Erreur /api/fapshi-check-status:', error);
    return res.status(500).json({
      success: false,
      error: error.message || 'Erreur lors de la vérification du statut.'
    });
  }
});

const NELSIUSPAY_API_URL          = 'https://api.nelsiuspay.com/api/v1';
const NELSIUSPAY_MIN_AMOUNT_XAF   = 1380;
const NELSIUSPAY_MAX_AMOUNT_XAF   = 10000000;
const NELSIUSPAY_FEE_BEARER       = 'customer';
const NELSIUSPAY_MIN_PROVIDER_AMT = 100;

const SBH_CURRENCY_RATES = {
  'XAF': 1, 'XOF': 1, 'USD': 590, 'EUR': 690, 'GBP': 771.60, 'CAD': 408.95, 'CHF': 703.08,
  'JPY': 3.6921, 'CNY': 86.92, 'INR': 6.0616, 'AED': 158.68, 'SAR': 155.20, 'TRY': 11.86,
  'RUB': 6.9466, 'ZAR': 35.01, 'MAD': 58.68, 'GHS': 49.67, 'NGN': 0.4346, 'KES': 4.4919,
  'UGX': 0.1577, 'TZS': 0.2260, 'RWF': 0.4200, 'ZMW': 24.39, 'CDF': 0.2344, 'AOA': 0.6400,
  'MZN': 9.1200, 'BRL': 103.50, 'MXN': 29.60, 'AUD': 375.40, 'NZD': 340.20, 'KRW': 0.4233,
  'SGD': 432.10, 'THB': 16.90, 'MYR': 130.20, 'IDR': 0.0373, 'PHP': 10.35, 'VND': 0.0230,
  'PLN': 147.80, 'SEK': 54.20, 'NOK': 52.80, 'DKK': 92.60, 'CZK': 25.10, 'HUF': 1.5900,
  'RON': 138.70, 'BGN': 352.80, 'HRK': 91.50, 'UAH': 14.05, 'ILS': 158.30, 'EGP': 11.90,
  'TND': 187.60, 'DZD': 4.3500, 'LYD': 120.50, 'QAR': 159.80, 'KWD': 1898.00, 'BHD': 1545.00,
  'OMR': 1514.00, 'JOD': 822.00, 'LBP': 0.0065, 'PKR': 2.0800, 'BDT': 4.8300, 'LKR': 1.9800,
  'NPR': 3.7800, 'MUR': 12.60, 'SCR': 42.30, 'MGA': 0.1300, 'MVR': 37.80, 'AFN': 7.8000,
  'IRR': 0.0138, 'IQD': 0.4450, 'SYP': 0.0440, 'YER': 2.3800, 'ETB': 4.1500, 'GMD': 8.2000,
  'GNF': 0.0670, 'LRD': 3.0200, 'SLL': 0.0270, 'SOS': 1.0100, 'SDG': 0.9700, 'SSP': 0.4500,
  'DJF': 3.2800, 'KMF': 1.3800, 'CVE': 6.3100, 'STN': 28.20, 'BIF': 0.2000, 'ERN': 38.80,
  'LSL': 35.10, 'SZL': 35.10, 'NAD': 35.10, 'BWP': 44.50, 'MWK': 0.3350, 'ZWG': 22.10,
  'ZWL': 0.0020, 'ALL': 6.30, 'XCD': 215.80, 'AMD': 1.50, 'AZN': 347.00, 'BSD': 582.82,
  'BBD': 291.41, 'BZD': 291.41, 'BTN': 6.06, 'BYN': 178.00, 'MMK': 0.28, 'BOB': 84.50,
  'BAM': 352.80, 'BND': 432.10, 'KHR': 0.14, 'KPW': 0.65, 'CRC': 1.13, 'CUP': 24.28,
  'ANG': 325.60, 'GIP': 771.60, 'GTQ': 75.10, 'GYD': 2.79, 'HTG': 4.42, 'HNL': 23.50,
  'ISK': 4.20, 'JMD': 3.75, 'KZT': 1.20, 'KGS': 6.67, 'LAK': 0.027, 'MKD': 10.20,
  'MDL': 32.80, 'MNT': 0.17, 'NIO': 16.00, 'XPF': 5.78, 'UZS': 0.046, 'PAB': 582.82,
  'PGK': 155.00, 'PYG': 0.079, 'HKD': 74.60, 'RSD': 5.88, 'SRD': 16.50, 'TJS': 53.50,
  'TWD': 18.30, 'TOP': 245.00, 'TTD': 86.00, 'TMT': 166.50, 'WST': 210.00, 'SBD': 71.00,
  'MRU': 14.68, 'PEN': 155.00, 'CLP': 0.61, 'COP': 0.14, 'ARS': 1.40, 'UYU': 14.60,
  'VES': 16.00, 'GEL': 216.00, 'FJD': 258.00, 'VUV': 4.90,
};

function convertToXAF(amount, currency) {
  const cur = (currency || '').toUpperCase();
  const rate = SBH_CURRENCY_RATES[cur];
  if (rate === undefined) throw new Error(`Devise non supportée : ${currency}`);
  if (rate <= 0) throw new Error(`Taux invalide pour ${currency}`);
  return Math.round(Number(amount) * rate);
}

async function generatePaymentReference() {
  const counterRef = db.collection('counters').doc('paymentReferences');
  let nextId;

  await db.runTransaction(async (t) => {
    const doc = await t.get(counterRef);
    const lastId = (doc.exists ? doc.data().lastId : 0) || 0;
    nextId = lastId + 1;
    t.set(counterRef, {
      lastId: nextId,
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    }, { merge: true });
  });

  const padded = String(nextId).padStart(4, '0');
  return `SBH-PAY-INT-${padded}`;
}

async function callNelsiusPay(endpoint, method = 'GET', body = null) {
  const apiKey = process.env.NELSIUSPAY_API_KEY;
  if (!apiKey) {
    throw new Error('NELSIUSPAY_API_KEY non définie. Configurez la variable d\'environnement.');
  }

  const url = `${NELSIUSPAY_API_URL}${endpoint}`;
  const headers = {
    'Content-Type': 'application/json',
    'Accept': 'application/json',
    'X-Api-Key': apiKey,
  };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);

  try {
    const options = { method, headers, signal: controller.signal };
    if (body) options.body = JSON.stringify(body);

    const response = await fetch(url, options);
    clearTimeout(timer);

    const rawText = await response.text();
    let data;
    try { data = JSON.parse(rawText); } catch { data = { raw: rawText }; }

    return { status: response.status, ok: response.ok, data };
  } catch (err) {
    clearTimeout(timer);
    if (err.name === 'AbortError') throw new Error('Timeout de la requête NelsiusPay.');
    throw err;
  }
}

function normalizeNelsiusStatus(providerStatus) {
  const s = (providerStatus || '').toLowerCase();
  switch (s) {
    case 'completed': return 'CONFIRMED';
    case 'pending':   return 'PENDING';
    case 'failed':    return 'FAILED';
    default:          return 'PENDING';
  }
}

app.post('/api/nelsiuspay/checkout', checkAuth, async (req, res) => {
  const uid = req.user.uid;
  const { amount, currency } = req.body;

  const requestedAmount = Number(amount);
  if (!amount || isNaN(requestedAmount) || requestedAmount <= 0) {
    return res.status(400).json({ success: false, error: 'Montant invalide. Veuillez fournir un montant positif.' });
  }
  if (!Number.isInteger(requestedAmount)) {
    return res.status(400).json({ success: false, error: 'Le montant doit être un entier.' });
  }

  const requestedCurrency = (currency || 'XAF').toUpperCase();
  if (!SBH_CURRENCY_RATES[requestedCurrency]) {
    return res.status(400).json({ success: false, error: `Devise non supportée : ${requestedCurrency}` });
  }

  let creditedAmountXAF;
  try {
    creditedAmountXAF = convertToXAF(requestedAmount, requestedCurrency);
  } catch (convErr) {
    return res.status(400).json({ success: false, error: convErr.message });
  }

  if (creditedAmountXAF < NELSIUSPAY_MIN_AMOUNT_XAF) {
    return res.status(400).json({ success: false, error: `Le montant minimum de recharge est de ${NELSIUSPAY_MIN_AMOUNT_XAF.toLocaleString('fr-FR')} FCFA (≈ 2 €).` });
  }
  if (creditedAmountXAF > NELSIUSPAY_MAX_AMOUNT_XAF) {
    return res.status(400).json({ success: false, error: `Le montant maximum de recharge est de ${NELSIUSPAY_MAX_AMOUNT_XAF.toLocaleString('fr-FR')} FCFA.` });
  }

  if (!process.env.NELSIUSPAY_API_KEY) {
    console.error('[NelsiusPay] NELSIUSPAY_API_KEY non définie.');
    return res.status(500).json({ success: false, error: 'Configuration de paiement incomplète. Contactez le support.' });
  }

  let providerAmount   = requestedAmount;
  let providerCurrency = requestedCurrency;

  if (requestedAmount < NELSIUSPAY_MIN_PROVIDER_AMT) {
    providerAmount   = creditedAmountXAF;
    providerCurrency = 'XAF';
    console.log(`[NelsiusPay] Montant local ${requestedAmount} ${requestedCurrency} < ${NELSIUSPAY_MIN_PROVIDER_AMT} → envoi en XAF : ${providerAmount} XAF`);
  }

  let customerEmail = req.user.email || '';
  let customerPhone = '';
  let customerName = '';
  try {
    const userDoc = await db.collection('users').doc(uid).get();
    if (userDoc.exists) {
      const uData = userDoc.data();
      customerEmail = uData.email || customerEmail;
      customerPhone = uData.phone || '';
      customerName = uData.displayName || uData.username || '';
    }
  } catch (e) {
    console.warn('[NelsiusPay] Impossible de récupérer le profil utilisateur:', e.message);
  }

  if (req.body.customer_name) customerName = req.body.customer_name;
  if (req.body.customer_email) customerEmail = req.body.customer_email;
  if (req.body.customer_phone) customerPhone = req.body.customer_phone;

  const reference = await generatePaymentReference();

  const host = req.headers['x-forwarded-host'] || req.headers.host || 'socialboosthorizon.com';
  const protocol = req.headers['x-forwarded-proto'] || 'https';
  const baseUrl = `${protocol}://${host}`;
  const returnUrl  = `${baseUrl}/paiement-carte.html?status=return&ref=${encodeURIComponent(reference)}`;
  const cancelUrl  = `${baseUrl}/paiement-carte.html?status=cancel&ref=${encodeURIComponent(reference)}`;

  const checkoutPayload = {
    amount: providerAmount,
    currency: providerCurrency,
    customer_email: customerEmail || undefined,
    customer_phone: customerPhone || undefined,
    customer_name: customerName || undefined,
    reference: reference,
    return_url: returnUrl,
    cancel_url: cancelUrl,
    fee_bearer: NELSIUSPAY_FEE_BEARER,
    metadata: {
      product_name: 'Recharge Social Boost Horizon',
      userId: uid,
      country: req.body.country || 'CM',
      creditedAmountXAF: String(creditedAmountXAF),
      originalAmount: String(requestedAmount),
      originalCurrency: requestedCurrency,
    },
  };

  Object.keys(checkoutPayload).forEach(k => {
    if (checkoutPayload[k] === undefined) delete checkoutPayload[k];
  });

  let nelsiusResponse;
  try {
    console.log(`[NelsiusPay] Initiation checkout — ref=${reference} user=${uid} amount=${providerAmount} ${providerCurrency} → ${creditedAmountXAF} XAF`);
    nelsiusResponse = await callNelsiusPay('/checkout/initiate', 'POST', checkoutPayload);
  } catch (callErr) {
    console.error('[NelsiusPay] Erreur appel checkout:', callErr.message);
    return res.status(502).json({ success: false, error: 'Impossible de contacter le service de paiement. Veuillez réessayer.' });
  }

  if (!nelsiusResponse.ok) {
    const errMsg = nelsiusResponse.data?.message || nelsiusResponse.data?.error || `Erreur de paiement (HTTP ${nelsiusResponse.status})`;
    console.error('[NelsiusPay] Réponse erreur checkout:', nelsiusResponse.status, errMsg);
    return res.status(nelsiusResponse.status >= 500 ? 502 : 400).json({ success: false, error: errMsg });
  }

  const respData = nelsiusResponse.data;
  const checkoutUrl = respData?.data?.checkout_url
    || respData?.checkout_url
    || respData?.url
    || respData?.data?.url
    || null;

  if (!checkoutUrl) {
    console.error('[NelsiusPay] URL de checkout manquante dans la réponse:', JSON.stringify(respData));
    return res.status(502).json({ success: false, error: 'URL de paiement manquante dans la réponse du fournisseur.' });
  }

  const transactionCode = respData?.data?.transaction_code || respData?.transaction_code || null;

  try {
    await db.collection('paymentTransactions').doc(reference).set({
      reference,
      userId: uid,
      provider: 'nelsiuspay',
      requestedAmount,
      requestedCurrency,
      providerAmount,
      providerCurrency,
      creditedAmountXAF,
      conversionRate: SBH_CURRENCY_RATES[requestedCurrency],
      status: 'PENDING',
      checkoutUrl,
      transactionCode,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      completedAt: null,
      failureReason: null,
      providerResponse: JSON.stringify(respData).substring(0, 2000),
    });
    console.log(`[NelsiusPay] Transaction Firestore créée: ${reference}`);
    await upsertDepositOperationLog({ provider: 'NelsiusPay', transactionId: reference, userId: uid, amountXAF: creditedAmountXAF, status: 'PENDING', action: 'Recharge initiée', source: 'nelsiuspay-init' });
  } catch (dbErr) {
    console.error('[NelsiusPay] Erreur écriture Firestore:', dbErr.message);
  }

  return res.json({
    success: true,
    checkoutUrl,
    reference,
    creditedAmountXAF,
    requestedAmount,
    requestedCurrency,
  });
});

app.post('/api/nelsiuspay/status', checkAuth, async (req, res) => {
  const uid = req.user.uid;
  const reference = req.body?.reference || req.query?.reference;

  if (!reference) {
    return res.status(400).json({ success: false, error: 'Référence de transaction requise.' });
  }

  try {
    const transRef = db.collection('paymentTransactions').doc(reference);
    const transDoc = await transRef.get();

    if (!transDoc.exists) {
      return res.status(404).json({ success: false, error: 'Transaction introuvable.' });
    }

    const transData = transDoc.data();

    if (transData.userId !== uid) {
      return res.status(403).json({ success: false, error: 'Accès refusé.' });
    }

    if (transData.status === 'CONFIRMED') {
      const userDoc = await db.collection('users').doc(uid).get();
      const currentBalance = userDoc.exists ? (userDoc.data().balance || 0) : 0;
      return res.json({
        success: true,
        status: 'CONFIRMED',
        creditedAmountXAF: transData.creditedAmountXAF || 0,
        newBalance: currentBalance,
        reference,
      });
    }

    if (!process.env.NELSIUSPAY_API_KEY) {
      return res.status(500).json({ success: false, error: 'Configuration de paiement incomplète.' });
    }

    let nelsiusStatusResp;
    try {
      nelsiusStatusResp = await callNelsiusPay(`/payments/${encodeURIComponent(reference)}`, 'GET');
    } catch (callErr) {
      console.error('[NelsiusPay] Erreur appel status:', callErr.message);
      return res.status(502).json({ success: false, error: 'Impossible de vérifier le statut. Veuillez réessayer.' });
    }

    if (!nelsiusStatusResp.ok) {
      if (nelsiusStatusResp.status === 404) {
        return res.status(404).json({ success: false, error: 'Transaction non trouvée chez le fournisseur.' });
      }
      return res.status(400).json({
        success: false,
        error: nelsiusStatusResp.data?.message || `Erreur de vérification (HTTP ${nelsiusStatusResp.status})`,
      });
    }

    const nelsiusData = nelsiusStatusResp.data?.data || nelsiusStatusResp.data;
    const providerStatus = nelsiusData?.status || 'pending';
    const internalStatus = normalizeNelsiusStatus(providerStatus);
    const providerAmount = Number(nelsiusData?.amount) || transData.providerAmount;
    const providerCurrency = (nelsiusData?.currency || transData.providerCurrency || 'XAF').toUpperCase();
    const transactionCode = nelsiusData?.transaction_code || transData.transactionCode || null;

    if (internalStatus !== transData.status || transactionCode !== transData.transactionCode) {
      await transRef.update({
        status: internalStatus,
        transactionCode,
        providerAmount,
        providerCurrency,
        lastChecked: admin.firestore.FieldValue.serverTimestamp(),
      });
    }
    if (internalStatus !== transData.status) {
      await upsertDepositOperationLog({ provider: 'NelsiusPay', transactionId: reference, userId: uid, amountXAF: Number(transData.creditedAmountXAF || 0), status: internalStatus, action: internalStatus === 'CONFIRMED' ? 'Recharge confirmée' : (internalStatus === 'FAILED' ? 'Recharge échouée' : 'Recharge en attente'), source: 'nelsiuspay-status' });
    }

    if (internalStatus === 'CONFIRMED') {
      const wasCredited = await creditUserIfNeeded(reference, uid, transData);
      if (wasCredited) await bumpDailyCounter('deposits');
      const userDoc = await db.collection('users').doc(uid).get();
      const newBalance = userDoc.exists ? (userDoc.data().balance || 0) : 0;
      return res.json({
        success: true,
        status: 'CONFIRMED',
        creditedAmountXAF: transData.creditedAmountXAF || 0,
        newBalance,
        reference,
      });
    }

    return res.json({
      success: true,
      status: internalStatus,
      providerStatus,
      creditedAmountXAF: transData.creditedAmountXAF || 0,
      reference,
    });

  } catch (error) {
    console.error('[NelsiusPay] Erreur /status:', error);
    return res.status(500).json({ success: false, error: 'Erreur technique lors de la vérification.' });
  }
});

app.post('/api/nelsiuspay/webhook', async (req, res) => {
  const event = req.body?.event;
  const data  = req.body?.data;

  console.log(`[NelsiusPay Webhook] Événement reçu: ${event}`);

  if (!event || !data) {
    return res.status(200).json({ received: true });
  }

  if (event !== 'payment.success' && event !== 'payment.failed') {
    return res.status(200).json({ received: true, ignored: true });
  }

  const reference = data.reference;
  if (!reference) {
    console.warn('[NelsiusPay Webhook] Référence manquante dans le payload.');
    return res.status(200).json({ received: true });
  }

  try {
    const transRef = db.collection('paymentTransactions').doc(reference);
    const transDoc = await transRef.get();

    if (!transDoc.exists) {
      console.warn(`[NelsiusPay Webhook] Transaction introuvable: ${reference}`);
      return res.status(200).json({ received: true });
    }

    const transData = transDoc.data();

    if (transData.status === 'CONFIRMED') {
      console.log(`[NelsiusPay Webhook] Transaction déjà confirmée, ignorée: ${reference}`);
      return res.status(200).json({ received: true, alreadyConfirmed: true });
    }

    let providerVerifiedStatus = null;
    if (process.env.NELSIUSPAY_API_KEY) {
      try {
        const verifyResp = await callNelsiusPay(`/payments/${encodeURIComponent(reference)}`, 'GET');
        if (verifyResp.ok) {
          const vData = verifyResp.data?.data || verifyResp.data;
          providerVerifiedStatus = (vData?.status || '').toLowerCase();
        }
      } catch (vErr) {
        console.warn('[NelsiusPay Webhook] Vérification serveur impossible, on utilise le payload webhook:', vErr.message);
      }
    }

    let finalStatus;
    if (event === 'payment.success') {
      if (providerVerifiedStatus && providerVerifiedStatus !== 'completed') {
        console.log(`[NelsiusPay Webhook] Vérification serveur contradictoire (${providerVerifiedStatus}), on attend.`);
        return res.status(200).json({ received: true, deferred: true });
      }
      finalStatus = 'CONFIRMED';
    } else if (event === 'payment.failed') {
      finalStatus = 'FAILED';
    } else {
      return res.status(200).json({ received: true });
    }

    const webhookAmount = Number(data.amount);
    const webhookCurrency = (data.currency || '').toUpperCase();
    const storedAmount = Number(transData.providerAmount);
    const storedCurrency = (transData.providerCurrency || '').toUpperCase();

    if (webhookAmount && storedAmount && webhookAmount !== storedAmount) {
      console.error(`[NelsiusPay Webhook] Incohérence de montant: webhook=${webhookAmount} stocké=${storedAmount}`);
      return res.status(200).json({ received: true, error: 'amount_mismatch' });
    }
    if (webhookCurrency && storedCurrency && webhookCurrency !== storedCurrency) {
      console.error(`[NelsiusPay Webhook] Incohérence de devise: webhook=${webhookCurrency} stocké=${storedCurrency}`);
      return res.status(200).json({ received: true, error: 'currency_mismatch' });
    }

    await transRef.update({
      status: finalStatus,
      transactionCode: data.transaction_code || transData.transactionCode || null,
      completedAt: finalStatus === 'CONFIRMED' ? admin.firestore.FieldValue.serverTimestamp() : null,
      failureReason: finalStatus === 'FAILED' ? (data.reason || 'Paiement refusé') : null,
      providerResponse: JSON.stringify(data).substring(0, 2000),
      lastChecked: admin.firestore.FieldValue.serverTimestamp(),
    });

    await upsertDepositOperationLog({ provider: 'NelsiusPay', transactionId: reference, userId: transData.userId, amountXAF: Number(transData.creditedAmountXAF || 0), status: finalStatus, action: finalStatus === 'CONFIRMED' ? 'Recharge confirmée' : (finalStatus === 'FAILED' ? 'Recharge échouée' : 'Recharge en attente'), source: 'nelsiuspay-webhook' });

    if (finalStatus === 'CONFIRMED') {
      const wasCredited = await creditUserIfNeeded(reference, transData.userId, transData);
      if (wasCredited) await bumpDailyCounter('deposits');
    }

    console.log(`[NelsiusPay Webhook] Traité: ${reference} → ${finalStatus}`);
    return res.status(200).json({ received: true, status: finalStatus });

  } catch (error) {
    console.error('[NelsiusPay Webhook] Erreur traitement:', error);
    return res.status(200).json({ received: true });
  }
});

async function creditUserIfNeeded(reference, userId, transData) {
  const transRef = db.collection('paymentTransactions').doc(reference);
  const userRef = db.collection('users').doc(userId);
  let creditedNow = false;
  let audit = null;

  await db.runTransaction(async (t) => {
    const freshTrans = await t.get(transRef);
    if (!freshTrans.exists) {
      throw new Error(`Transaction ${reference} introuvable dans la transaction Firestore.`);
    }

    const freshData = freshTrans.data();
    if (freshData.status === 'CONFIRMED' && freshData.creditedAt) {
      return;
    }

    const amountToCredit = freshData.creditedAmountXAF || 0;
    if (amountToCredit <= 0) {
      throw new Error(`Montant à créditer invalide pour ${reference}: ${amountToCredit}`);
    }

    const freshUser = await t.get(userRef);
    const currentBalance = freshUser.exists ? (freshUser.data().balance || 0) : 0;
    const newBalance = currentBalance + amountToCredit;

    if (freshUser.exists) {
      t.update(userRef, { balance: newBalance });
    } else {
      t.set(userRef, { balance: newBalance }, { merge: true });
    }

    t.update(transRef, {
      status: 'CONFIRMED',
      creditedAt: admin.firestore.FieldValue.serverTimestamp(),
      newBalanceAfterCredit: newBalance,
    });

    creditedNow = true;
    audit = { amount: amountToCredit, balanceBefore: currentBalance, balanceAfter: newBalance };
    console.log(`[NelsiusPay] Crédit effectué: +${amountToCredit} XAF → ${userId} (solde: ${currentBalance} → ${newBalance})`);
  });

  if (creditedNow && audit) {
    await recordDailyDepositCredit(userId, audit.amount, 'NelsiusPay', reference, audit.balanceBefore, audit.balanceAfter);
  }
  return creditedNow;
}

function getClientIp(req) {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.length) {
    return forwarded.split(',')[0].trim();
  }
  return (req.ip || req.connection?.remoteAddress || req.socket?.remoteAddress || 'unknown').toString();
}

function sha256Short(str) {
  return crypto.createHash('sha256').update(String(str)).digest('hex').slice(0, 32);
}

// Une seule ligne de journal par recharge, mise à jour à chaque changement
// d'état. Cela conserve l'historique utile sans créer des doublons à chaque
// vérification du statut par le client.
async function upsertDepositOperationLog(details = {}) {
  const provider = String(details.provider || 'Inconnu');
  const transactionId = String(details.transactionId || '').trim();
  if (!transactionId) return;
  const id = `deposit_${sha256Short(`${provider}|${transactionId}`)}`;
  try {
    await db.collection('adminOperationLogs').doc(id).set({
      type: details.status === 'CONFIRMED' ? 'deposit_credit' : 'deposit_transaction',
      category: 'recharge',
      action: details.action || (details.status === 'CONFIRMED' ? 'Recharge créditée' : 'Tentative de recharge'),
      userId: details.userId || null,
      amountXAF: Number(details.amountXAF || 0),
      provider,
      transactionId,
      status: String(details.status || 'PENDING').toUpperCase(),
      balanceBefore: details.balanceBefore == null ? null : Number(details.balanceBefore),
      balanceAfter: details.balanceAfter == null ? null : Number(details.balanceAfter),
      source: details.source || 'payment-api',
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });
  } catch (error) {
    console.warn('[Audit] Journal de recharge non enregistré:', error.message);
  }
}

function normalizeWhatsappNumber(input) {
  if (!input) return '';
  let digits = String(input).replace(/[^0-9]/g, '');
  digits = digits.replace(/^00+/, '');
  return digits;
}

app.post('/api/track-dashboard-visit', async (req, res) => {
  try {
    const { userId } = req.body || {};
    if (!userId) return res.json({ success: true, shouldShowPromo: false });

    const userRef = db.collection('users').doc(userId);
    const userDoc = await userRef.get();

    const visitCount = userDoc.exists ? (userDoc.data().dashboardVisitCount || 0) : 0;
    const lastPromoSeen = userDoc.exists ? userDoc.data().lastPromoSeen : null;
    const lastPromoMs = getTimestampMs(lastPromoSeen);

    const PROMO_COOLDOWN_MS = 4 * 60 * 60 * 1000;
    const shouldShowPromo = !lastPromoMs || (Date.now() - lastPromoMs) > PROMO_COOLDOWN_MS;

    await userRef.set({
      dashboardVisitCount: visitCount + 1,
      lastDashboardVisit: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });

    await bumpDailyCounter('dashboardVisits');

    return res.json({ success: true, shouldShowPromo });
  } catch (error) {
    console.error('Erreur /api/track-dashboard-visit:', error);
    return res.json({ success: false, shouldShowPromo: false });
  }
});

app.post('/api/mark-promo-seen', async (req, res) => {
  try {
    const { userId } = req.body || {};
    if (!userId) return res.json({ success: false });
    await db.collection('users').doc(userId).set({
      lastPromoSeen: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });
    return res.json({ success: true });
  } catch (error) {
    console.error('Erreur /api/mark-promo-seen:', error);
    return res.json({ success: false });
  }
});

app.get('/api/check-gift-eligibility', checkAuth, async (req, res) => {
  try {
    const uid = req.user.uid;
    const ip  = getClientIp(req);
    const ipHash = sha256Short('ip:' + ip);

    const userDoc = await db.collection('users').doc(uid).get();
    if (userDoc.exists && userDoc.data().welcomeGiftClaimed === true) {
      return res.json({ eligible: false, reason: 'already_claimed' });
    }

    const ipDoc = await db.collection('welcomeGiftIps').doc(ipHash).get();
    if (ipDoc.exists) {
      return res.json({ eligible: false, reason: 'ip_already_claimed' });
    }

    if (userDoc.exists) {
      const createdMs = getTimestampMs(userDoc.data().createdAt);
      if (createdMs && (Date.now() - createdMs) > 7 * 24 * 60 * 60 * 1000) {
        return res.json({ eligible: false, reason: 'account_too_old' });
      }
    }

    return res.json({ eligible: true });
  } catch (error) {
    console.error('Erreur /api/check-gift-eligibility:', error);
    return res.json({ eligible: false, reason: 'error' });
  }
});

app.post('/api/claim-welcome-gift', checkAuth, async (req, res) => {
  try {
    const uid = req.user.uid;
    const { giftType, whatsapp, platform, link } = req.body || {};

    if (!giftType || !['money', 'likes', 'tiktok'].includes(giftType)) {
      return res.status(400).json({ success: false, error: 'Type de cadeau invalide.' });
    }

    const whatsappClean = normalizeWhatsappNumber(whatsapp);
    if (!whatsappClean || whatsappClean.length < 8) {
      return res.status(400).json({ success: false, error: 'Numéro WhatsApp invalide.' });
    }
    if (giftType === 'likes') {
      if (!platform || !link) {
        return res.status(400).json({ success: false, error: 'Plateforme et lien requis.' });
      }
    }
    if (giftType === 'tiktok') {
      if (!link) {
        return res.status(400).json({ success: false, error: 'Lien TikTok requis.' });
      }
    }

    const ip = getClientIp(req);
    const ipHash      = sha256Short('ip:' + ip);
    const phoneHash   = sha256Short('phone:' + whatsappClean);
    const emailHash   = req.user.email ? sha256Short('email:' + req.user.email.toLowerCase()) : null;

    const userRef  = db.collection('users').doc(uid);
    const ipRef    = db.collection('welcomeGiftIps').doc(ipHash);
    const phoneRef = db.collection('welcomeGiftPhones').doc(phoneHash);
    const emailRef = emailHash ? db.collection('welcomeGiftEmails').doc(emailHash) : null;

    await db.runTransaction(async (t) => {
      const userDoc  = await t.get(userRef);
      const ipDoc    = await t.get(ipRef);
      const phoneDoc = await t.get(phoneRef);
      const emailDoc = emailRef ? await t.get(emailRef) : null;

      if (userDoc.exists && userDoc.data().welcomeGiftClaimed === true) {
        throw new Error('ALREADY_CLAIMED');
      }
      if (ipDoc.exists) {
        throw new Error('IP_ALREADY_CLAIMED');
      }
      if (phoneDoc.exists) {
        throw new Error('PHONE_ALREADY_CLAIMED');
      }
      if (emailDoc && emailDoc.exists) {
        throw new Error('EMAIL_ALREADY_CLAIMED');
      }
      if (userDoc.exists) {
        const createdMs = getTimestampMs(userDoc.data().createdAt);
        if (createdMs && (Date.now() - createdMs) > 7 * 24 * 60 * 60 * 1000) {
          throw new Error('ACCOUNT_TOO_OLD');
        }
      }

      const uData = userDoc.exists ? userDoc.data() : {};
      const denormUserName = uData.displayName || uData.username || uData.name || req.user.name || null;
      const denormEmail    = uData.email || req.user.email || null;
      const denormCountry  = uData.country || null;

      const claimRef = db.collection('welcomeGiftClaims').doc();
      t.set(claimRef, {
        userId: uid,
        email: denormEmail,
        userName: denormUserName,
        country: denormCountry,
        giftType,
        whatsapp: whatsappClean,
        platform: platform || null,
        link: link || null,
        ipHash,
        status: 'pending',
        provider: null,
        providerOrderId: null,
        adminNote: null,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      t.set(ipRef, {
        userId: uid, giftType,
        claimedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
      t.set(phoneRef, {
        userId: uid, giftType,
        claimedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
      if (emailRef) {
        t.set(emailRef, {
          userId: uid, giftType,
          claimedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
      }

      t.set(userRef, {
        welcomeGiftClaimed: true,
        welcomeGiftType: giftType,
        welcomeGiftClaimedAt: admin.firestore.FieldValue.serverTimestamp(),
      }, { merge: true });
    });

    return res.json({ success: true });
  } catch (error) {
    const msg = error.message || '';
    if (msg === 'ALREADY_CLAIMED') {
      return res.status(400).json({ success: false, error: 'Vous avez déjà réclamé votre cadeau de bienvenue.' });
    }
    if (msg === 'IP_ALREADY_CLAIMED') {
      return res.status(400).json({ success: false, error: 'Un cadeau de bienvenue a déjà été réclamé depuis cet appareil.' });
    }
    if (msg === 'PHONE_ALREADY_CLAIMED') {
      return res.status(400).json({ success: false, error: 'Ce numéro WhatsApp a déjà été utilisé pour un cadeau de bienvenue.' });
    }
    if (msg === 'EMAIL_ALREADY_CLAIMED') {
      return res.status(400).json({ success: false, error: 'Un cadeau a déjà été réclamé avec cette adresse e-mail.' });
    }
    if (msg === 'ACCOUNT_TOO_OLD') {
      return res.status(400).json({ success: false, error: 'Votre compte est trop ancien pour bénéficier du cadeau de bienvenue.' });
    }
    console.error('Erreur /api/claim-welcome-gift:', error);
    return res.status(500).json({ success: false, error: 'Erreur lors de la réclamation du cadeau.' });
  }
});

const STORE_ALLOWED_APPS = ['sbh', 'kdo', 'trixhub'];
const STORE_DL_BASE      = { sbh: 15847, kdo: 4123, trixhub: 6891 };

const storeReviewsCache = new Map();
const STORE_REVIEWS_CACHE_TTL = 60 * 1000;

function isValidStoreApp(appId) {
  return STORE_ALLOWED_APPS.includes(appId);
}

app.post('/api/app-download', async (req, res) => {
  try {
    const { app: appId } = req.body || {};
    if (!appId || !isValidStoreApp(appId)) {
      return res.status(400).json({ success: false, error: 'Application invalide.' });
    }

    const countersRef = db.collection('appDownloadCounters').doc(appId);

    await countersRef.set({
      count: admin.firestore.FieldValue.increment(1),
      lastUpdated: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });

    const counterDoc = await countersRef.get();
    const count = (counterDoc.exists && counterDoc.data().count) || 0;
    const total = (STORE_DL_BASE[appId] || 0) + count;

    return res.json({ success: true, count, total });
  } catch (error) {
    console.error('Erreur /api/app-download:', error);
    return res.status(500).json({ success: false, error: 'Erreur lors de l\'enregistrement du téléchargement.' });
  }
});

app.get('/api/app-download-count', async (req, res) => {
  try {
    const appId = req.query.app;
    if (!appId || !isValidStoreApp(appId)) {
      return res.status(400).json({ success: false, error: 'Application invalide.' });
    }

    res.set('Cache-Control', 'public, max-age=60');

    const counterDoc = await db.collection('appDownloadCounters').doc(appId).get();
    const count = (counterDoc.exists && counterDoc.data().count) || 0;
    const total = (STORE_DL_BASE[appId] || 0) + count;

    return res.json({ success: true, count, total });
  } catch (error) {
    console.error('Erreur /api/app-download-count:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
});

app.get('/api/app-reviews', async (req, res) => {
  try {
    const appId = req.query.app;
    if (!appId || !isValidStoreApp(appId)) {
      return res.status(400).json({ success: false, error: 'Application invalide.' });
    }

    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');

    const cached = storeReviewsCache.get(appId);
    if (cached && Date.now() < cached.expires) {
      return res.json({ success: true, reviews: cached.reviews, stats: cached.stats, cached: true });
    }

    const snapshot = await db.collection('appReviews')
      .where('app', '==', appId)
      .limit(200)
      .get();

    let reviews = snapshot.docs.map(doc => {
      const data = doc.data();
      return {
        id: doc.id,
        name: data.name || 'Utilisateur',
        rating: data.rating || 0,
        comment: data.comment || '',
        likes: data.likes || 0,
        dislikes: data.dislikes || 0,
        createdAt: getTimestampMs(data.createdAt),
      };
    });

    reviews.sort((a, b) => b.createdAt - a.createdAt);
    if (reviews.length > 100) reviews = reviews.slice(0, 100);

    const distribution = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
    let sum = 0;
    reviews.forEach(r => {
      const rating = Math.round(r.rating);
      if (rating >= 1 && rating <= 5) distribution[rating]++;
      sum += r.rating;
    });
    const total = reviews.length;
    const average = total > 0 ? (sum / total) : 0;
    const stats = { total, average, distribution };

    storeReviewsCache.set(appId, {
      reviews,
      stats,
      expires: Date.now() + STORE_REVIEWS_CACHE_TTL,
    });

    return res.json({ success: true, reviews, stats });
  } catch (error) {
    console.error('Erreur /api/app-reviews:', error);
    return res.status(500).json({ success: false, error: 'Erreur lors du chargement des avis.' });
  }
});

app.post('/api/app-review', async (req, res) => {
  try {
    const { app: appId, name, rating, comment } = req.body || {};

    if (!appId || !isValidStoreApp(appId)) {
      return res.status(400).json({ success: false, error: 'Application invalide.' });
    }

    const ratingNum = parseInt(rating);
    if (!ratingNum || ratingNum < 1 || ratingNum > 5) {
      return res.status(400).json({ success: false, error: 'Note invalide (1 à 5 étoiles).' });
    }

    const cleanName    = (name || '').toString().trim().slice(0, 40) || 'Utilisateur';
    const cleanComment = (comment || '').toString().trim().slice(0, 500);

    const ip     = getClientIp(req);
    const ipHash = sha256Short('review:' + appId + ':' + ip);

    const rateRef = db.collection('appReviewRateLimits').doc(ipHash);
    const rateDoc = await rateRef.get();
    const lastAt  = rateDoc.exists ? getTimestampMs(rateDoc.data().lastAt) : 0;

    if (Date.now() - lastAt < 20 * 1000) {
      return res.status(429).json({
        success: false,
        error: 'Veuillez patienter quelques secondes avant de publier un nouvel avis.',
      });
    }

    const docRef = await db.collection('appReviews').add({
      app: appId,
      name: cleanName,
      rating: ratingNum,
      comment: cleanComment,
      likes: 0,
      dislikes: 0,
      ipHash,
      visible: true,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    await rateRef.set({
      lastAt: admin.firestore.FieldValue.serverTimestamp(),
      userId: null,
    });

    storeReviewsCache.delete(appId);

    return res.json({ success: true, reviewId: docRef.id });
  } catch (error) {
    console.error('Erreur /api/app-review:', error);
    return res.status(500).json({ success: false, error: 'Erreur lors de la publication de l\'avis.' });
  }
});

app.post('/api/app-review-reaction', async (req, res) => {
  try {
    const { reviewId, reaction, app: appId } = req.body || {};

    if (!reviewId || !['like', 'dislike'].includes(reaction)) {
      return res.status(400).json({ success: false, error: 'Paramètres invalides.' });
    }

    const ip = getClientIp(req);
    const reactionId = sha256Short('rxn:' + reviewId + ':' + ip);

    const reactionRef = db.collection('appReviewReactions').doc(reactionId);
    const reviewRef   = db.collection('appReviews').doc(reviewId);

    let likes = 0, dislikes = 0;

    await db.runTransaction(async (t) => {
      const reviewDoc = await t.get(reviewRef);
      if (!reviewDoc.exists) throw new Error('Avis introuvable.');

      const rData = reviewDoc.data();
      likes    = rData.likes    || 0;
      dislikes = rData.dislikes || 0;

      const reactionDoc = await t.get(reactionRef);
      const previous    = reactionDoc.exists ? reactionDoc.data().reaction : null;

      if (previous === reaction) {
        return;
      }

      if (previous === 'like')    likes    = Math.max(0, likes - 1);
      if (previous === 'dislike') dislikes = Math.max(0, dislikes - 1);

      if (reaction === 'like') likes++;
      else                     dislikes++;

      t.set(reactionRef, {
        reviewId,
        reaction,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      t.update(reviewRef, { likes, dislikes });
    });

    if (appId && isValidStoreApp(appId)) storeReviewsCache.delete(appId);

    return res.json({ success: true, likes, dislikes });
  } catch (error) {
    console.error('Erreur /api/app-review-reaction:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
});

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';
const ADMIN_SESSION_SECRET = process.env.ADMIN_SESSION_SECRET || '';
const ADMIN_SESSION_TTL_SECONDS = 4 * 60 * 60;

function constantTimeEqual(a, b) {
  const left = Buffer.from(String(a || ''), 'utf8');
  const right = Buffer.from(String(b || ''), 'utf8');
  if (!left.length || left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}

function signAdminSession(payload) {
  const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = crypto.createHmac('sha256', ADMIN_SESSION_SECRET).update(encoded).digest('base64url');
  return `${encoded}.${signature}`;
}

function verifyAdminSession(token) {
  if (!token || !ADMIN_SESSION_SECRET) return false;
  const parts = String(token).split('.');
  if (parts.length !== 2) return false;
  const [encoded, suppliedSignature] = parts;
  const expectedSignature = crypto.createHmac('sha256', ADMIN_SESSION_SECRET).update(encoded).digest('base64url');
  if (!constantTimeEqual(suppliedSignature, expectedSignature)) return false;
  try {
    const payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
    return payload.role === 'admin' && Number.isFinite(payload.exp) && payload.exp > Math.floor(Date.now() / 1000);
  } catch (_) {
    return false;
  }
}

function checkAdminPassword(req, res, next) {
  res.set('Cache-Control', 'no-store, private');
  const match = String(req.headers.authorization || '').match(/^Bearer\s+(.+)$/i);
  if (!ADMIN_SESSION_SECRET || ADMIN_SESSION_SECRET.length < 32) {
    return res.status(503).json({ success: false, error: 'ADMIN_SESSION_SECRET doit contenir au moins 32 caractères et être configurée dans Vercel.' });
  }
  if (!match || !verifyAdminSession(match[1])) {
    return res.status(401).json({ success: false, error: 'Session administrateur absente ou expirée.' });
  }
  next();
}

const ADMIN_CACHE_TTL = 30 * 60 * 1000;
let adminCache = { services: null, lastFetch: { services: 0 } };

function isAdminCacheValid(key) {
  return adminCache[key] && (Date.now() - adminCache.lastFetch[key] < ADMIN_CACHE_TTL);
}

async function getServicesData() {
  if (isAdminCacheValid('services')) return adminCache.services;
  let allServices = [];

  if (process.env.MORETHANPANEL_API_KEY) {
    try {
      const mtpData = await callMTP({ action: 'services' });
      if (Array.isArray(mtpData)) {
        mtpData.forEach(s => {
          const rate = parseFloat(s.rate) || 0; const providerCost = Math.round(rate * MTP_USD_TO_XAF);
          const finalPrice = Math.round(providerCost * MTP_MULTIPLIER); const profit = finalPrice - providerCost;
          allServices.push({ id: s.service, provider: 'MTP', name: s.name, category: s.category || '', providerCost, finalPrice, profit, profitMargin: Math.round((profit / finalPrice) * 100) || 0, min: parseInt(s.min) || 0, max: parseInt(s.max) || 0 });
        });
      }
    } catch (e) { console.warn('Erreur MTP:', e.message); }
  }

  if (process.env.EXO_API_KEY) {
    try {
      const exoData = await callExo({ action: 'services' });
      if (Array.isArray(exoData)) {
        exoData.forEach(s => {
          const rate = parseFloat(s.rate) || 0; const providerCost = Math.round(rate * EXO_USD_TO_XAF);
          const finalPrice = Math.round(providerCost * EXO_MULTIPLIER); const profit = finalPrice - providerCost;
          allServices.push({ id: s.service, provider: 'EXO', name: s.name, category: s.category || '', providerCost, finalPrice, profit, profitMargin: Math.round((profit / finalPrice) * 100) || 0, min: parseInt(s.min) || 0, max: parseInt(s.max) || 0 });
        });
      }
    } catch (e) { console.warn('Erreur EXO:', e.message); }
  }

  if (process.env.ADVANCED_PROVIDER_API_KEY) {
    try {
      const afbData = await callAfriqueBoost({ action: 'services' });
      if (Array.isArray(afbData)) {
        afbData.forEach(s => {
          const rateXAF = parseFloat(s.rate) || 0; const providerCost = Math.round(rateXAF);
          const finalPrice = Math.round(providerCost * AFB_MULTIPLIER); const profit = finalPrice - providerCost;
          allServices.push({ id: s.service, provider: 'AfriqueBoost', name: s.name, category: s.category || '', providerCost, finalPrice, profit, profitMargin: Math.round((profit / finalPrice) * 100) || 0, min: parseInt(s.min) || 0, max: parseInt(s.max) || 0 });
        });
      }
    } catch (e) { console.warn('Erreur AFB:', e.message); }
  }

  if (process.env.SMMWIZ_API_KEY) {
    try {
      const smmwizData = await callSmmWiz({ action: 'services' });
      if (Array.isArray(smmwizData)) {
        smmwizData.forEach(s => {
          const rate = parseFloat(s.rate) || 0; const providerCost = Math.round(rate * SMMWIZ_USD_TO_XAF);
          const finalPrice = Math.round(providerCost * SMMWIZ_MULTIPLIER); const profit = finalPrice - providerCost;
          allServices.push({ id: s.service, provider: 'SMMWiz', name: s.name, category: s.category || '', providerCost, finalPrice, profit, profitMargin: Math.round((profit / finalPrice) * 100) || 0, min: parseInt(s.min) || 0, max: parseInt(s.max) || 0 });
        });
      }
    } catch (e) { console.warn('Erreur SMMWiz:', e.message); }
  }

  const prices = allServices.map(s => s.finalPrice);
  const minPrice = prices.length ? Math.min(...prices) : 0; const maxPrice = prices.length ? Math.max(...prices) : 0;
  const avgPrice = prices.length ? Math.round(prices.reduce((a, b) => a + b, 0) / prices.length) : 0;

  const byProvider = {};
  allServices.forEach(s => { if (!byProvider[s.provider]) byProvider[s.provider] = []; byProvider[s.provider].push(s); });

  const result = {
    services: allServices,
    stats: {
      total: allServices.length, minPrice, maxPrice, avgPrice,
      byProvider: Object.keys(byProvider).map(p => ({
        provider: p, count: byProvider[p].length, min: Math.min(...byProvider[p].map(s => s.finalPrice)),
        max: Math.max(...byProvider[p].map(s => s.finalPrice)), avg: Math.round(byProvider[p].reduce((sum, s) => sum + s.finalPrice, 0) / byProvider[p].length),
      })),
    },
    multipliers: {
      MTP: MTP_MULTIPLIER,
      EXO: EXO_MULTIPLIER,
      AfriqueBoost: AFB_MULTIPLIER,
      SMMGen: SMMGEN_MULTIPLIER,
      SMMWiz: SMMWIZ_MULTIPLIER,
    },
    rates: {
      MTP_USD_TO_XAF,
      EXO_USD_TO_XAF,
      SMMWIZ_USD_TO_XAF,
      SMMGEN_USD_TO_XAF,
    },
    generatedAt: new Date().toISOString(),
  };
  adminCache.services = result; adminCache.lastFetch.services = Date.now();
  return result;
}

const adminMemoryCache = {
  overview:   { data: null, expires: 0 },
  topUsers:   { data: null, expires: 0 },
  usersStats: { data: null, expires: 0 },
  financialsMap: new Map(),
  orderSummary: { data: null, expires: 0 },
  giftsMap:   new Map(),
};

function memCacheGet(entry) {
  if (entry && entry.data && Date.now() < entry.expires) return entry.data;
  return null;
}
function memCacheSet(entry, data, ttlMs) {
  entry.data = data;
  entry.expires = Date.now() + ttlMs;
  return data;
}

async function getSharedAdminCache(key) {
  try {
    const snap = await db.collection('adminDashboardCache').doc(key).get();
    if (!snap.exists) return null;
    const row = snap.data() || {};
    const expiresAtMs = getTimestampMs(row.expiresAt);
    if (!row.payload || !expiresAtMs || expiresAtMs <= Date.now()) return null;
    return { payload: row.payload, expiresAtMs };
  } catch (error) {
    console.warn('Cache admin partagé indisponible:', error.message);
    return null;
  }
}
async function setSharedAdminCache(key, payload, ttlMs) {
  try {
    await db.collection('adminDashboardCache').doc(key).set({
      payload,
      expiresAt: admin.firestore.Timestamp.fromMillis(Date.now() + ttlMs),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
  } catch (error) {
    console.warn('Écriture cache admin partagé impossible:', error.message);
  }
}
function clearGiftsCache() { adminMemoryCache.giftsMap.clear(); }

const adminRouter = express.Router();

adminRouter.post('/login', (req, res) => {
  res.set('Cache-Control', 'no-store, private');
  if (!ADMIN_PASSWORD || !ADMIN_SESSION_SECRET || ADMIN_SESSION_SECRET.length < 32) {
    return res.status(503).json({ success: false, error: 'Configurez ADMIN_PASSWORD et une ADMIN_SESSION_SECRET d’au moins 32 caractères dans Vercel.' });
  }
  const submitted = req.body && req.body.password;
  if (!constantTimeEqual(submitted, ADMIN_PASSWORD)) {
    return res.status(401).json({ success: false, error: 'Identifiants administrateur incorrects.' });
  }
  const now = Math.floor(Date.now() / 1000);
  const token = signAdminSession({ role: 'admin', iat: now, exp: now + ADMIN_SESSION_TTL_SECONDS });
  return res.json({ success: true, token, expiresAt: new Date((now + ADMIN_SESSION_TTL_SECONDS) * 1000).toISOString() });
});

adminRouter.use(checkAdminPassword);

adminRouter.get('/ping', (req, res) => res.json({ success: true, message: 'Admin API accessible' }));

// Objectifs partagés dans Firestore : ils suivent l'administrateur sur tous
// ses appareils et ne dépendent plus du localStorage d'un navigateur.
const ADMIN_OBJECTIVES_REF = () => db.collection('adminDashboardSettings').doc('sharedObjectives');

adminRouter.get('/objectives', async (req, res) => {
  try {
    const snap = await ADMIN_OBJECTIVES_REF().get();
    const row = snap.exists ? (snap.data() || {}) : {};
    return res.json({ success: true, goal: row.goal || null, updatedAt: row.updatedAt || null });
  } catch (error) {
    console.error('Erreur lecture objectifs administrateur:', error);
    return res.status(500).json({ success: false, error: 'Impossible de récupérer les objectifs enregistrés.' });
  }
});

adminRouter.put('/objectives', async (req, res) => {
  try {
    const input = req.body || {};
    const period = String(input.period || 'custom').trim();
    const startDate = String(input.startDate || '').trim();
    const endDate = String(input.endDate || '').trim();
    const targetsInput = input.targets && typeof input.targets === 'object' ? input.targets : {};
    const allowedPeriods = new Set(['today','tomorrow','next3days','week','month','nextMonth','year','custom']);
    const datePattern = /^\d{4}-\d{2}-\d{2}$/;
    if (!allowedPeriods.has(period) || !datePattern.test(startDate) || !datePattern.test(endDate) || startDate > endDate) {
      return res.status(400).json({ success: false, error: 'La période ou les dates des objectifs sont invalides.' });
    }
    const safeTarget = value => {
      const numeric = Number(value);
      return Number.isFinite(numeric) ? Math.max(0, numeric) : 0;
    };
    const targets = {
      orders: Math.floor(safeTarget(targetsInput.orders)),
      sales: safeTarget(targetsInput.sales),
      profit: safeTarget(targetsInput.profit),
      newUsers: Math.floor(safeTarget(targetsInput.newUsers)),
      visits: Math.floor(safeTarget(targetsInput.visits)),
    };
    if (!Object.values(targets).some(value => value > 0)) {
      return res.status(400).json({ success: false, error: 'Saisissez au moins un objectif supérieur à zéro.' });
    }
    const goal = { version: 1, period, startDate, endDate, targets, updatedAt: new Date().toISOString() };
    await ADMIN_OBJECTIVES_REF().set({ goal, updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
    return res.json({ success: true, goal, message: 'Objectifs enregistrés dans Firestore.' });
  } catch (error) {
    console.error('Erreur sauvegarde objectifs administrateur:', error);
    return res.status(500).json({ success: false, error: 'Impossible d’enregistrer les objectifs dans Firestore.' });
  }
});

adminRouter.delete('/objectives', async (req, res) => {
  try {
    await ADMIN_OBJECTIVES_REF().delete();
    return res.json({ success: true, message: 'Objectifs supprimés.' });
  } catch (error) {
    console.error('Erreur suppression objectifs administrateur:', error);
    return res.status(500).json({ success: false, error: 'Impossible de supprimer les objectifs enregistrés.' });
  }
});

adminRouter.get('/services', async (req, res) => {
  try {
    res.json({ success: true, data: await getServicesData() });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

adminRouter.get('/gifts', async (req, res) => {
  try {
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');

    const status = (req.query.status || 'pending').toLowerCase();
    const limit  = Math.min(Math.max(parseInt(req.query.limit) || 50, 10), 100);
    const validStatuses = ['pending', 'delivered', 'rejected', 'all'];
    const useStatus = validStatuses.includes(status) ? status : 'pending';

    const cacheKey = `${useStatus}:${limit}`;
    const cached = adminMemoryCache.giftsMap.get(cacheKey);
    if (cached && Date.now() < cached.expires) {
      return res.json({ success: true, claims: cached.data, cached: true, ttl: Math.round((cached.expires - Date.now()) / 1000) });
    }

    const giftsDateField = await detectDateField('welcomeGiftClaims');
    let query = db.collection('welcomeGiftClaims').orderBy(giftsDateField, 'desc');
    if (useStatus !== 'all') query = query.where('status', '==', useStatus);
    const snapshot = await query.limit(limit).get();

    const claims = snapshot.docs.map(d => {
      const data = d.data();
      return {
        id: d.id,
        userId: data.userId || null,
        userName: data.userName || null,
        email: data.email || null,
        country: data.country || null,
        giftType: data.giftType || 'inconnu',
        platform: data.platform || null,
        link: data.link || null,
        whatsapp: data.whatsapp || null,
        status: data.status || 'pending',
        adminNote: data.adminNote || null,
        createdAt: data[giftsDateField] || data.createdAt || null,
      };
    });

    const expires = Date.now() + 5 * 60 * 1000;
    adminMemoryCache.giftsMap.set(cacheKey, { data: claims, expires });

    res.json({ success: true, claims, cached: false, reads: claims.length + 1 });
  } catch (error) {
    console.error('Erreur /api/admin/gifts:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

adminRouter.post('/gifts/:id/status', async (req, res) => {
  try {
    const { id } = req.params;
    const { status, note } = req.body || {};

    if (!['pending', 'delivered', 'rejected'].includes(status)) {
      return res.status(400).json({ success: false, error: 'Statut invalide. Attendu : pending, delivered ou rejected.' });
    }

    const ref = db.collection('welcomeGiftClaims').doc(id);
    const doc = await ref.get();
    if (!doc.exists) {
      return res.status(404).json({ success: false, error: 'Demande de cadeau introuvable.' });
    }

    const update = {
      status,
      adminNote: note || null,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedBy: 'admin',
    };
    if (status === 'delivered') update.deliveredAt = admin.firestore.FieldValue.serverTimestamp();

    await ref.update(update);

    clearGiftsCache();

    res.json({ success: true });
  } catch (error) {
    console.error('Erreur /api/admin/gifts/:id/status:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

const ADMIN_ORDER_COLLECTIONS = [
  'autoOrders',
  'commandes',
  'orders',
  'orders_automatique',
  'orders_avancee',
  'orders_standard_revendeur',
];

const PAYMENT_COLLECTIONS = [
  'payments',
  'rechargements',
  'recharges',
  'transactions',
  'fapshiTransactions',
  'paymentTransactions',
];

const allUsersCache = { data: null, expires: 0, lastRefresh: 0 };
const usersCountRangeCache = new Map();
const ALL_USERS_CACHE_TTL_MS = 60 * 60 * 1000;

const topUsersTodayCache = { data: null, expires: 0, lastRefresh: 0, dayKey: null };
// Mutualise aussi les appels simultanés dans une même instance Vercel :
// l'ouverture/actualisation répétée de la page ne relance pas le scan du jour.
const topUsersTodayInFlight = new Map();
const TOP_USERS_TODAY_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

// ✅ FIX #3 : Cache séparé pour les périodes personnalisées du top-users
const topUsersCustomRangeCache = new Map();
const TOP_USERS_CUSTOM_CACHE_TTL_MS = 5 * 60 * 1000;

const depositsCache = { data: null, expires: 0 };
const DEPOSITS_CACHE_TTL_MS = 15 * 60 * 1000;

const ordersCache = { data: null, expires: 0 };
const ORDERS_CACHE_TTL_MS = 15 * 60 * 1000;

const DATE_FIELD_CACHE = {};

// ✅ FIX #4 : detectDateField utilise maintenant KNOWN_DATE_FIELD en priorité
async function detectDateField(collectionName) {
  // Priorité absolue au mapping connu
  if (KNOWN_DATE_FIELD[collectionName]) {
    DATE_FIELD_CACHE[collectionName] = KNOWN_DATE_FIELD[collectionName];
    return KNOWN_DATE_FIELD[collectionName];
  }
  if (DATE_FIELD_CACHE[collectionName] !== undefined) return DATE_FIELD_CACHE[collectionName];
  const candidates = ['createdAt', 'date', 'created_at', 'timestamp', 'dateCreated', 'paidAt'];
  try {
    const sample = await db.collection(collectionName).limit(5).get();
    if (sample.empty) { DATE_FIELD_CACHE[collectionName] = 'createdAt'; return 'createdAt'; }
    const counts = {};
    for (const field of candidates) counts[field] = 0;
    sample.forEach(doc => {
      const data = doc.data() || {};
      for (const field of candidates) {
        if (data[field] !== undefined && data[field] !== null) counts[field]++;
      }
    });
    let bestField = 'createdAt';
    let bestCount = 0;
    for (const field of candidates) {
      if (counts[field] > bestCount) { bestCount = counts[field]; bestField = field; }
    }
    DATE_FIELD_CACHE[collectionName] = bestField;
    return bestField;
  } catch (_) {}
  DATE_FIELD_CACHE[collectionName] = 'createdAt';
  return 'createdAt';
}

// Détecte le type réellement stocké dans le champ date afin d'éviter les
// quatre requêtes redondantes (Timestamp, texte ISO, millisecondes, secondes).
// Plusieurs types sont conservés seulement si l'échantillon confirme des dates mixtes.
const DATE_TYPE_CACHE = new Map();
const DATE_TYPE_TTL_MS = 6 * 60 * 60 * 1000;
function classifyFirestoreDateType(value) {
  if (value && typeof value.toDate === 'function') return 'timestamp';
  if (value instanceof Date) return 'timestamp';
  if (value && typeof value === 'object' && (value.seconds !== undefined || value._seconds !== undefined)) return 'timestamp';
  if (typeof value === 'string') return 'iso';
  if (typeof value === 'number' && Number.isFinite(value)) return value > 0 && value < 100000000000 ? 'seconds' : 'milliseconds';
  return null;
}
function dateTypesFromRows(rows, dateField) {
  const counts = { timestamp: 0, iso: 0, milliseconds: 0, seconds: 0 };
  for (const row of rows) {
    const kind = classifyFirestoreDateType(row?.[dateField]);
    if (kind) counts[kind]++;
  }
  const types = Object.entries(counts).filter(([, count]) => count > 0).sort((a,b) => b[1]-a[1]).map(([type]) => type);
  return types.length ? types : ['timestamp', 'iso'];
}
async function getCollectionDateTypes(collectionName, dateField = null) {
  const field = dateField || await detectDateField(collectionName);
  const key = `${collectionName}|${field}`;
  const cached = DATE_TYPE_CACHE.get(key);
  if (cached && cached.expires > Date.now()) return cached.types;
  const sharedKey = `date-types-v3-${sha256Short(key)}`;
  try {
    const shared = await getSharedAdminCache(sharedKey);
    if (shared?.payload?.types?.length) {
      DATE_TYPE_CACHE.set(key, { types: shared.payload.types, expires: shared.expiresAtMs });
      return shared.payload.types;
    }
  } catch (_) {}
  let types = ['timestamp', 'iso'];
  try {
    const sample = await db.collection(collectionName).limit(20).get();
    if (!sample.empty) {
      const detected = dateTypesFromRows(sample.docs.map(doc => doc.data() || {}), field);
      // Ne pas supposer que les 20 premiers documents représentent tout
      // l'historique : certains documents plus anciens utilisent un autre type.
      types = [...new Set(['timestamp', 'iso', ...detected])];
    }
  } catch (error) {
    console.warn(`[DateTypes] Échantillon indisponible ${collectionName}:`, error.message);
  }
  const expires = Date.now() + DATE_TYPE_TTL_MS;
  DATE_TYPE_CACHE.set(key, { types, expires });
  await setSharedAdminCache(sharedKey, { types }, DATE_TYPE_TTL_MS).catch(() => {});
  console.log(`[DateTypes] ${collectionName}.${field}: ${types.join(',')}`);
  return types;
}
function dateBoundForType(date, type) {
  if (!date) return null;
  if (type === 'timestamp') return admin.firestore.Timestamp.fromDate(date);
  if (type === 'iso') return date.toISOString();
  if (type === 'seconds') return Math.floor(date.getTime() / 1000);
  return date.getTime();
}
function buildDateRangeQueries(ref, dateField, start, end, dateTypes) {
  return (dateTypes?.length ? dateTypes : ['timestamp', 'iso']).map(type => {
    let query = ref;
    if (start) query = query.where(dateField, '>=', dateBoundForType(start, type));
    if (end) query = query.where(dateField, '<', dateBoundForType(end, type));
    return { type, query };
  });
}

const CUSTOMER_INDEX_VERSION = 3;
const CUSTOMER_INDEX_SHARD_SIZE = 250;
const CUSTOMER_INDEX_TTL_MS = 24 * 60 * 60 * 1000;

function compactCustomerIndexRow(doc) {
  const d = doc.data() || {};
  return {
    id: doc.id,
    displayName: d.displayName || null, username: d.username || null, name: d.name || null,
    email: d.email || null, phone: d.phone || null, whatsapp: d.whatsapp || null,
    country: d.country || d.countryCode || d.country_code || null,
    balance: Number(d.balance || 0),
    totalOrders: Number(d.totalOrders || 0), totalSpent: Number(d.totalSpent || 0), totalProfit: Number(d.totalProfit || 0),
    adminOrderCount: Number(d.adminOrderCount || 0), adminTotalSpent: Number(d.adminTotalSpent || 0),
    adminTotalProfit: Number(d.adminTotalProfit || 0), adminOrderMetricsVersion: Number(d.adminOrderMetricsVersion || 0),
    adminLastOrderAt: d.adminLastOrderAt || null,
    adminLastOrderAtMs: Number(d.adminLastOrderAtMs || 0),
    createdAt: d.createdAt || null, created_at: d.created_at || null,
    dateCreated: d.dateCreated || null, timestamp: d.timestamp || null,
    lastSignIn: d.lastSignIn || null, lastLoginAt: d.lastLoginAt || null,
    lastActivityAt: d.lastActivityAt || null, lastSeenAt: d.lastSeenAt || null,
    lastDashboardVisit: d.lastDashboardVisit || null,
    resellerLevel: d.resellerLevel || null,
    _createdAtMs: getTimestampMs(d.createdAt || d.created_at || d.dateCreated || d.timestamp),
  };
}

async function getAllUsersSorted(forceRefresh = false) {
  const now = Date.now();
  if (!forceRefresh && allUsersCache.data && now < allUsersCache.expires) return allUsersCache.data;

  // Cache partagé en petits documents afin de rester sous la limite Firestore
  // de taille d'un document et d'éviter 3 500 lectures sur chaque instance Vercel.
  if (!forceRefresh) {
    try {
      const meta = await getSharedAdminCache('customer-index-v3-meta');
      const manifest = meta?.payload;
      if (manifest && manifest.version === CUSTOMER_INDEX_VERSION && Array.isArray(manifest.shards)) {
        const chunks = await Promise.all(manifest.shards.map(key => getSharedAdminCache(key)));
        if (chunks.every(Boolean)) {
          const sharedRows = chunks.flatMap(x => Array.isArray(x.payload) ? x.payload : []);
          if (sharedRows.length === Number(manifest.count || 0)) {
            sharedRows.sort((a, b) => Number(b._createdAtMs || 0) - Number(a._createdAtMs || 0));
            allUsersCache.data = sharedRows;
            allUsersCache.expires = Math.min(meta.expiresAtMs, ...chunks.map(x => x.expiresAtMs));
            allUsersCache.lastRefresh = now;
            return sharedRows;
          }
        }
      }
    } catch (e) { console.warn('[Cache] Index utilisateurs partagé indisponible:', e.message); }
  }

  const allUsers = [];
  let last = null;
  while (true) {
    let q = db.collection('users').orderBy(admin.firestore.FieldPath.documentId()).limit(500);
    if (last) q = q.startAfter(last);
    const page = await q.get();
    if (page.empty) break;
    page.docs.forEach(doc => allUsers.push(compactCustomerIndexRow(doc)));
    last = page.docs[page.docs.length - 1];
    if (page.size < 500) break;
  }
  allUsers.sort((a, b) => b._createdAtMs - a._createdAtMs);
  allUsersCache.data = allUsers;
  allUsersCache.expires = now + CUSTOMER_INDEX_TTL_MS;
  allUsersCache.lastRefresh = now;

  const shardKeys = [];
  for (let i = 0; i < allUsers.length; i += CUSTOMER_INDEX_SHARD_SIZE) {
    const key = `customer-index-v${CUSTOMER_INDEX_VERSION}-part-${String(i / CUSTOMER_INDEX_SHARD_SIZE).padStart(3, '0')}`;
    shardKeys.push(key);
    await setSharedAdminCache(key, allUsers.slice(i, i + CUSTOMER_INDEX_SHARD_SIZE), CUSTOMER_INDEX_TTL_MS);
  }
  await setSharedAdminCache('customer-index-v3-meta', {
    version: CUSTOMER_INDEX_VERSION, count: allUsers.length, shards: shardKeys,
    generatedAt: new Date().toISOString(),
  }, CUSTOMER_INDEX_TTL_MS);
  console.log(`[Cache] ${allUsers.length} profils chargés puis index partagé (${shardKeys.length} fragments, TTL ${Math.round(CUSTOMER_INDEX_TTL_MS / 60000)} min)`);
  return allUsers;
}

async function countUsersInWindow(start, end) {
  try {
    const ref = db.collection('users');
    const dateTypes = await getCollectionDateTypes('users', 'createdAt');
    const modes = buildDateRangeQueries(ref, 'createdAt', start, end, dateTypes);
    const counts = await Promise.all(modes.map(({ query }) => query.count().get().catch(() => null)));
    return counts.reduce((sum, snap) => sum + Number(snap?.data()?.count || 0), 0);
  } catch (_) { return 0; }
}

async function countOrdersInWindow(collectionName, start, end) {
  if (!start && !end) {
    try {
      const r = await db.collection(collectionName).count().get();
      return Number(r.data().count || 0);
    } catch (_) { return 0; }
  }
  const dateField = await detectDateField(collectionName);
  const ref = db.collection(collectionName);
  try {
    const dateTypes = await getCollectionDateTypes(collectionName, dateField);
    const modes = buildDateRangeQueries(ref, dateField, start, end, dateTypes);
    const counts = await Promise.all(modes.map(({ query }) => query.count().get().catch(() => null)));
    return counts.reduce((sum, snap) => sum + Number(snap?.data()?.count || 0), 0);
  } catch (_) { return 0; }
}

// Détection légère des champs financiers par collection. Un échantillon de 20 documents
// est mis en cache 24 h; les requêtes suivantes n'agrègent que les champs utiles.
const FINANCIAL_SCHEMA_CACHE = new Map();
const FINANCIAL_SCHEMA_TTL_MS = 24 * 60 * 60 * 1000;
async function getFinancialFieldSchema(collectionName) {
  const cached = FINANCIAL_SCHEMA_CACHE.get(collectionName);
  if (cached && cached.expires > Date.now()) return cached.schema;
  const sharedKey = `financial-schema-${collectionName}-v2`;
  const shared = await getSharedAdminCache(sharedKey);
  if (shared?.payload) {
    FINANCIAL_SCHEMA_CACHE.set(collectionName, { schema: shared.payload, expires: shared.expiresAtMs });
    return shared.payload;
  }
  const sample = await db.collection(collectionName).limit(20).get();
  const rows = sample.docs.map(doc => doc.data() || {});
  const choose = candidates => {
    let best = null, bestCount = 0;
    for (const key of candidates) {
      const count = rows.reduce((n, row) => n + (row[key] !== undefined && row[key] !== null && row[key] !== '' && Number.isFinite(Number(row[key])) ? 1 : 0), 0);
      if (count > bestCount) { best = key; bestCount = count; }
    }
    return best;
  };
  const defaults = {
    autoOrders: { sales: 'priceXAF', supplierCost: 'providerCostXAF', profit: 'estimatedProfitXAF', refunds: 'refundedAmount' },
    commandes: { sales: 'totalCost', supplierCost: 'providerCostXAF', profit: 'estimatedProfitXAF', refunds: 'refundAmount' },
    orders: { sales: 'amount', supplierCost: 'supplierCostXAF', profit: 'estimatedProfitXAF', refunds: 'refundedAmount' },
    orders_automatique: { sales: 'amount', supplierCost: 'supplierCostXAF', profit: 'estimatedProfitXAF', refunds: 'refundedAmount' },
    orders_avancee: { sales: 'amount', supplierCost: 'supplierCostXAF', profit: 'estimatedProfitXAF', refunds: 'refundedAmount' },
    orders_standard_revendeur: { sales: 'amount', supplierCost: 'supplierCostXAF', profit: 'estimatedProfitXAF', refunds: 'refundedAmount' },
  };
  const fallback = defaults[collectionName] || defaults.orders;
  const dateField = await detectDateField(collectionName);
  const schema = {
    sales: choose(['priceXAF','chargedAmountXAF','paidAmountXAF','amountXAF','finalPriceXAF','orderPriceXAF','totalPriceXAF','totalAmountXAF','totalCost','finalCost','cost','amount','totalAmount','total']) || fallback.sales,
    supplierCost: choose(['providerCostXAF','supplierCostXAF','provider_cost_xaf','supplier_cost_xaf']) || fallback.supplierCost,
    profit: choose(['estimatedProfitXAF']) || fallback.profit,
    refunds: choose(['refundedAmount','refundAmount']) || fallback.refunds,
    dateTypes: dateTypesFromRows(rows, dateField),
  };
  FINANCIAL_SCHEMA_CACHE.set(collectionName, { schema, expires: Date.now() + FINANCIAL_SCHEMA_TTL_MS });
  await setSharedAdminCache(sharedKey, schema, FINANCIAL_SCHEMA_TTL_MS);
  console.log(`[Fin] Schéma agrégé ${collectionName}:`, schema);
  return schema;
}

// ✅ FIX #5 : getFinancialsForCollection avec fallback intelligent
// - Ajout de refundAmount (pour EXO)
// - Fallback mémoire si profit=0 & cost=0 & sales>0 (indique champs manquants EXO)
async function getFinancialsForCollection(colName, start, end) {
  const dateField = await detectDateField(colName);
  const ref = db.collection(colName);
  const queries = [];

  if (!start && !end) {
    queries.push(ref);
  } else {
    // Une même collection peut contenir des dates Firestore Timestamp et des
    // dates ISO historiques. On garde les deux formats connus, plus les types
    // numériques réellement détectés, pour ne pas ignorer des commandes.
    const detectedTypes = await getCollectionDateTypes(colName, dateField);
    const types = [...new Set(['timestamp', 'iso', ...(detectedTypes || []).filter(t => t === 'seconds' || t === 'milliseconds')])];
    queries.push(...buildDateRangeQueries(ref, dateField, start, end, types).map(x => x.query));
  }

  const result = { ordersCount: 0, sales: 0, supplierCost: 0, grossProfit: 0, refunds: 0 };
  let aggregationSucceeded = true;

  // Une seule agrégation par type de date rassemble le nombre de commandes,
  // les variantes historiques de ventes, les coûts, les marges et les retours.
  const fields = {
    ordersCount: admin.firestore.AggregateField.count(),
    a: admin.firestore.AggregateField.sum('priceXAF'),
    b: admin.firestore.AggregateField.sum('totalCost'),
    c: admin.firestore.AggregateField.sum('finalCost'),
    d: admin.firestore.AggregateField.sum('cost'),
    e: admin.firestore.AggregateField.sum('amount'),
    f: admin.firestore.AggregateField.sum('providerCostXAF'),
    g: admin.firestore.AggregateField.sum('supplierCostXAF'),
    h: admin.firestore.AggregateField.sum('estimatedProfitXAF'),
    i: admin.firestore.AggregateField.sum('refundedAmount'),
    j: admin.firestore.AggregateField.sum('refundAmount'),
  };

  for (const query of queries) {
    try {
      const snap = await query.aggregate(fields).get();
      const d = snap.data() || {};
      result.ordersCount += Number(d.ordersCount || 0);
      result.sales += Math.max(
        Number(d.a || 0), Number(d.b || 0), Number(d.c || 0),
        Number(d.d || 0), Number(d.e || 0)
      );
      result.supplierCost += Math.max(Number(d.f || 0), Number(d.g || 0));
      result.grossProfit += Number(d.h || 0);
      result.refunds += Math.max(Number(d.i || 0), Number(d.j || 0));
    } catch (error) {
      aggregationSucceeded = false;
      console.warn(`[Fin] Agrégation indisponible pour ${colName}; calcul de secours requis:`, error.message);
      break;
    }
  }

  // Même règle que l'ancienne version fonctionnelle : lorsqu'une collection
  // possède des ventes mais aucun coût/marge exploitable, recalculer les lignes
  // avec les champs et multiplicateurs propres au fournisseur.
  const needsFallback = !aggregationSucceeded ||
    (result.sales > 0 && result.grossProfit === 0 && result.supplierCost === 0);

  if (needsFallback) {
    let memSales = 0, memCost = 0, memProfit = 0, memRefunds = 0, memOrders = 0;
    for (const query of queries) {
      try {
        const orderField = (!start && !end) ? admin.firestore.FieldPath.documentId() : dateField;
        let lastDoc = null;
        while (true) {
          let pageQuery = query.orderBy(orderField).limit(500);
          if (lastDoc) pageQuery = pageQuery.startAfter(lastDoc);
          const page = await pageQuery.get();
          if (page.empty) break;
          page.forEach(doc => {
            const data = doc.data() || {};
            const amount = getOrderAmountXAF(data, colName);
            const fin = getOrderFinancials(data, null, colName);
            memOrders++;
            memSales += amount || 0;
            memCost += fin.providerCostXAF || 0;
            memProfit += fin.grossProfitXAF || 0;
            memRefunds += fin.refundedAmount || 0;
          });
          lastDoc = page.docs[page.docs.length - 1];
          if (page.size < 500) break;
        }
      } catch (error) {
        console.warn(`[Fin] Lecture de secours échouée pour ${colName}:`, error.message);
      }
    }
    result.ordersCount = memOrders || result.ordersCount;
    result.sales = memSales;
    result.supplierCost = memCost;
    result.grossProfit = memProfit;
    result.refunds = memRefunds;
    console.log(`[Fin] Secours ${colName}: commandes=${result.ordersCount}, ventes=${memSales}, coût=${memCost}, marge=${memProfit}, remboursements=${memRefunds}`);
  }

  return result;
}

async function getFinancialsAllCollections(start, end) {
  let totalSales = 0, totalRefunds = 0, totalSupplierCost = 0, totalProfit = 0, totalOrders = 0;
  const aggregationUnavailableCollections = [];
  const costUnavailableCollections = [];

  for (const colName of ADMIN_ORDER_COLLECTIONS) {
    try {
      const r = await getFinancialsForCollection(colName, start, end);
      totalSales += r.sales;
      totalRefunds += r.refunds;
      totalSupplierCost += r.supplierCost;
      totalProfit += r.grossProfit;
      totalOrders += r.ordersCount;
      if (r.aggregationUnavailable) aggregationUnavailableCollections.push(colName);
      if (r.costUnavailable) costUnavailableCollections.push(colName);
    } catch (e) {
      console.warn(`Financials ${colName}:`, e.message);
    }
  }

  return {
    totalOrders,
    totalSales,
    totalRefunds,
    totalSupplierCost,
    totalProfit,
    netSales: Math.max(0, totalSales - totalRefunds),
    aggregationUnavailableCollections,
    costUnavailableCollections,
  };
}

// Cache mémoire partagé par les routes financières et la vue d'ensemble.
// Une même plage sélectionnée ne relance pas les agrégations Firestore.
const financialRangeAggregateCache = new Map();
const overviewRangeResponseCache = new Map();
const OVERVIEW_RANGE_INFLIGHT = new Map();
const CUSTOM_RANGE_CACHE_TTL_MS = 60 * 60 * 1000;
const FINANCIAL_AGGREGATE_INFLIGHT = new Map();

async function getCachedFinancialAggregate(start, end, forceRefresh = false) {
  const key = `${start ? start.toISOString() : 'open'}|${end ? end.toISOString() : 'open'}`;
  const cacheKey = `financial-aggregate-v4-${sha256Short(key)}`;
  const cached = financialRangeAggregateCache.get(key);
  if (!forceRefresh && cached && Date.now() < cached.expires) return cached.data;
  if (!forceRefresh) {
    const shared = await getSharedAdminCache(cacheKey);
    if (shared) {
      const ttl = Math.max(1000, shared.expiresAtMs - Date.now());
      financialRangeAggregateCache.set(key, { data: shared.payload, expires: Date.now() + ttl });
      return shared.payload;
    }
  }
  if (!forceRefresh && FINANCIAL_AGGREGATE_INFLIGHT.has(key)) return FINANCIAL_AGGREGATE_INFLIGHT.get(key);
  const pending = (async () => {
    const data = await getFinancialsAllCollections(start, end);
    const expiresAt = Date.now() + CUSTOM_RANGE_CACHE_TTL_MS;
    financialRangeAggregateCache.set(key, { data, expires: expiresAt });
    await setSharedAdminCache(cacheKey, data, CUSTOM_RANGE_CACHE_TTL_MS);
    return data;
  })();
  FINANCIAL_AGGREGATE_INFLIGHT.set(key, pending);
  try { return await pending; }
  finally { FINANCIAL_AGGREGATE_INFLIGHT.delete(key); }
}

async function countDepositsAllCollections(start, end) {
  let total = 0;
  for (const colName of PAYMENT_COLLECTIONS) {
    try { total += await countOrdersInWindow(colName, start, end); } catch (_) {}
  }
  return total;
}

const depositsStatsCache = new Map();

async function recordDailyDepositCredit(userId, amountXAF, provider, transactionId, balanceBefore = null, balanceAfter = null, eventDate = new Date()) {
  const uid = String(userId || '').trim();
  const amount = Number(amountXAF || 0);
  if (!uid || !Number.isFinite(amount) || amount <= 0) return;
  const dateKey = localDateKey(new Date(getTimestampMs(eventDate) || Date.now()));
  const userKey = `${dateKey}_${sha256Short(uid)}`;
  const userDayRef = db.collection('adminDailyDepositUsers').doc(userKey);
  const dayRef = db.collection('dailyDepositSummaries').doc(dateKey);
  let updatedUserTotal = amount;
  let updatedUserCount = 1;

  await db.runTransaction(async tx => {
    const [userDaySnap, daySnap] = await Promise.all([tx.get(userDayRef), tx.get(dayRef)]);
    const prior = userDaySnap.exists ? (userDaySnap.data() || {}) : {};
    updatedUserTotal = Number(prior.amountXAF || 0) + amount;
    updatedUserCount = Number(prior.count || 0) + 1;
    const day = daySnap.exists ? (daySnap.data() || {}) : {};
    const existingTop = day.topDepositor || null;
    const candidate = { userId: uid, amount: updatedUserTotal, count: updatedUserCount, lastAt: new Date().toISOString() };
    const topDepositor = !existingTop || updatedUserTotal > Number(existingTop.amount || 0) ? candidate : existingTop;

    tx.set(userDayRef, {
      userId: uid, dateKey, amountXAF: updatedUserTotal, count: updatedUserCount,
      lastAt: admin.firestore.FieldValue.serverTimestamp(), provider: String(provider || 'Inconnu'),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });
    tx.set(dayRef, {
      dateKey, topDepositor,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });
  });

  await upsertDepositOperationLog({
    type: 'deposit_credit', action: 'Recharge créditée', userId: uid,
    amountXAF: amount, provider, transactionId, status: 'CONFIRMED',
    balanceBefore, balanceAfter, source: 'system',
  });
  depositsStatsCache.clear();
}

const PAYMENT_SCHEMA_CACHE = new Map();
const PAYMENT_SCHEMA_TTL_MS = 24 * 60 * 60 * 1000;
async function getPaymentFieldSchema(collectionName) {
  const cached = PAYMENT_SCHEMA_CACHE.get(collectionName);
  if (cached && cached.expires > Date.now()) return cached.schema;
  const sharedKey = `payment-schema-${collectionName}-v3`;
  const shared = await getSharedAdminCache(sharedKey);
  if (shared?.payload) {
    PAYMENT_SCHEMA_CACHE.set(collectionName, { schema: shared.payload, expires: shared.expiresAtMs });
    return shared.payload;
  }
  const dateField = await detectDateField(collectionName);
  const sample = await db.collection(collectionName).limit(20).get();
  const rows = sample.docs.map(doc => doc.data() || {});
  // Choisir d'abord les champs réellement crédités selon le schéma de chaque
  // fournisseur. Ne jamais préférer requestedAmount au montant crédité juste
  // parce qu'il est plus souvent renseigné.
  const preferredKeysByCollection = {
    paymentTransactions: ['creditedAmountXAF', 'amountXAF'],
    fapshiTransactions: ['creditedAmountXAF', 'amountConfirmed', 'creditedAmount', 'amountCreditedXAF'],
    payments: ['creditedAmountXAF', 'amountXAF', 'amountCredited'],
    rechargements: ['creditedAmountXAF', 'amountXAF', 'amountCredited'],
    recharges: ['creditedAmountXAF', 'amountXAF', 'amountCredited'],
    transactions: ['amountXAF', 'creditedAmountXAF', 'amountCredited'],
  };
  const keys = [...(preferredKeysByCollection[collectionName] || []), 'amount', 'total', 'montant'];
  let best = null, bestCount = 0;
  for (const key of keys) {
    const count = rows.reduce((n, row) => n + (row[key] !== undefined && row[key] !== null && row[key] !== '' && Number.isFinite(Number(row[key])) ? 1 : 0), 0);
    if (count > bestCount) { best = key; bestCount = count; }
  }
  const schema = { amountField: best || 'amount', dateTypes: dateTypesFromRows(rows, dateField) };
  PAYMENT_SCHEMA_CACHE.set(collectionName, { schema, expires: Date.now() + PAYMENT_SCHEMA_TTL_MS });
  await setSharedAdminCache(sharedKey, schema, PAYMENT_SCHEMA_TTL_MS);
  return schema;
}

async function getDepositsStatsAllCollections(start, end) {
  const cacheKey = `${start ? localDateKey(start) : 'all'}|${end ? localDateKey(new Date(end.getTime() - 1)) : 'all'}`;
  const cached = depositsStatsCache.get(cacheKey);
  if (cached && Date.now() < cached.expires) return cached.data;
  const sharedKey = `deposit-aggregate-v2-${sha256Short(cacheKey)}`;
  const shared = await getSharedAdminCache(sharedKey);
  if (shared) {
    depositsStatsCache.set(cacheKey, { data: shared.payload, expires: shared.expiresAtMs });
    return shared.payload;
  }

  let total = 0, success = 0, pending = 0, failed = 0, totalCreditedXAF = 0;
  const successVariants = ['CONFIRMED','confirmed','SUCCESS','success','SUCCEEDED','succeeded','PAID','paid','SUCCESSFUL','successful','completed','COMPLETED'];
  const pendingVariants = ['PENDING','pending','PROCESSING','processing','INITIATED','initiated','WAITING','waiting'];
  const failedVariants = ['FAILED','failed','FAILURE','failure','CANCELLED','cancelled','REJECTED','rejected','EXPIRED','expired'];

  for (const colName of PAYMENT_COLLECTIONS) {
    const dateField = await detectDateField(colName);
    const schema = await getPaymentFieldSchema(colName);
    const ref = db.collection(colName);
    const baseQueries = (!start && !end)
      ? [{ query: ref }]
      : buildDateRangeQueries(ref, dateField, start, end, schema.dateTypes);

    for (const { query: baseQuery } of baseQueries) {
      try {
        const amountAgg = schema.amountField
          ? { count: admin.firestore.AggregateField.count(), credited: admin.firestore.AggregateField.sum(schema.amountField) }
          : { count: admin.firestore.AggregateField.count() };
        const [allAgg, successAgg, pendingAgg, failedAgg] = await Promise.all([
          baseQuery.aggregate({ count: admin.firestore.AggregateField.count() }).get(),
          baseQuery.where('status', 'in', successVariants).aggregate(amountAgg).get(),
          baseQuery.where('status', 'in', pendingVariants).aggregate({ count: admin.firestore.AggregateField.count() }).get(),
          baseQuery.where('status', 'in', failedVariants).aggregate({ count: admin.firestore.AggregateField.count() }).get(),
        ]);
        total += Number(allAgg.data()?.count || 0);
        success += Number(successAgg.data()?.count || 0);
        pending += Number(pendingAgg.data()?.count || 0);
        failed += Number(failedAgg.data()?.count || 0);
        totalCreditedXAF += Number(successAgg.data()?.credited || 0);
      } catch (error) {
        console.warn(`[DepositsStats] Agrégation indisponible pour ${colName}:`, error.message);
      }
    }
  }

  // Le meilleur déposant est lu depuis le récapitulatif quotidien construit
  // pendant la confirmation du paiement : aucun téléchargement de transactions.
  let topDepositor = null;
  if (start) {
    const dateKey = localDateKey(start);
    try {
      const summarySnap = await db.collection('dailyDepositSummaries').doc(dateKey).get();
      const top = summarySnap.exists ? (summarySnap.data()?.topDepositor || null) : null;
      if (top?.userId) {
        const userSnap = await db.collection('users').doc(String(top.userId)).get();
        const user = userSnap.exists ? (userSnap.data() || {}) : {};
        topDepositor = {
          userId: top.userId,
          name: user.displayName || user.username || user.name || 'Anonyme',
          email: user.email || null, phone: user.phone || user.whatsapp || null,
          country: user.country || null,
          amount: Number(top.amount || 0), count: Number(top.count || 0), lastAt: top.lastAt || null,
        };
      }
    } catch (error) { console.warn('[DepositsStats] Résumé quotidien indisponible:', error.message); }
  }

  const data = { total, success, pending, failed, totalCreditedXAF, topDepositor, topDepositorIndexed: Boolean(topDepositor) };
  depositsStatsCache.set(cacheKey, { data, expires: Date.now() + 30 * 60 * 1000 });
  await setSharedAdminCache(sharedKey, data, 30 * 60 * 1000);
  return data;
}

async function getTopUsersToday(forceRefresh = false) {
  const now = new Date();
  const local = new Date(now.getTime() + 60 * 60 * 1000);
  const todayStart = new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate()) - 60 * 60 * 1000);
  const tomorrowStart = new Date(todayStart.getTime() + 24 * 60 * 60 * 1000);
  const dayKey = localDateKey(todayStart);
  const sharedKey = `top-users-today-v2-${dayKey}`;

  // Un seul parcours du jour par date. Le paramètre refresh du navigateur
  // ne contourne volontairement pas ce verrou quotidien.
  if (topUsersTodayCache.data && topUsersTodayCache.dayKey === dayKey && Date.now() < topUsersTodayCache.expires) {
    return topUsersTodayCache.data;
  }

  const alreadyRunning = topUsersTodayInFlight.get(dayKey);
  if (alreadyRunning) return alreadyRunning;

  const computation = (async () => {
    const cached = await getSharedAdminCache(sharedKey);
    if (cached && Array.isArray(cached.payload)) {
      topUsersTodayCache.data = cached.payload;
      topUsersTodayCache.dayKey = dayKey;
      topUsersTodayCache.expires = cached.expiresAtMs;
      return cached.payload;
    }

    // Verrou Firestore commun à toutes les instances Vercel : deux instances
    // démarrées en parallèle ne peuvent pas scanner les commandes du jour
    // chacune de leur côté.
    const dailyLockRef = db.collection('adminDashboardSettings').doc(`topUsersDailySnapshot-${dayKey}`);
    let ownsLock = false;
    await db.runTransaction(async tx => {
      const lockSnap = await tx.get(dailyLockRef);
      if (lockSnap.exists) return;
      tx.create(dailyLockRef, {
        dayKey,
        status: 'running',
        startedAt: admin.firestore.FieldValue.serverTimestamp(),
        startedAtMs: Date.now(),
      });
      ownsLock = true;
    });

    if (!ownsLock) {
      // Une autre instance est responsable du calcul. On attend brièvement
      // son résultat partagé, sans démarrer un second parcours coûteux.
      for (let attempt = 0; attempt < 8; attempt++) {
        await new Promise(resolve => setTimeout(resolve, 500));
        const ready = await getSharedAdminCache(sharedKey);
        if (ready && Array.isArray(ready.payload)) {
          topUsersTodayCache.data = ready.payload;
          topUsersTodayCache.dayKey = dayKey;
          topUsersTodayCache.expires = ready.expiresAtMs;
          return ready.payload;
        }
      }
      console.warn(`[TopUsers] Le snapshot du ${dayKey} est encore en cours dans une autre instance.`);
      return [];
    }

    try {
      const result = await computeTopUsersInRange(todayStart, now);
      const ttl = Math.max(60 * 1000, tomorrowStart.getTime() - Date.now());
      await setSharedAdminCache(sharedKey, result, ttl);
      await dailyLockRef.set({ status: 'completed', completedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
      topUsersTodayCache.data = result;
      topUsersTodayCache.dayKey = dayKey;
      topUsersTodayCache.expires = Date.now() + ttl;
      topUsersTodayCache.lastRefresh = Date.now();
      return result;
    } catch (error) {
      await dailyLockRef.set({ status: 'failed', failedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true }).catch(() => {});
      throw error;
    }
  })();

  topUsersTodayInFlight.set(dayKey, computation);
  try {
    return await computation;
  } finally {
    topUsersTodayInFlight.delete(dayKey);
  }
}
async function getTopUsersInRange(dateStart, dateEnd, forceRefresh = false) {
  const now = Date.now();
  const cacheEnd = dateEnd ? Math.floor(dateEnd.getTime() / (5 * 60 * 1000)) * (5 * 60 * 1000) : 'x';
  const cacheKey = `${dateStart?.getTime() || 'x'}_${cacheEnd}`;
  const sharedKey = `top-users-range-v3-${sha256Short(cacheKey)}`;
  const cached = topUsersCustomRangeCache.get(cacheKey);
  if (!forceRefresh && cached && now < cached.expires) return cached.data;
  if (!forceRefresh) {
    const shared = await getSharedAdminCache(sharedKey);
    if (shared && Array.isArray(shared.payload)) {
      topUsersCustomRangeCache.set(cacheKey, { data: shared.payload, expires: shared.expiresAtMs });
      return shared.payload;
    }
  }
  const result = await computeTopUsersInRange(dateStart, dateEnd);
  topUsersCustomRangeCache.set(cacheKey, { data: result, expires: now + 60 * 60 * 1000 });
  await setSharedAdminCache(sharedKey, result, 60 * 60 * 1000);
  return result;
}

// Les périodes courtes sont parcourues avec pagination Firestore, sans limite
// arbitraire de 1 000 commandes. Les mêmes statuts/champs financiers que la
// fiche client sont appliqués : attente incluse, annulation/rejet exclus.
async function computeTopUsersInRange(start, end) {
  const userAgg = new Map();

  for (const colName of ADMIN_ORDER_COLLECTIONS) {
    const ref = db.collection(colName);
    try {
      const dateField = await detectDateField(colName);
      const dateTypes = await getCollectionDateTypes(colName, dateField);
      const rangeModes = buildDateRangeQueries(ref, dateField, start, end, dateTypes)
        .map(item => ({ label: item.type, query: item.query }));
      const seenDocIds = new Set();

      for (const mode of rangeModes) {
        let lastDoc = null;
        while (true) {
          let q = mode.query.orderBy(dateField, 'desc').limit(500);
          if (lastDoc) q = q.startAfter(lastDoc);

          let snap;
          try {
            snap = await q.get();
          } catch (queryError) {
            // Une collection peut contenir des dates de types différents.
            // L'échec d'un format ne doit pas empêcher la lecture des autres.
            console.warn(`[TopUsers] ${colName} (${mode.label}) :`, queryError.message);
            break;
          }
          if (snap.empty) break;

          snap.forEach(doc => {
            if (seenDocIds.has(doc.id)) return;
            seenDocIds.add(doc.id);
            const order = doc.data() || {};
            const ownerIds = getCustomerOrderOwnerIds(order);
            if (!ownerIds.length) return;
            const contribution = getCustomerOrderContribution(order, colName);
            if (!contribution.included) return;

            const createdAt = order[dateField] || order.createdAt || order.created_at || order.date || null;
            let createdAtMs = getTimestampMs(createdAt);
            if (typeof createdAt === 'number' && createdAt > 0 && createdAt < 100000000000) {
              createdAtMs = createdAt * 1000;
            }
            // Garde-fou sur la plage réelle, indépendamment du type Firestore.
            if (start && createdAtMs && createdAtMs < start.getTime()) return;
            if (end && createdAtMs && createdAtMs >= end.getTime()) return;

            ownerIds.forEach(uid => {
              const cur = userAgg.get(uid) || { count: 0, totalPaid: 0, totalProfit: 0, orders: [], lastOrderAt: null };
              cur.count++;
              if (contribution.amount !== null) cur.totalPaid += Number(contribution.amount || 0);
              if (contribution.profit !== null) cur.totalProfit += contribution.profit;
              if (!cur.lastOrderAt || createdAtMs > getTimestampMs(cur.lastOrderAt)) cur.lastOrderAt = createdAt;
              if (cur.orders.length < 10) {
                cur.orders.push({
                  orderId: order.orderId || order.reference || order.order_id || doc.id,
                  serviceName: order.serviceName || order.service_name || order.name || 'Service',
                  provider: contribution.financials?.provider || null,
                  amount: contribution.amount,
                  profit: contribution.profit,
                  status: order.status || order.orderStatus || order.state || 'Inconnu',
                  createdAt,
                });
              }
              userAgg.set(uid, cur);
            });
          });

          lastDoc = snap.docs[snap.docs.length - 1];
          if (snap.size < 500) break;
        }
      }
    } catch (e) {
      console.warn(`TopUsers computeTopUsersInRange ${colName}:`, e.message);
    }
  }

  const ranked = [...userAgg.entries()].map(([id, stats]) => ({ id, ...stats }))
    .sort((a, b) => (b.count - a.count) || (b.totalPaid - a.totalPaid) || (b.totalProfit - a.totalProfit));
  const topRows = ranked.slice(0, 20);
  const userSnaps = await Promise.all(topRows.map(row => db.collection('users').doc(row.id).get()));
  const usersMap = new Map();
  userSnaps.forEach(s => {
    if (s.exists) {
      const u = s.data() || {};
      usersMap.set(s.id, {
        name: u.displayName || u.username || u.name || 'Client',
        email: u.email || null,
        phone: u.phone || u.whatsapp || null,
        country: u.country || null,
        balance: Number(u.balance || 0),
        createdAt: u.createdAt || u.created_at || null,
        lastActivityAt: u.lastActivityAt || u.lastSeenAt || u.lastDashboardVisit || u.lastSignIn || u.lastLoginAt || null,
      });
    }
  });

  return topRows.map(row => {
    const u = usersMap.get(row.id) || {};
    return {
      id: row.id,
      name: u.name || 'Client',
      email: u.email || null,
      phone: u.phone || null,
      country: u.country || null,
      balance: Number(u.balance || 0),
      createdAt: u.createdAt || null,
      lastActivityAt: u.lastActivityAt || null,
      orderCount: row.count,
      totalOrders: row.count,
      periodOrderCount: row.count,
      totalSpent: Math.round(row.totalPaid),
      totalPaid: Math.round(row.totalPaid),
      totalProfit: Math.round(row.totalProfit),
      lastOrderAt: row.lastOrderAt || null,
      orders: row.orders,
    };
  });
}

async function readOrderCounters() {
  const snapshots = await Promise.all(ADMIN_ORDER_COLLECTIONS.map(name => db.collection(name).count().get().catch(() => ({ data: () => ({ count: 0 }) }))));
  const counts = {}; let total = 0;
  snapshots.forEach((snap, index) => { const n = Number(snap.data()?.count || 0); counts[ADMIN_ORDER_COLLECTIONS[index]] = n; total += n; });
  return { total, counts };
}

const ADMIN_COUNTRY_CODES = 'AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF TG TH TJ TK TL TM TN TO TR TT TV TW TZ UA UG UM US UY UZ VA VC VE VG VI VN VU WF WS YE YT ZA ZM ZW'.split(/\s+/);
function getCountryAliases(value) {
  const raw = String(value || '').trim(); if (!raw) return [];
  let code = /^[a-z]{2}$/i.test(raw) ? raw.toUpperCase() : '';
  const fr = new Intl.DisplayNames(['fr'], { type: 'region' });
  const en = new Intl.DisplayNames(['en'], { type: 'region' });
  if (!code) {
    const target = raw.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
    code = ADMIN_COUNTRY_CODES.find(c => [fr.of(c), en.of(c), c].some(n => String(n || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase() === target)) || '';
  }
  if (!code) return [...new Set([raw, raw.toLowerCase(), raw.toUpperCase()])].slice(0, 10);
  return [...new Set([code, code.toLowerCase(), fr.of(code), String(fr.of(code) || '').toLowerCase(), en.of(code), String(en.of(code) || '').toLowerCase()])].filter(Boolean).slice(0, 10);
}

function getOrderAmountXAF(d = {}, collectionName = '') {
  const keys = ['priceXAF','chargedAmountXAF','paidAmountXAF','amountXAF','finalPriceXAF','orderPriceXAF','totalPriceXAF','totalAmountXAF'];
  if (collectionName === 'commandes') keys.push('totalCost','finalCost','cost');
  keys.push('amount','totalAmount','total');
  let explicitZero = false;
  for (const key of keys) {
    const value=d[key]; if(value===undefined||value===null||value===''||!Number.isFinite(Number(value)))continue;
    const n=Math.max(0,Number(value)); if(n>0)return n; explicitZero=true;
  }
  return explicitZero ? 0 : null;
}

// ✅ FIX #9 : getOrderFinancials résout automatiquement le provider via KNOWN_PROVIDER_BY_COLLECTION
// quand rawProvider est null (cas EXO)
function getOrderFinancials(d = {}, rawProvider = null, collectionName = '') {
  const amount = getOrderAmountXAF(d, collectionName);

  let resolvedProvider = null;
  if (rawProvider) {
    resolvedProvider = rawProvider;
  } else if (d.provider || d.fournisseur || d.providerName || d.supplier || d.api) {
    resolvedProvider = d.provider || d.fournisseur || d.providerName || d.supplier || d.api;
  } else if (collectionName && KNOWN_PROVIDER_BY_COLLECTION[collectionName]) {
    resolvedProvider = KNOWN_PROVIDER_BY_COLLECTION[collectionName];
  }

  const provider = normalizeProvider(resolvedProvider);
  const storedMultiplier = Number(d.providerMultiplier || d.multiplier || 0);
  const multiplierByProvider = { MTP: MTP_MULTIPLIER, EXO: EXO_MULTIPLIER, AfriqueBoost: AFB_MULTIPLIER, SMMWiz: SMMWIZ_MULTIPLIER, SMMGen: SMMGEN_MULTIPLIER };
  const multiplier = storedMultiplier > 1 ? storedMultiplier : multiplierByProvider[provider];
  const costCandidates = [d.providerCostXAF, d.supplierCostXAF, d.provider_cost_xaf, d.supplier_cost_xaf]
    .filter(value => value !== undefined && value !== null && value !== '' && Number.isFinite(Number(value)))
    .map(value => Math.max(0, Number(value)));
  const positiveStoredCost = costCandidates.find(value => value > 0);
  let providerCostXAF = positiveStoredCost !== undefined
    ? positiveStoredCost
    : (costCandidates.length ? 0 : null);
  let providerCostEstimated = false;

  const storedProfit = d.estimatedProfitXAF;
  const hasPositiveStoredProfit = storedProfit !== undefined && storedProfit !== null &&
    Number.isFinite(Number(storedProfit)) && Number(storedProfit) > 0;

  // Si la marge a été enregistrée mais pas le coût, le coût est déductible
  // sans hypothèse : prix facturé moins marge enregistrée.
  if ((providerCostXAF === null || providerCostXAF <= 0) && amount !== null && amount > 0 &&
      hasPositiveStoredProfit && Number(storedProfit) < amount) {
    providerCostXAF = amount - Number(storedProfit);
    providerCostEstimated = true;
  }

  // Pour les petits montants, le coût enregistré peut être arrondi à zéro
  // (ou égal au prix de vente). Avec un multiplicateur fournisseur connu,
  // on reconstitue alors le coût au lieu d'afficher une marge nulle.
  const invalidStoredCost = providerCostXAF === null || providerCostXAF <= 0 ||
    (amount !== null && amount > 0 && providerCostXAF >= amount);
  if (amount !== null && amount > 0 && multiplier && multiplier > 1 && invalidStoredCost) {
    providerCostXAF = Math.min(amount, Math.max(0, Math.round(amount / multiplier)));
    providerCostEstimated = true;
  }

  let grossProfitXAF = storedProfit !== undefined && storedProfit !== null && Number.isFinite(Number(storedProfit))
    ? Number(storedProfit)
    : (amount !== null && providerCostXAF !== null ? amount - providerCostXAF : null);

  // Le champ estimatedProfitXAF peut être resté à zéro après un arrondi ancien.
  // Recalculer seulement si le prix, le coût et le multiplicateur rendent une
  // marge positive mathématiquement cohérente.
  if (amount !== null && amount > 0 && providerCostXAF !== null &&
      providerCostXAF < amount && (grossProfitXAF === null || grossProfitXAF <= 0)) {
    grossProfitXAF = amount - providerCostXAF;
    providerCostEstimated = true;
  }

  const refundedAmount = Number(d.refundedAmount ?? d.refundAmount ?? 0) || 0;
  return {
    amount, provider, providerCostXAF, grossProfitXAF,
    profitMarginPct: amount > 0 && grossProfitXAF !== null ? Math.round((grossProfitXAF / amount) * 10000) / 100 : null,
    providerCostEstimated, profitEstimated: providerCostEstimated || grossProfitXAF === null,
    multiplier: multiplier || null, refundedAmount,
  };
}

// Version explicite des métriques clients : les classements et les fiches
// doivent provenir de la même reconstruction avant d'être présentés comme exacts.
const CUSTOMER_ORDER_METRICS_VERSION = 3;
const CUSTOMER_ORDER_OWNER_FIELDS = ['userId', 'uid', 'user_id', 'customerId', 'customerUid', 'ownerId', 'ownerUid', 'buyerId', 'buyerUid', 'clientId', 'clientUid', 'creatorId', 'createdBy'];

function normalizeCustomerOrderStatus(order = {}) {
  return String(order.status || order.orderStatus || order.state || '')
    .trim()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[\s-]+/g, '_');
}

function isCustomerOrderExcluded(order = {}) {
  const status = normalizeCustomerOrderStatus(order);
  return status.startsWith('annul') || status.includes('cancel') ||
    status.startsWith('rejet') || status.includes('reject');
}

function isCustomerMarginEligible(order = {}) {
  const status = normalizeCustomerOrderStatus(order);
  return ['success', 'successful', 'succeeded', 'succes', 'reussi', 'completed', 'complete',
    'delivered', 'termine', 'en_cours', 'in_progress', 'processing'].includes(status) ||
    status.startsWith('success') || status.startsWith('succes') || status.startsWith('reussi') ||
    status.startsWith('completed') || status.startsWith('complete') || status.startsWith('delivered') ||
    status.startsWith('termine') || status.startsWith('en_cours') || status.startsWith('in_progress') ||
    status.startsWith('processing');
}

function getCustomerOrderOwnerIds(order = {}) {
  return [...new Set(CUSTOMER_ORDER_OWNER_FIELDS
    .map(field => String(order[field] || '').trim())
    .filter(Boolean))];
}

function getCustomerOrderContribution(order = {}, collectionName = '') {
  if (isCustomerOrderExcluded(order)) {
    return { included: false, amount: null, profit: null, profitEligible: false, profitUnavailable: false, financials: null };
  }
  const financials = getOrderFinancials(
    order,
    order.provider || order.fournisseur || order.providerName || order.supplier || (collectionName === 'commandes' ? 'EXO' : null),
    collectionName
  );
  const profitEligible = !isCustomerOrderExcluded(order);
  const profitKnown = profitEligible && financials.grossProfitXAF !== null &&
    financials.grossProfitXAF !== undefined && Number.isFinite(Number(financials.grossProfitXAF));
  return {
    included: true,
    amount: financials.amount,
    profit: profitKnown ? Number(financials.grossProfitXAF) : null,
    profitEligible,
    profitUnavailable: profitEligible && !profitKnown,
    financials,
  };
}

function isCustomerMetricsStateReady(state) {
  return Number(state?.payload?.version || 0) >= CUSTOMER_ORDER_METRICS_VERSION && Boolean(state?.payload?.completedAt);
}

async function fetchCustomerOrderDocuments(userId) {
  const rows = await Promise.all(ADMIN_ORDER_COLLECTIONS.map(async collectionName => {
    const snapshots = await Promise.all(CUSTOMER_ORDER_OWNER_FIELDS.map(field =>
      db.collection(collectionName).where(field, '==', userId).get()
    ));
    const unique = new Map();
    snapshots.forEach(snapshot => snapshot.docs.forEach(doc => unique.set(doc.id, doc)));
    return { collectionName, docs: [...unique.values()] };
  }));
  return rows;
}

function normalizeProvider(value) {
  const p = String(value || '').trim().toLowerCase().replace(/[ _-]+/g, '');
  if (!p) return 'inconnu';
  if (p.includes('mtp') || p.includes('morethanpanel')) return 'MTP';
  if (p.includes('exo')) return 'EXO';
  if (p.includes('afriqueboost') || p === 'afb') return 'AfriqueBoost';
  if (p.includes('smmwiz')) return 'SMMWiz';
  if (p.includes('smmgen')) return 'SMMGen';
  return String(value).trim();
}

async function countPendingAdminOrders() {
  const variants = ['En attente','en attente','pending','Pending'];
  const snapshots = await Promise.all(ADMIN_ORDER_COLLECTIONS.map(name => db.collection(name).where('status','in',variants).count().get().catch(() => ({ data: () => ({ count: 0 }) }))));
  return snapshots.reduce((sum, snap) => sum + Number(snap.data()?.count || 0), 0);
}

// ═══════════════════════════════════════════════════════════════
// ✅ FIX #10 : Route /diagnostic pour debug (nouvelle route,
// n'affecte aucune route existante)
// ═══════════════════════════════════════════════════════════════
adminRouter.get('/diagnostic', async (req, res) => {
  try {
    const collections = [...ADMIN_ORDER_COLLECTIONS, ...PAYMENT_COLLECTIONS];
    const results = {};
    for (const name of collections) {
      try {
        const c = await db.collection(name).count().get();
        const dateField = await detectDateField(name);
        const sample = await db.collection(name).limit(1).get();
        let sampleFields = null;
        if (!sample.empty) {
          const data = sample.docs[0].data();
          sampleFields = Object.keys(data).slice(0, 20);
        }
        results[name] = {
          count: c.data().count,
          dateField,
          provider: KNOWN_PROVIDER_BY_COLLECTION[name] || (sampleFields && sampleFields.includes('provider') ? 'dynamic (champ provider)' : 'auto'),
          sampleFields,
        };
      } catch (e) {
        results[name] = { error: e.message };
      }
    }
    res.json({ success: true, collections: results, timestamp: new Date().toISOString() });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

adminRouter.get('/overview', async (req, res) => {
  try {
    const forceRefresh = String(req.query.refresh || '') === '1';
    const cached = !forceRefresh ? memCacheGet(adminMemoryCache.overview) : null;
    if (cached) return res.json({ success: true, data: cached, cached: true });
    if (!forceRefresh) {
      const shared = await getSharedAdminCache('overview-v3');
      if (shared) { memCacheSet(adminMemoryCache.overview, shared.payload, Math.max(1000, shared.expiresAtMs - Date.now())); return res.json({ success: true, data: shared.payload, cached: true, cacheScope: 'shared' }); }
    }

    const now = new Date();
    const local = new Date(now.getTime() + 60 * 60 * 1000);
    const todayStart = new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate()) - 60 * 60 * 1000);
    const tomorrowStart = new Date(todayStart.getTime() + 24 * 60 * 60 * 1000);
    const yesterdayStart = new Date(todayStart.getTime() - 24 * 60 * 60 * 1000);
    const dayBeforeStart = new Date(todayStart.getTime() - 48 * 60 * 60 * 1000);

    const dayOfWeek = local.getUTCDay();
    const daysFromMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
    const startOfThisWeek = new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate() - daysFromMonday) - 60 * 60 * 1000);
    const startOfLastWeek = new Date(startOfThisWeek.getTime() - 7 * 24 * 60 * 60 * 1000);

    const usersRef = db.collection('users'); const giftsRef = db.collection('welcomeGiftClaims');

    const todayKey = localDateKey(todayStart);
    const yesterdayKey = localDateKey(yesterdayStart);
    const dayBeforeKey = localDateKey(dayBeforeStart);
    const dayKeys = [todayKey, yesterdayKey, dayBeforeKey];

    const [
      usersCount, newUsersThisWeek, newUsersLastWeek, newUsersToday, newUsersYesterday, newUsersDayBefore,
      orderCounters,
      ordersTodayCounts, ordersYesterdayCounts, ordersDayBeforeCounts, pendingOrdersCount, giftsPending, giftsLate,
      finToday,
      visitAgg, activeVisitors7d, balanceAgg,
      counterDocs,
      depositsTodayStats, depositsYesterdayStats, depositsDayBeforeStats,
    ] = await Promise.all([
      usersRef.count().get(),
      countUsersInWindow(startOfThisWeek, now),
      countUsersInWindow(startOfLastWeek, startOfThisWeek),
      countUsersInWindow(todayStart, tomorrowStart),
      countUsersInWindow(yesterdayStart, todayStart),
      countUsersInWindow(dayBeforeStart, yesterdayStart),
      readOrderCounters(),
      Promise.all(ADMIN_ORDER_COLLECTIONS.map(name => countOrdersInWindow(name, todayStart, tomorrowStart))),
      Promise.all(ADMIN_ORDER_COLLECTIONS.map(name => countOrdersInWindow(name, yesterdayStart, todayStart))),
      Promise.all(ADMIN_ORDER_COLLECTIONS.map(name => countOrdersInWindow(name, dayBeforeStart, yesterdayStart))),
      countPendingAdminOrders(),
      giftsRef.where('status', '==', 'pending').count().get(),
      giftsRef.where('status', '==', 'pending').where('createdAt', '<', admin.firestore.Timestamp.fromDate(new Date(now.getTime() - 24 * 60 * 60 * 1000))).count().get(),
      getCachedFinancialAggregate(todayStart, tomorrowStart),
      usersRef.aggregate({ total: admin.firestore.AggregateField.sum('dashboardVisitCount') }).get(),
      usersRef.where('lastDashboardVisit', '>=', admin.firestore.Timestamp.fromDate(new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000))).count().get(),
      usersRef.aggregate({ total: admin.firestore.AggregateField.sum('balance') }).get(),
      Promise.all(dayKeys.map(k => db.collection('dailyCounters').doc(k).get().catch(() => null))),
      getDepositsStatsAllCollections(todayStart, tomorrowStart),
      getDepositsStatsAllCollections(yesterdayStart, todayStart),
      getDepositsStatsAllCollections(dayBeforeStart, yesterdayStart),
    ]);

    const totalUsers = Number(usersCount.data().count || 0);
    const totalBalance = Number(balanceAgg.data().total || 0);
    const counts = orderCounters.counts; const totalOrders = orderCounters.total;
    const visitsByDay = counterDocs.map(d => (d && d.exists ? Number((d.data() || {}).dashboardVisits || 0) : 0));
    const autoGrossSales = finToday.totalSales;
    const autoRefunds = finToday.totalRefunds;

    const data = {
      totalUsers,
      newUsersThisWeek: Number(newUsersThisWeek || 0),
      newUsersLastWeek: Number(newUsersLastWeek || 0),
      newUsers7d: Number(newUsersThisWeek || 0),
      newUsersToday: Number(newUsersToday || 0),
      newUsersYesterday: Number(newUsersYesterday || 0),
      newUsersDayBefore: Number(newUsersDayBefore || 0),
      totalOrders,
      ordersToday: ordersTodayCounts.reduce((sum,n)=>sum+Number(n||0),0),
      ordersYesterday: ordersYesterdayCounts.reduce((sum,n)=>sum+Number(n||0),0),
      ordersDayBefore: ordersDayBeforeCounts.reduce((sum,n)=>sum+Number(n||0),0),
      orderCountsByCollection: counts,
      pendingOrders: Number(pendingOrdersCount || 0),
      totalRevenue: Math.max(0, autoGrossSales - autoRefunds),
      autoOrdersGrossSales: autoGrossSales,
      autoOrdersRefunds: autoRefunds,
      allCollectionsGrossSales: autoGrossSales,
      allCollectionsRefunds: autoRefunds,
      allCollectionsSupplierCost: finToday.totalSupplierCost,
      allCollectionsGrossProfit: finToday.totalProfit,
      allCollectionsNetSales: finToday.netSales,
      totalBalance,
      averageBalance: totalUsers ? Math.round(totalBalance / totalUsers) : 0,
      dashboardVisitsRecorded: Number(visitAgg.data().total || 0),
      activeDashboardUsers7d: Number(activeVisitors7d.data().count || 0),
      dashboardVisitsToday: visitsByDay[0],
      dashboardVisitsYesterday: visitsByDay[1],
      dashboardVisitsDayBefore: visitsByDay[2],
      depositsToday: {
        total: depositsTodayStats.total,
        success: depositsTodayStats.success,
        pending: depositsTodayStats.pending,
        failed: depositsTodayStats.failed,
        totalCreditedXAF: depositsTodayStats.totalCreditedXAF,
        topDepositor: depositsTodayStats.topDepositor,
      },
      depositsYesterday: {
        total: depositsYesterdayStats.total,
        success: depositsYesterdayStats.success,
        pending: depositsYesterdayStats.pending,
        failed: depositsYesterdayStats.failed,
        totalCreditedXAF: depositsYesterdayStats.totalCreditedXAF,
      },
      depositsDayBefore: {
        total: depositsDayBeforeStats.total,
        success: depositsDayBeforeStats.success,
        pending: depositsDayBeforeStats.pending,
        failed: depositsDayBeforeStats.failed,
        totalCreditedXAF: depositsDayBeforeStats.totalCreditedXAF,
      },
      depositsSuccessToday: depositsTodayStats.success,
      depositsPendingToday: depositsTodayStats.pending,
      depositsFailedToday: depositsTodayStats.failed,
      depositsCreditedXAFToday: depositsTodayStats.totalCreditedXAF,
      giftsPending: Number(giftsPending.data().count || 0),
      giftsLate: Number(giftsLate.data().count || 0),
      multipliers: { MTP: MTP_MULTIPLIER, EXO: EXO_MULTIPLIER, AfriqueBoost: AFB_MULTIPLIER, SMMGen: SMMGEN_MULTIPLIER, SMMWiz: SMMWIZ_MULTIPLIER },
      generatedAt: now.toISOString(),
      revenueScope: 'Les ventes, coûts et marges couvrent toutes les collections de commandes (autoOrders, commandes EXO, etc.).',
      dailyVisitsNote: 'Les visites par jour sont comptées depuis le déploiement du compteur dailyCounters. Les jours antérieurs restent à 0.',
      weekScope: 'newUsersThisWeek = lundi 00:00 (UTC+1) → maintenant. newUsersLastWeek = lundi précédent → lundi de cette semaine.',
    };
    memCacheSet(adminMemoryCache.overview, data, 30 * 60 * 1000);
    await setSharedAdminCache('overview-v3', data, 30 * 60 * 1000);
    res.json({ success: true, data, cached: false });
  } catch (error) {
    console.error('Erreur /overview:', error);
    return res.status(500).json({ success: false, error: 'Impossible de calculer les statistiques de la vue d’ensemble.' });
  }
});

async function countDepositsInRange(start, end) {
  try {
    const [fapshiCount, nelsiusCount] = await Promise.all([
      db.collection('fapshiTransactions').where('createdAt', '>=', admin.firestore.Timestamp.fromDate(start)).where('createdAt', '<', admin.firestore.Timestamp.fromDate(end)).count().get().catch(() => null),
      db.collection('paymentTransactions').where('createdAt', '>=', admin.firestore.Timestamp.fromDate(start)).where('createdAt', '<', admin.firestore.Timestamp.fromDate(end)).count().get().catch(() => null),
    ]);
    return Number(fapshiCount?.data()?.count || 0) + Number(nelsiusCount?.data()?.count || 0);
  } catch (_) { return 0; }
}

// ✅ FIX #11 : /top-users supporte maintenant dateStart/dateEnd (période personnalisée)
adminRouter.get('/top-users', async (req, res) => {
  try {
    const forceRefresh = String(req.query.refresh || '') === '1';
    const period = String(req.query.period || 'all').toLowerCase();

    if (req.query.dateStart || req.query.dateEnd) {
      const dateStartRaw = req.query.dateStart ? new Date(req.query.dateStart) : null;
      const dateEndRaw = req.query.dateEnd ? new Date(req.query.dateEnd) : null;
      const dateStart = dateStartRaw && !isNaN(dateStartRaw.getTime()) ? dateStartRaw : null;
      const dateEnd = dateEndRaw && !isNaN(dateEndRaw.getTime()) ? dateEndRaw : null;
      if (!dateStart || !dateEnd || dateStart >= dateEnd) {
        return res.status(400).json({ success: false, error: 'La période personnalisée est invalide.' });
      }
      const users = await getTopUsersInRange(dateStart, dateEnd, forceRefresh);
      const customPeriodLabel = `du ${dateStart.toLocaleDateString('fr-FR')} au ${new Date(dateEnd.getTime() - 1).toLocaleDateString('fr-FR')}`;
      const responseUsers = users.map(u => ({ ...u, periodLabel: customPeriodLabel }));
      return res.json({ success: true, period: 'custom', periodLabel: customPeriodLabel, users: responseUsers, champion: responseUsers[0] || null, metricsReady: true, cached: !forceRefresh });
    }

    if (period === 'today' || period === 'week') {
      const now = new Date();
      const local = new Date(now.getTime() + 60 * 60 * 1000);
      const todayStart = new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate()) - 60 * 60 * 1000);
      let start = todayStart;
      let label = "aujourd'hui";
      if (period === 'week') {
        const weekday = local.getUTCDay();
        const daysFromMonday = weekday === 0 ? 6 : weekday - 1;
        start = new Date(todayStart.getTime() - daysFromMonday * 24 * 60 * 60 * 1000);
        label = 'cette semaine';
      }
      const users = period === 'today'
        ? await getTopUsersToday(forceRefresh)
        : await getTopUsersInRange(start, now, forceRefresh);
      const responseUsers = users.map(u => ({ ...u, periodLabel: label }));
      return res.json({ success: true, period, periodLabel: label, users: responseUsers, champion: responseUsers[0] || null, metricsReady: true, cached: !forceRefresh });
    }

    // Toute la plateforme : les métriques du profil sont fiables uniquement
    // après le recalcul v2, qui applique les mêmes clés et statuts que la fiche.
    const metricsState = await getSharedAdminCache('customerOrderMetricsState');
    const metricsReady = isCustomerMetricsStateReady(metricsState);
    if (!metricsReady) {
      adminMemoryCache.topUsers.data = null; adminMemoryCache.topUsers.expires = 0;
      return res.json({
        success: true, period: 'all', periodLabel: 'depuis votre inscription', users: [], champion: null,
        metricsReady: false, requiresRebuild: true,
        message: 'Recalculez une fois les métriques historiques dans la page Clients pour afficher un classement global authentique.',
      });
    }

    const cached = !forceRefresh ? memCacheGet(adminMemoryCache.topUsers) : null;
    if (cached) return res.json({ success: true, period: 'all', periodLabel: 'depuis votre inscription', users: cached, champion: cached[0] || null, metricsReady: true, cached: true });
    if (!forceRefresh) {
      const shared = await getSharedAdminCache('topUsers');
      if (shared && Array.isArray(shared.payload)) {
        memCacheSet(adminMemoryCache.topUsers, shared.payload, Math.max(1000, shared.expiresAtMs - Date.now()));
        return res.json({ success: true, period: 'all', periodLabel: 'depuis votre inscription', users: shared.payload, champion: shared.payload[0] || null, metricsReady: true, cached: true, cacheScope: 'shared' });
      }
    }

    const allUsers = await getAllUsersSorted(forceRefresh);
    const users = allUsers
      .map(u => formatCustomerFromUser(u, true))
      .map(u => ({
        id: u.id, name: u.name || 'Anonyme', email: u.email || null, phone: u.phone || null,
        balance: Number(u.balance || 0), country: u.country || null, createdAt: u.createdAt || null,
        orderCount: Number(u.totalOrders || 0), totalOrders: Number(u.totalOrders || 0),
        totalSpent: Number(u.totalSpent || 0), totalProfit: Number(u.totalProfit || 0),
      }))
      .filter(u => u.orderCount > 0)
      .sort((a, b) => (b.orderCount - a.orderCount) || (b.totalSpent - a.totalSpent) || (b.totalProfit - a.totalProfit))
      .slice(0, 20)
      .map(u => ({ ...u, periodLabel: 'depuis votre inscription', periodOrderCount: u.orderCount }));

    memCacheSet(adminMemoryCache.topUsers, users, 30 * 60 * 1000);
    await setSharedAdminCache('topUsers', users, 30 * 60 * 1000);
    return res.json({ success: true, period: 'all', periodLabel: 'depuis votre inscription', users, champion: users[0] || null, metricsReady: true, cached: false, reads: allUsers.length, source: 'versioned-customer-order-metrics' });
  } catch (error) {
    console.error('Erreur /top-users:', error);
    res.status(500).json({ success: false, error: 'Impossible de charger le classement des utilisateurs.' });
  }
});

adminRouter.get('/users-count-range', async (req, res) => {
  try {
    const start = parseBusinessDate(req.query.dateStart, false);
    const end = parseBusinessDate(req.query.dateEnd, true);
    if (!start || !end || start >= end) {
      return res.status(400).json({ success: false, error: 'Période d’inscription invalide.' });
    }
    const key = `${start.toISOString()}|${end.toISOString()}`;
    const cacheKey = `users-count-range-v2-${sha256Short(key)}`;
    const local = usersCountRangeCache.get(key);
    if (local && Date.now() < local.expires) return res.json({ success: true, count: local.count, cached: true });
    const shared = await getSharedAdminCache(cacheKey);
    if (shared) {
      usersCountRangeCache.set(key, { count: Number(shared.payload.count || 0), expires: shared.expiresAtMs });
      return res.json({ success: true, count: Number(shared.payload.count || 0), cached: true, cacheScope: 'shared' });
    }
    const count = await countUsersInWindow(start, end);
    usersCountRangeCache.set(key, { count, expires: Date.now() + 60 * 60 * 1000 });
    await setSharedAdminCache(cacheKey, { count }, 60 * 60 * 1000);
    return res.json({ success: true, count, cached: false });
  } catch (error) {
    console.error('Erreur /users-count-range:', error);
    return res.status(500).json({ success: false, error: 'Impossible de compter les inscriptions de cette période.' });
  }
});

adminRouter.get('/users-stats', async (req, res) => {
  try {
    const forceRefresh = String(req.query.refresh || '') === '1';
    const cached = !forceRefresh ? memCacheGet(adminMemoryCache.usersStats) : null;
    if (cached) return res.json({ success: true, ...cached, cached: true });
    if (!forceRefresh) {
      const shared = await getSharedAdminCache('usersStats');
      if (shared) {
        memCacheSet(adminMemoryCache.usersStats, shared.payload, Math.max(1000, shared.expiresAtMs - Date.now()));
        return res.json({ success: true, ...shared.payload, cached: true, cacheScope: 'shared' });
      }
    }

    const sevenDaysAgoDate = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const sevenDaysAgo = admin.firestore.Timestamp.fromDate(sevenDaysAgoDate);
    const [totalRes, newUsers7d, balanceAgg, dashboardVisitorsRes] = await Promise.all([
      db.collection('users').count().get(),
      countCreatedBetween(db.collection('users'), sevenDaysAgoDate, new Date()),
      db.collection('users').aggregate({ total: admin.firestore.AggregateField.sum('balance') }).get(),
      db.collection('users').where('lastDashboardVisit', '>=', sevenDaysAgo).count().get(),
    ]);

    const totalUsers = totalRes.data().count;
    const totalBalance = balanceAgg.data().total || 0;
    const avgBalance = totalUsers > 0 ? Math.round(totalBalance / totalUsers) : 0;

    const payload = {
      stats: {
        totalUsers,
        newUsers7d: newUsers7d,
        dashboardVisitors7d: dashboardVisitorsRes.data().count || 0,
        totalBalance,
        avgBalance,
      },
    };

    memCacheSet(adminMemoryCache.usersStats, payload, 60 * 60 * 1000);
    await setSharedAdminCache('usersStats', payload, 60 * 60 * 1000);
    res.json({ success: true, ...payload, cached: false, firestoreQueries: 5 });
  } catch (error) {
    console.error('Erreur /users-stats:', error);
    res.status(500).json({ success: false, error: 'Impossible de calculer les statistiques utilisateurs.' });
  }
});

adminRouter.get('/orders-summary', async (req, res) => {
  try {
    const forceRefresh = String(req.query.refresh || '') === '1';
    const cached = !forceRefresh ? memCacheGet(adminMemoryCache.orderSummary) : null;
    if (cached) return res.json({ success: true, data: cached, cached: true });
    if (!forceRefresh) {
      const shared = await getSharedAdminCache('orderSummary');
      if (shared) {
        memCacheSet(adminMemoryCache.orderSummary, shared.payload, Math.max(1000, shared.expiresAtMs - Date.now()));
        return res.json({ success: true, data: shared.payload, cached: true, cacheScope: 'shared' });
      }
    }
    const buckets = {
      pending: ['En attente', 'en attente', 'pending', 'Pending'],
      inProgress: ['En cours', 'en cours', 'In progress', 'in progress', 'Processing', 'processing'],
      completed: ['Terminé', 'Terminée', 'Terminee', 'completed', 'Completed', 'Done', 'done', 'Delivered', 'delivered', 'Succès', 'succès'],
      cancelled: ['Annulé', 'Annulée', 'Annule', 'Canceled', 'Cancelled', 'canceled', 'cancelled'],
      failed: ['Échouée', 'Echouée', 'failed', 'Failed', 'error', 'Erreur'],
    };
    const [counterTotals, ...collectionStatuses] = await Promise.all([
      readOrderCounters(),
      ...ADMIN_ORDER_COLLECTIONS.map(async collectionName => {
        const ref = db.collection(collectionName);
        const values = await Promise.all(Object.entries(buckets).map(async ([key, variants]) => {
          const snap = await ref.where('status', 'in', variants).count().get().catch(() => ({ data: () => ({ count: 0 }) }));
          return [key, snap.data().count || 0];
        }));
        return Object.fromEntries(values);
      }),
    ]);
    const data = { total: counterTotals.total, sources: counterTotals.counts, byCollection: {}, ...Object.fromEntries(Object.keys(buckets).map(k => [k, 0])) };
    ADMIN_ORDER_COLLECTIONS.forEach((name, i) => {
      data.byCollection[name] = { total: counterTotals.counts[name] || 0, ...collectionStatuses[i] };
      for (const key of Object.keys(buckets)) data[key] += Number(collectionStatuses[i][key] || 0);
    });
    data.other = Math.max(0, data.total - Object.keys(buckets).reduce((sum, key) => sum + data[key], 0));
    data.note = 'Total calculé par agrégation sur les six collections de commandes; statuts agrégés par collection. Cache 15 minutes.';
    memCacheSet(adminMemoryCache.orderSummary, data, 15 * 60 * 1000);
    await setSharedAdminCache('orderSummary', data, 15 * 60 * 1000);
    return res.json({ success: true, data, cached: false, collectionsCounted: ADMIN_ORDER_COLLECTIONS.length, statusAggregates: ADMIN_ORDER_COLLECTIONS.length * Object.keys(buckets).length });
  } catch (error) {
    console.error('Erreur /api/admin/orders-summary:', error);
    return res.status(500).json({ success: false, error: 'Impossible de charger les compteurs de commandes.' });
  }
});

// ✅ ORDERS: chargement en mémoire, tri par date réelle, support dateStart/dateEnd, offset pagination
adminRouter.get('/orders', async (req, res) => {
  try {
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 10, 3), 50);
    const offset = Math.max(0, parseInt(req.query.offset, 10) || 0);
    const userId = String(req.query.userId || '').trim();
    const statusFilter = String(req.query.status || '').trim().toLowerCase();
    const providerFilter = String(req.query.provider || '').trim().toLowerCase();
    const dateStartRaw = req.query.dateStart ? new Date(req.query.dateStart) : null;
    const dateEndRaw = req.query.dateEnd ? new Date(req.query.dateEnd) : null;
    const dateStart = dateStartRaw && !isNaN(dateStartRaw.getTime()) ? dateStartRaw : null;
    const dateEnd = dateEndRaw && !isNaN(dateEndRaw.getTime()) ? dateEndRaw : null;
    const forceRefresh = String(req.query.refresh || '') === '1';

    const cacheKey = `orders|${userId}|${statusFilter}|${providerFilter}|${dateStart?.getTime() || 'x'}|${dateEnd?.getTime() || 'x'}`;
    if (!forceRefresh && ordersCache.data && ordersCache.data[cacheKey] && Date.now() < ordersCache.data[cacheKey].expires) {
      const cached = ordersCache.data[cacheKey].orders;
      if (cached.length >= offset + limit) {
        return res.json({ success: true, orders: cached.slice(offset, offset + limit), total: cached.length, offset, limit, hasMore: offset + limit < cached.length, cached: true });
      }
    }
    const sharedPageKey = `orders-page-${sha256Short(`${cacheKey}|${offset}|${limit}`)}`;
    if (!forceRefresh) {
      const sharedPage = await getSharedAdminCache(sharedPageKey);
      if (sharedPage) return res.json({ success: true, ...sharedPage.payload, cached: true, cacheScope: 'shared' });
    }

    const statusAliases = {
      'en attente': ['en attente','pending'], 'en cours': ['en cours','in progress','processing'],
      'terminé': ['terminé','terminée','terminee','completed','done','delivered','succès','succes'],
      'terminée': ['terminé','terminée','terminee','completed','done','delivered','succès','succes'],
      'annulé': ['annulé','annulée','annule','canceled','cancelled'], 'annulée': ['annulé','annulée','annule','canceled','cancelled'],
      'partiel': ['partiel','partial'],
      'échouée': ['échouée','echouee','failed','error','erreur'],
    };
    const providerAliases = { mtp:['mtp','morethanpanel'], exo:['exo'], afriqueboost:['afriqueboost','afb'], smmwiz:['smmwiz'], smmgen:['smmgen'] };

    const collected = [];
    const pageFetchLimit = Math.min(500, Math.max(limit, (offset + limit) * ((providerFilter && providerFilter !== 'all') || (statusFilter && statusFilter !== 'all') ? 5 : 1)));

    for (const collectionName of ADMIN_ORDER_COLLECTIONS) {
      const ref = db.collection(collectionName);
      const dateField = await detectDateField(collectionName);

      try {
        const docsMap = new Map();
        if (userId) {
          // Toutes les variantes d'identifiant reconnues par la fiche client.
          const ownerQueries = await Promise.all(CUSTOMER_ORDER_OWNER_FIELDS.map(field =>
            ref.where(field, '==', userId).limit(pageFetchLimit).get().catch(() => null)
          ));
          ownerQueries.filter(Boolean).forEach(snap => snap.docs.forEach(d => docsMap.set(d.id, d)));
        } else if (dateStart || dateEnd) {
          const dateTypes = await getCollectionDateTypes(collectionName, dateField);
          const modes = buildDateRangeQueries(ref, dateField, dateStart, dateEnd, dateTypes);
          for (const mode of modes) {
            try {
              const snap = await mode.query.orderBy(dateField, 'desc').limit(pageFetchLimit).get();
              snap.docs.forEach(d => docsMap.set(d.id, d));
            } catch (queryError) {
              console.warn(`[Orders] Format date ${mode.type} ignoré pour ${collectionName}:`, queryError.message);
            }
          }
        } else {
          try {
            const snap = await ref.orderBy(dateField, 'desc').limit(pageFetchLimit).get();
            snap.docs.forEach(d => docsMap.set(d.id, d));
          } catch (orderErr) {
            console.warn(`[Orders] orderBy ${dateField} échoué sur ${collectionName}:`, orderErr.message);
          }
        }
        if (!docsMap.size && !userId && !dateStart && !dateEnd && (!statusFilter || statusFilter === 'all') && (!providerFilter || providerFilter === 'all')) {
          try {
            const fallbackSnap = await ref.limit(pageFetchLimit).get();
            fallbackSnap.docs.forEach(d => docsMap.set(d.id, d));
          } catch (plainErr) {
            console.warn(`[Orders] fallback simple limit ${collectionName}:`, plainErr.message);
          }
        }
        if (!docsMap.size && !userId && !dateStart && !dateEnd && (!statusFilter || statusFilter === 'all') && (!providerFilter || providerFilter === 'all')) {
          try {
            const ultraFallbackSnap = await ref.get();
            ultraFallbackSnap.docs.forEach(d => docsMap.set(d.id, d));
          } catch (allErr) {
            console.warn(`[Orders] fallback complet ${collectionName}:`, allErr.message);
          }
        }
        const docs = [...docsMap.values()];

        for (const doc of docs) {
          const data = doc.data() || {};
          const dateVal = data[dateField] || data.createdAt || data.date || data.created_at || data.timestamp || data.dateCreated || null;
          const ts = getTimestampMs(dateVal);

          if (dateStart && ts < dateStart.getTime()) continue;
          if (dateEnd && ts >= dateEnd.getTime()) continue;

          if (statusFilter && statusFilter !== 'all') {
            const wanted = (statusAliases[statusFilter] || [statusFilter]).map(s => s.toLowerCase());
            if (!wanted.includes(String(data.status || '').toLowerCase())) continue;
          }

          const o = normalizeAdminOrder(doc, collectionName);

          if (providerFilter && providerFilter !== 'all') {
            const wanted = providerAliases[providerFilter] || [providerFilter];
            if (!wanted.includes(String(o.provider || '').toLowerCase())) continue;
          }

          collected.push(o);
        }
      } catch (e) {
        console.warn(`[Orders] ${collectionName}:`, e.message);
      }
    }

    collected.sort((a, b) => getTimestampMs(b.createdAt) - getTimestampMs(a.createdAt));

    // Pour une recherche par date sans filtre additionnel, le total vient des
    // agrégations Firestore de chaque collection, pas du petit lot chargé pour
    // afficher la page. Cela évite d'annoncer 3 ou 10 commandes quand il y en a
    // davantage dans la journée.
    let exactRangeTotal = null;
    if (dateStart && dateEnd && !userId && (!statusFilter || statusFilter === 'all') && (!providerFilter || providerFilter === 'all')) {
      const counts = await Promise.all(ADMIN_ORDER_COLLECTIONS.map(name => countOrdersInWindow(name, dateStart, dateEnd)));
      exactRangeTotal = counts.reduce((sum, n) => sum + Number(n || 0), 0);
    }

    if (!ordersCache.data) ordersCache.data = {};
    ordersCache.data[cacheKey] = { orders: collected, expires: Date.now() + ORDERS_CACHE_TTL_MS };

    const slice = collected.slice(offset, offset + limit);
    const enriched = await enrichAdminOrderUsers(slice);
    const response = {
      success: true, orders: enriched, total: exactRangeTotal === null ? collected.length : exactRangeTotal, offset, limit,
      hasMore: offset + limit < collected.length,
      pageSizePerCollection: pageFetchLimit, collections: ADMIN_ORDER_COLLECTIONS,
      providerFilter: providerFilter || null,
      totalIsLoadedWindow: exactRangeTotal === null,
    };
    if (!ordersCache.data) ordersCache.data = {};
    ordersCache.data[cacheKey] = { orders: collected, expires: Date.now() + ORDERS_CACHE_TTL_MS };
    await setSharedAdminCache(sharedPageKey, response, ORDERS_CACHE_TTL_MS);
    return res.json(response);
  } catch (error) {
    console.error('Erreur /api/admin/orders:', error);
    res.status(500).json({ success: false, error: 'Impossible de charger les commandes.' });
  }
});

const adminOrderUserCache = new Map();
async function enrichAdminOrderUsers(orders) {
  const ids=[...new Set(orders.map(o=>o.userId).filter(Boolean))];
  const now=Date.now(); const missing=ids.filter(id=>{const v=adminOrderUserCache.get(id);return !v||v.expires<now;});
  const snapshots=await Promise.all(missing.map(id=>db.collection('users').doc(id).get()));
  snapshots.forEach(s=>{const u=s.exists?(s.data()||{}):{};adminOrderUserCache.set(s.id,{name:u.displayName||u.username||u.name||u.fullName||null,email:u.email||null,phone:u.phone||u.whatsapp||null,expires:now+5*60*1000});});
  return orders.map(o=>{const u=adminOrderUserCache.get(o.userId)||{};return {...o,userName:u.name||null,userEmail:u.email||null,userPhone:u.phone||null};});
}


function normalizeAdminStatusValue(value) {
  return String(value || '').trim().normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

function pickOrderOwnerId(order = {}) {
  return order.userId || order.uid || order.user_id || order.customerId || order.customerUid || order.ownerId || order.ownerUid || order.buyerId || order.buyerUid || order.clientId || order.clientUid || order.creatorId || order.createdBy || null;
}

function pickOrderProviderReference(order = {}) {
  return order.providerOrderId || order.exoOrderId || order.externalOrderId || order.providerId || order.orderId || order.reference || order.transactionId || null;
}

function normalizeAdminOrderStatus(provider, rawStatus) {
  const s = normalizeAdminStatusValue(rawStatus);
  const map = {
    pending: 'En attente',
    processing: 'En cours',
    inprogress: 'En cours',
    'in progress': 'En cours',
    completed: 'Terminé',
    complete: 'Terminé',
    done: 'Terminé',
    delivered: 'Terminé',
    success: 'Terminé',
    successful: 'Terminé',
    succeeded: 'Terminé',
    paid: 'Terminé',
    partial: 'Partiel',
    canceled: 'Annulé',
    cancelled: 'Annulé',
    reject: 'Annulé',
    rejected: 'Annulé',
    failed: 'Échoué',
    failure: 'Échoué',
    error: 'Échoué',
  };
  if (provider === 'SMMGen') return 'SMMGen fermé';
  return map[s] || (rawStatus || 'En attente');
}

function orderRefundAmountFromData(orderData = {}, status = '', remains = 0) {
  const totalCost = Number(orderData.priceXAF || orderData.totalCost || orderData.finalCost || orderData.cost || orderData.amount || 0) || 0;
  if (!totalCost) return 0;
  const qty = Number(orderData.quantity || 1) || 1;
  const friendly = normalizeAdminStatusValue(status);
  if (friendly.includes('partiel') || friendly.includes('partial')) {
    const rem = Number(remains || qty) || qty;
    return Math.max(0, Math.round((rem / qty) * totalCost));
  }
  if (friendly.includes('annul') || friendly.includes('cancel') || friendly.includes('rej') || friendly.includes('failed') || friendly.includes('échou')) {
    return totalCost;
  }
  return 0;
}

async function applyOrderRefund(orderRef, ownerId, provider, transactionLabel, refundAmount, nextStatus, extraUpdates = {}) {
  if (!refundAmount || refundAmount <= 0) {
    await orderRef.update({ ...extraUpdates, status: nextStatus, lastChecked: admin.firestore.FieldValue.serverTimestamp() });
    return false;
  }
  await db.runTransaction(async (t) => {
    const freshOrder = await t.get(orderRef);
    if (!freshOrder.exists) return;
    const freshData = freshOrder.data() || {};
    const alreadyRefunded = Boolean(freshData.refunded || freshData.isRefunded || freshData.refund);
    if (alreadyRefunded) {
      t.update(orderRef, { ...extraUpdates, status: nextStatus, lastChecked: admin.firestore.FieldValue.serverTimestamp() });
      return;
    }
    const userRef = ownerId ? db.collection('users').doc(ownerId) : null;
    let balanceBefore = 0;
    let balanceAfter = refundAmount;
    if (userRef) {
      const userDoc = await t.get(userRef);
      balanceBefore = userDoc.exists ? Number(userDoc.data().balance || 0) : 0;
      balanceAfter = balanceBefore + refundAmount;
      if (userDoc.exists) t.update(userRef, { balance: balanceAfter });
      else t.set(userRef, { balance: balanceAfter }, { merge: true });
    }
    addAdminOperationLog(t, { type: 'order_refund', category: 'remboursement', action: 'Remboursement de commande', userId: ownerId || null, amountXAF: refundAmount, provider, transactionId: transactionLabel, status: 'CONFIRMED', balanceBefore, balanceAfter, source: 'admin-status-check' });
    t.update(orderRef, { ...extraUpdates, status: nextStatus, refunded: true, refundedAmount: refundAmount, lastChecked: admin.firestore.FieldValue.serverTimestamp() });
  });
  return true;
}

async function verifyAdminOrderDocument(orderRef, orderData = {}, collectionName = '') {
  const provider = normalizeProvider(orderData.provider || orderData.fournisseur || orderData.providerName || orderData.supplier || orderData.api || (collectionName === 'commandes' ? 'EXO' : null));
  const providerOrderId = pickOrderProviderReference(orderData);
  if (!providerOrderId && provider !== 'SMMGen') {
    throw new Error('Aucune référence fournisseur trouvée pour cette commande.');
  }
  const ownerId = pickOrderOwnerId(orderData);
  let providerStatus = null;
  let startCount = Number(orderData.providerStartCount || 0) || 0;
  let remains = Number(orderData.providerRemains || 0) || 0;
  let charge = Number(orderData.providerCharge || 0) || 0;
  let mappedStatus = 'En attente';
  let extraUpdates = {};

  if (provider === 'EXO') {
    const result = await callExo({ action: 'status', order: orderData.exoOrderId || providerOrderId });
    if (result.error) throw new Error('Erreur EXO: ' + result.error);
    providerStatus = result.status;
    mappedStatus = normalizeAdminOrderStatus(provider, providerStatus);
    remains = parseInt(result.remains) || 0;
    startCount = parseInt(result.start_count) || 0;
    extraUpdates = { providerStartCount: startCount, providerRemains: remains };
  } else if (provider === 'MTP') {
    const result = await callMTP({ action: 'status', order: providerOrderId });
    if (result.error) throw new Error('Erreur MTP: ' + result.error);
    providerStatus = result.status;
    mappedStatus = normalizeAdminOrderStatus(provider, providerStatus);
    remains = parseInt(result.remains) || 0;
    startCount = parseInt(result.start_count) || 0;
    extraUpdates = { providerStartCount: startCount, providerRemains: remains };
  } else if (provider === 'AfriqueBoost') {
    const result = await callAfriqueBoost({ action: 'status', order: providerOrderId });
    if (result.error) throw new Error('Erreur AfriqueBoost: ' + result.error);
    providerStatus = result.status;
    mappedStatus = normalizeAdminOrderStatus(provider, providerStatus);
    remains = parseInt(result.remains) || 0;
    startCount = parseInt(result.start_count) || 0;
    extraUpdates = { providerStartCount: startCount, providerRemains: remains };
  } else if (provider === 'SMMWiz') {
    const result = await callSmmWiz({ action: 'status', order: providerOrderId });
    if (result.error) throw new Error('Erreur SMMWiz: ' + result.error);
    providerStatus = result.status;
    mappedStatus = normalizeAdminOrderStatus(provider, providerStatus);
    remains = parseInt(result.remains) || 0;
    startCount = parseInt(result.start_count) || 0;
    charge = parseFloat(result.charge) || 0;
    extraUpdates = { providerStartCount: startCount, providerRemains: remains, providerCharge: charge };
  } else if (provider === 'SMMGen') {
    throw new Error('SMMGen est un ancien fournisseur inactif : aucune vérification disponible.');
  } else {
    const result = await callMTP({ action: 'status', order: providerOrderId });
    if (result.error) throw new Error('Erreur fournisseur: ' + result.error);
    providerStatus = result.status;
    mappedStatus = normalizeAdminOrderStatus(provider, providerStatus);
    remains = parseInt(result.remains) || 0;
    startCount = parseInt(result.start_count) || 0;
    extraUpdates = { providerStartCount: startCount, providerRemains: remains };
  }

  const refundAmount = orderRefundAmountFromData(orderData, mappedStatus, remains);
  const label = orderData.orderId || orderData.reference || orderData.id || providerOrderId || orderRef.id;
  if (refundAmount > 0) {
    await applyOrderRefund(orderRef, ownerId, provider, label, refundAmount, mappedStatus, extraUpdates);
  } else {
    await orderRef.update({ status: mappedStatus, lastChecked: admin.firestore.FieldValue.serverTimestamp(), ...extraUpdates });
  }

  const updated = await orderRef.get();
  return { providerStatus, status: mappedStatus, refunded: refundAmount > 0, refundAmount, order: normalizeAdminOrder(updated, collectionName) };
}

async function creditSwychrDeposit(transRef, transData, txId, statusLabel = 'CONFIRMED') {
  const userId = transData.userId || transData.uid || transData.customerId || null;
  const amountXAF = Number(transData.amountXAF || transData.creditedAmountXAF || transData.amount || transData.total || 0) || 0;
  if (!userId || amountXAF <= 0) {
    await transRef.update({ status: statusLabel, lastChecked: admin.firestore.FieldValue.serverTimestamp() });
    return false;
  }
  let credited = false;
  let balanceBefore = 0;
  let balanceAfter = 0;
  await db.runTransaction(async (t) => {
    const freshTrans = await t.get(transRef);
    if (!freshTrans.exists) return;
    const freshData = freshTrans.data() || {};
    const alreadyCredited = Boolean(freshData.creditedAt || freshData.creditApplied || freshData.dateConfirmed);
    if (alreadyCredited) return;
    const userRef = db.collection('users').doc(userId);
    const userDoc = await t.get(userRef);
    balanceBefore = userDoc.exists ? Number(userDoc.data().balance || 0) : 0;
    balanceAfter = balanceBefore + amountXAF;
    if (userDoc.exists) t.update(userRef, { balance: balanceAfter });
    else t.set(userRef, { balance: balanceAfter }, { merge: true });
    t.update(transRef, { status: statusLabel, lastChecked: admin.firestore.FieldValue.serverTimestamp(), creditedAmountXAF: amountXAF, creditedAt: admin.firestore.FieldValue.serverTimestamp(), creditApplied: true });
    credited = true;
    if (transData.storeId && transData.email) {
      const storeCustomerRef = db.collection('stores').doc(String(transData.storeId)).collection('customers').doc(String(transData.email));
      const storeCustomerDoc = await t.get(storeCustomerRef);
      const storeBalanceBefore = storeCustomerDoc.exists ? Number(storeCustomerDoc.data().balance || 0) : 0;
      t.set(storeCustomerRef, { balance: storeBalanceBefore + amountXAF }, { merge: true });
    }
  });
  if (credited) {
    await recordDailyDepositCredit(userId, amountXAF, 'Swychr', txId, balanceBefore, balanceAfter);
    await upsertDepositOperationLog({ provider: 'Swychr', transactionId: txId, userId, amountXAF, status: 'CONFIRMED', action: 'Recharge créditée', balanceBefore, balanceAfter, source: 'admin-status-check' });
  }
  return credited;
}

async function verifyAdminDepositDocument(transRef, transData = {}, sourceName = '') {
  const source = String(sourceName || '').toLowerCase();
  const provider = String(transData.provider || transData.providerName || transData.fournisseur || transData.api || (source === 'paymenttransactions' ? 'NelsiusPay' : source === 'fapshitransactions' ? 'Fapshi' : 'Swychr')).trim() || 'Swychr';
  const txId = transData.reference || transData.transactionId || transData.transactionID || transData.transId || transRef.id;

  if (source === 'paymenttransactions' || provider.toLowerCase().includes('nelsius') || provider.toLowerCase().includes('nelsius')) {
    const nelsiusStatusResp = await callNelsiusPay(`/payments/${encodeURIComponent(txId)}`, 'GET');
    if (!nelsiusStatusResp.ok) {
      throw new Error(nelsiusStatusResp.status === 404 ? 'Transaction non trouvée chez le fournisseur.' : (nelsiusStatusResp.data?.message || `Erreur de vérification (HTTP ${nelsiusStatusResp.status})`));
    }
    const nelsiusData = nelsiusStatusResp.data?.data || nelsiusStatusResp.data;
    const providerStatus = String(nelsiusData?.status || 'pending').toLowerCase();
    const internalStatus = normalizeNelsiusStatus(providerStatus);
    const providerAmount = Number(nelsiusData?.amount) || transData.providerAmount || 0;
    const providerCurrency = (nelsiusData?.currency || transData.providerCurrency || 'XAF').toUpperCase();
    const transactionCode = nelsiusData?.transaction_code || transData.transactionCode || null;
    await transRef.update({ status: internalStatus, transactionCode, providerAmount, providerCurrency, lastChecked: admin.firestore.FieldValue.serverTimestamp() });
    if (internalStatus === 'CONFIRMED') {
      await creditUserIfNeeded(transRef.id, transData.userId || transData.uid, { ...transData, creditedAmountXAF: Number(transData.creditedAmountXAF || transData.amountXAF || providerAmount || 0) });
    }
    return { status: internalStatus, transactionCode };
  }

  if (source === 'fapshitransactions' || provider.toLowerCase().includes('fapshi')) {
    const fapshiTransId = transData.fapshiTransId || txId;
    const API_USER = process.env.FAPSHI_API_USER;
    const SECRET_KEY = process.env.FAPSHI_SECRET_KEY;
    if (!API_USER || !SECRET_KEY) throw new Error('Configuration Fapshi incomplète.');
    const fapshiRes = await fetch(`https://live.fapshi.com/payment-status/${fapshiTransId}`, { headers: { 'apiuser': API_USER, 'apikey': SECRET_KEY, 'Content-Type': 'application/json' } });
    if (!fapshiRes.ok) throw new Error(`Fapshi API error: ${fapshiRes.status} - ${await fapshiRes.text()}`);
    const fapshiData = await fapshiRes.json();
    const statusUpper = String(fapshiData.status || 'PENDING').toUpperCase();
    if (statusUpper === 'SUCCESSFUL') {
      const amountToCredit = Number(transData.amount || transData.creditedAmountXAF || 0);
      if (amountToCredit > 0) {
        const userRef = db.collection('users').doc(transData.userId || transData.uid);
        let balanceBefore = 0, balanceAfter = amountToCredit;
        await db.runTransaction(async (t) => {
          const userDoc = await t.get(userRef);
          balanceBefore = userDoc.exists ? Number(userDoc.data().balance || 0) : 0;
          balanceAfter = balanceBefore + amountToCredit;
          if (userDoc.exists) t.update(userRef, { balance: balanceAfter }); else t.set(userRef, { balance: balanceAfter }, { merge: true });
          t.update(transRef, { status: 'CONFIRMED', dateConfirmed: admin.firestore.FieldValue.serverTimestamp(), lastChecked: admin.firestore.FieldValue.serverTimestamp() });
        });
        await recordDailyDepositCredit(transData.userId || transData.uid, amountToCredit, 'Fapshi', txId, balanceBefore, balanceAfter);
        await bumpDailyCounter('deposits');
        return { status: 'CONFIRMED' };
      }
      await transRef.update({ status: 'FAILED', lastChecked: admin.firestore.FieldValue.serverTimestamp() });
      return { status: 'FAILED' };
    }
    if (statusUpper === 'PENDING' || statusUpper === 'WAITING' || statusUpper === 'INITIATED') {
      await transRef.update({ status: 'PENDING', lastChecked: admin.firestore.FieldValue.serverTimestamp() });
      return { status: 'PENDING' };
    }
    if (statusUpper === 'FAILED' || statusUpper === 'EXPIRED' || statusUpper === 'CANCELED' || statusUpper === 'REVERSED') {
      await transRef.update({ status: 'FAILED', lastChecked: admin.firestore.FieldValue.serverTimestamp() });
      return { status: 'FAILED' };
    }
    await transRef.update({ status: statusUpper, lastChecked: admin.firestore.FieldValue.serverTimestamp() });
    return { status: statusUpper };
  }

  if (source === 'transactions' || source === 'payments' || source === 'rechargements' || source === 'recharges' || provider.toLowerCase().includes('swychr')) {
    const authRes = await fetch('https://api.accountpe.com/api/payin/admin/auth', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: process.env.ACCOUNTPE_USERNAME, password: process.env.ACCOUNTPE_PASSWORD })
    });
    const authData = await authRes.json();
    if (!authData.token) throw new Error('Échec authentification Swychr : Token introuvable');
    const statusRes = await fetch('https://api.accountpe.com/api/payin/payment_link_status', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${authData.token}` },
      body: JSON.stringify({ transaction_id: txId })
    });
    const textResponse = await statusRes.text();
    let statusData;
    try { statusData = JSON.parse(textResponse); } catch { throw new Error('Réponse API Swychr invalide (non JSON)'); }
    const attributes = statusData?.data?.data?.attributes || statusData?.data?.attributes || {};
    const rawStatus = String(attributes.status || 'inconnu').toLowerCase().trim();
    const statusSucces = ['1', 'success', 'completed', 'terminé', 'succès', 'reussi', 'successful', 'paid'];
    const statusEchec = ['-1', '2', 'failed', 'echec', 'annulé', 'cancelled', 'rejected', 'error'];
    let interpretedStatus = 'PENDING';
    if (statusSucces.includes(rawStatus)) interpretedStatus = 'CONFIRMED';
    else if (statusEchec.includes(rawStatus)) interpretedStatus = 'FAILED';
    else interpretedStatus = 'PENDING';
    await transRef.update({ status: interpretedStatus, verifiedBy: 'admin_direct_check', lastChecked: admin.firestore.FieldValue.serverTimestamp() });
    if (interpretedStatus === 'CONFIRMED') {
      await creditSwychrDeposit(transRef, transData, txId, 'CONFIRMED');
    }
    return { status: interpretedStatus };
  }

  throw new Error(`Source de recharge non supportée pour vérification: ${sourceName || 'inconnu'}`);
}

// ✅ STORES: ne force pas la date, tri en mémoire
adminRouter.get('/stores', async (req, res) => {
  try {
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 25, 10), 100);
    const country = String(req.query.country || '').trim();

    const snap = await db.collection('stores').limit(500).get();
    let stores = snap.docs.map(doc => {
      const d = doc.data() || {};
      const ownerId = d.userId || d.ownerId || d.uid || d.createdBy || d.ownerUid || null;
      const slug = d.slug || d.username || d.storeSlug || null;
      const createdAt = d.createdAt || d.dateCreated || d.created_at || d.creationDate || d.date || d.timestamp || null;
      return {
        id: doc.id,
        name: d.name || d.storeName || d.title || d.businessName || 'Boutique sans nom',
        slug,
        url: d.url || d.storeUrl || d.publicUrl || d.customDomain || null,
        logo: d.logo || d.logoUrl || d.image || d.photo || null,
        ownerId,
        ownerName: d.ownerName || d.userName || d.displayName || d.owner || null,
        ownerEmail: d.email || d.ownerEmail || null,
        country: d.country || null,
        status: d.status || (d.active === false ? 'inactive' : 'active'),
        createdAt,
        _createdMs: getTimestampMs(createdAt),
      };
    });

    if (country) {
      const aliases = new Set(getCountryAliases(country).map(v => String(v).toLowerCase()));
      stores = stores.filter(s => aliases.has(String(s.country || '').toLowerCase()));
    }

    stores.sort((a, b) => b._createdMs - a._createdMs);

    const totalAvailable = stores.length;
    stores = stores.slice(0, limit).map(s => { delete s._createdMs; return s; });

    const ownerIds = [...new Set(stores.map(s => s.ownerId).filter(Boolean))];
    const ownerSnaps = await Promise.all(ownerIds.map(id => db.collection('users').doc(id).get()));
    const owners = new Map(ownerSnaps.filter(s => s.exists).map(s => {
      const u = s.data() || {};
      return [s.id, {
        name: u.displayName || u.username || u.name || u.fullName || null,
        email: u.email || null,
        country: u.country || u.countryCode || u.country_code || null,
        phone: u.phone || u.whatsapp || null,
        balance: Number(u.balance || 0),
        createdAt: u.createdAt || u.created_at || null,
      }];
    }));

    for (const store of stores) {
      const owner = owners.get(store.ownerId);
      if (owner) {
        store.ownerName = store.ownerName || owner.name;
        store.ownerEmail = store.ownerEmail || owner.email;
        store.ownerCountry = owner.country || null;
        store.ownerPhone = owner.phone || null;
        store.ownerBalance = owner.balance;
        store.ownerCreatedAt = owner.createdAt;
        if (!store.country) store.country = owner.country;
      }
    }

    return res.json({ success: true, stores, total: totalAvailable, pageSize: limit, nextCursor: null });
  } catch (error) {
    console.error('Erreur /api/admin/stores:', error);
    return res.status(500).json({ success: false, error: 'Impossible de charger les boutiques.' });
  }
});

// ✅ DEPOSITS: support dateStart/dateEnd + tri mémoire
// ✅ FIX #12 : transactions → providerFallback 'Swychr' + creditKeys priorise amountXAF
adminRouter.get('/operations', async (req, res) => {
  try {
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 10), 100);
    const forceRefresh = String(req.query.refresh || '') === '1';
    const cacheKey = `operations-journal-v1-${limit}`;
    if (!forceRefresh) {
      const shared = await getSharedAdminCache(cacheKey);
      if (shared) return res.json({ success: true, operations: shared.payload.operations || [], cached: true, cacheScope: 'shared', note: 'Le journal conserve les crédits confirmés enregistrés depuis son activation.' });
    }
    const snap = await db.collection('adminOperationLogs').orderBy('createdAt', 'desc').limit(limit).get();
    const operations = snap.docs.map(doc => {
      const d = doc.data() || {};
      return {
        id: doc.id, type: d.type || 'operation', category: d.category || 'autre', action: d.action || 'Opération',
        userId: d.userId || null, amountXAF: Number(d.amountXAF || 0), provider: d.provider || null,
        transactionId: d.transactionId || d.reference || null, status: d.status || 'UNKNOWN',
        balanceBefore: d.balanceBefore == null ? null : Number(d.balanceBefore),
        balanceAfter: d.balanceAfter == null ? null : Number(d.balanceAfter), createdAt: d.createdAt || null,
      };
    });
    const userIds = [...new Set(operations.map(x => x.userId).filter(Boolean))];
    if (userIds.length) {
      // L'index partagé remplace N lectures de profils par quelques lectures de shards
      // réutilisées par la rubrique Clients et les autres instances Vercel.
      const indexedUsers = await getAllUsersSorted(false);
      const users = new Map(indexedUsers.map(u => [u.id, {
        name: u.displayName || u.username || u.name || 'Client',
        email: u.email || null, country: u.country || null,
      }]));
      operations.forEach(op => { const user = users.get(op.userId); if (user) Object.assign(op, { userName: user.name, userEmail: user.email, country: user.country }); });
    }
    await setSharedAdminCache(cacheKey, { operations }, 5 * 60 * 1000);
    return res.json({ success: true, operations, cached: false, note: 'Le journal conserve les crédits confirmés enregistrés depuis son activation.' });
  } catch (error) {
    console.error('Erreur /operations:', error);
    return res.status(500).json({ success: false, error: 'Impossible de charger le journal des opérations.' });
  }
});


adminRouter.post('/orders/:collection/:docId/verify-status', async (req, res) => {
  try {
    const collection = String(req.params.collection || '').trim();
    const docId = String(req.params.docId || '').trim();
    if (!collection || !docId) return res.status(400).json({ success: false, error: 'Commande invalide.' });
    const orderRef = db.collection(collection).doc(docId);
    const orderDoc = await orderRef.get();
    if (!orderDoc.exists) return res.status(404).json({ success: false, error: 'Commande introuvable.' });
    const result = await verifyAdminOrderDocument(orderRef, orderDoc.data() || {}, collection);
    return res.json({ success: true, ...result, message: `Commande ${docId} vérifiée.` });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

adminRouter.get('/deposits', async (req, res) => {
  try {
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 25, 10), 100);
    const status = String(req.query.status || 'all').toUpperCase();
    const providerFilter = String(req.query.provider || 'all').toLowerCase();
    const dateStartRaw = req.query.dateStart ? new Date(req.query.dateStart) : null;
    const dateEndRaw = req.query.dateEnd ? new Date(req.query.dateEnd) : null;
    const dateStart = dateStartRaw && !isNaN(dateStartRaw.getTime()) ? dateStartRaw : null;
    const dateEnd = dateEndRaw && !isNaN(dateEndRaw.getTime()) ? dateEndRaw : null;
    const forceRefresh = String(req.query.refresh || '') === '1';

    const cacheKey = `deposits:v2:${status}:${providerFilter}:${dateStart?.getTime() || 'x'}:${dateEnd?.getTime() || 'x'}:${limit}`;
    const sharedKey = `deposits-page-${sha256Short(cacheKey)}`;
    if (!forceRefresh && depositsCache.data && depositsCache.data[cacheKey] && Date.now() < depositsCache.data[cacheKey].expires) {
      return res.json({ success: true, ...depositsCache.data[cacheKey].payload, cached: true, cacheScope: 'instance' });
    }
    if (!forceRefresh) {
      const shared = await getSharedAdminCache(sharedKey);
      if (shared) {
        if (!depositsCache.data) depositsCache.data = {};
        depositsCache.data[cacheKey] = { payload: shared.payload, expires: shared.expiresAtMs };
        return res.json({ success: true, ...shared.payload, cached: true, cacheScope: 'shared' });
      }
    }

    const sources = [
      { name: 'paymentTransactions', providerFallback: 'NelsiusPay', amountKeys: ['requestedAmount','amount'], currencyKeys: ['requestedCurrency','currency'], creditKeys: ['creditedAmountXAF','amountXAF'] },
      { name: 'fapshiTransactions', providerFallback: 'Fapshi', amountKeys: ['amount','requestedAmount'], currencyKeys: ['currency','requestedCurrency'], creditKeys: ['creditedAmountXAF','creditedAmount','amountCreditedXAF','amount'] },
      { name: 'payments', providerFallback: 'Swychr', amountKeys: ['amount','amountXAF','total','montant'], currencyKeys: ['currency','devise'], creditKeys: ['creditedAmountXAF','amountXAF','amountCredited','amount'] },
      { name: 'rechargements', providerFallback: 'Rechargement', amountKeys: ['amount','amountXAF','total','montant','requestedAmount'], currencyKeys: ['currency','devise'], creditKeys: ['creditedAmountXAF','amountXAF','amountCredited','amount'] },
      { name: 'recharges', providerFallback: 'Recharge', amountKeys: ['amount','amountXAF','total','montant','requestedAmount'], currencyKeys: ['currency','devise'], creditKeys: ['creditedAmountXAF','amountXAF','amountCredited','amount'] },
      { name: 'transactions', providerFallback: 'Swychr', amountKeys: ['amount','amountXAF','total','montant','requestedAmount'], currencyKeys: ['currency','devise'], creditKeys: ['amountXAF','creditedAmountXAF','amountCredited','amount'] },
    ];
    const statusVariants = {
      CONFIRMED: ['CONFIRMED','confirmed','SUCCESS','success','SUCCEEDED','succeeded','PAID','paid','SUCCESSFUL','successful','completed','COMPLETED'],
      PENDING: ['PENDING','pending','PROCESSING','processing','INITIATED','initiated','WAITING','waiting'],
      FAILED: ['FAILED','failed','FAILURE','failure','CANCELLED','cancelled','REJECTED','rejected','EXPIRED','expired'],
    };

    const results = [];
    for (const source of sources) {
      if (providerFilter !== 'all') {
        const srcName = source.providerFallback.toLowerCase();
        const srcId = source.name.toLowerCase();
        if (!srcName.includes(providerFilter) && !srcId.includes(providerFilter)) continue;
      }
      try {
        const dateField = await detectDateField(source.name).catch(() => 'createdAt');
        const ref = db.collection(source.name);
        const dateTypes = (dateStart || dateEnd) ? await getCollectionDateTypes(source.name, dateField) : [];
        const modes = (dateStart || dateEnd)
          ? buildDateRangeQueries(ref, dateField, dateStart, dateEnd, dateTypes)
          : [{ type: 'all', query: ref }];
        const docsMap = new Map();
        for (const mode of modes) {
          const q = mode.query;
          if (status !== 'ALL' && statusVariants[status]) {
            // Filtre sur le serveur quand l'index existe, avec repli borné si non disponible.
            try {
              const statusQuery = q.where('status', 'in', statusVariants[status]);
              const snap = await statusQuery.orderBy(dateField, 'desc').limit(limit).get();
              snap.docs.forEach(doc => docsMap.set(doc.id, doc));
              continue;
            } catch (_) {}
          }
          const snap = await q.orderBy(dateField, 'desc').limit(limit).get().catch(async () => q.limit(limit).get());
          snap.docs.forEach(doc => docsMap.set(doc.id, doc));
        }

        const items = [...docsMap.values()].map(doc => {
          const d = doc.data() || {};
          const pick = keys => { for (const k of keys) if (d[k] !== undefined && d[k] !== null && d[k] !== '') return d[k]; return null; };
          const rawStatus = String(d.status || d.paymentStatus || d.state || 'UNKNOWN');
          const amount = Number(pick(source.amountKeys) || 0);
          const creditedRaw = pick(source.creditKeys);
          const createdAtRaw = d[dateField] || d.createdAt || d.dateInitiated || d.created_at || d.dateCreated || d.timestamp || d.date || d.paidAt || null;
          const createdAtMs = getTimestampMs(createdAtRaw);
          if (dateStart && createdAtMs < dateStart.getTime()) return null;
          if (dateEnd && createdAtMs >= dateEnd.getTime()) return null;
          if (status !== 'ALL' && statusVariants[status] && !statusVariants[status].some(v => v.toLowerCase() === rawStatus.toLowerCase())) return null;
          return {
            id: doc.id, source: source.name,
            reference: d.reference || d.transId || d.fapshiTransId || d.transactionId || d.transaction_id || doc.id,
            userId: d.userId || d.uid || d.user_id || null,
            userName: d.userName || d.displayName || d.name || d.customer_name || d.username || null,
            userEmail: d.email || d.userEmail || d.customer_email || null,
            provider: d.provider || d.paymentProvider || source.providerFallback,
            status: rawStatus, requestedAmount: amount,
            requestedCurrency: pick(source.currencyKeys) || 'XAF',
            creditedAmountXAF: creditedRaw === null ? null : Number(creditedRaw),
            createdAt: createdAtRaw,
            completedAt: d.completedAt || d.dateConfirmed || d.creditedAt || d.updatedAt || d.paidAt || null,
            failureReason: d.failureReason || d.error || d.message || null,
            _createdMs: createdAtMs,
          };
        }).filter(Boolean);
        results.push({ source: source.name, items });
      } catch (err) {
        console.warn(`Deposits ${source.name}:`, err.message);
        results.push({ source: source.name, items: [] });
      }
    }

    let transactions = results.flatMap(r => r.items);
    transactions.sort((a, b) => b._createdMs - a._createdMs);
    const totalCandidates = transactions.length;
    transactions = transactions.slice(0, limit);
    const userIds = [...new Set(transactions.filter(t => t.userId && (!t.userName || !t.userEmail)).map(t => t.userId))];
    if (userIds.length) {
      const userSnaps = await Promise.all(userIds.map(id => db.collection('users').doc(id).get()));
      const users = new Map(userSnaps.filter(s => s.exists).map(s => {
        const u = s.data() || {}; return [s.id, { name: u.displayName || u.username || u.name || null, email: u.email || null }];
      }));
      for (const t of transactions) { const u = users.get(t.userId); if (u) { t.userName = t.userName || u.name; t.userEmail = t.userEmail || u.email; } }
    }
    transactions.forEach(t => { delete t._createdMs; });
    const response = { transactions, total: totalCandidates, pageSize: limit, sources: results.map(s => s.source), providerFilter, note: 'Lecture bornée : au plus une page par collection, puis fusion et tri global.' };
    if (!depositsCache.data) depositsCache.data = {};
    depositsCache.data[cacheKey] = { payload: response, expires: Date.now() + DEPOSITS_CACHE_TTL_MS };
    await setSharedAdminCache(sharedKey, response, DEPOSITS_CACHE_TTL_MS);
    return res.json({ success: true, ...response, cached: false });
  } catch (error) {
    console.error('Erreur /api/admin/deposits:', error);
    return res.status(500).json({ success: false, error: 'Impossible de charger les recharges.' });
  }
});

adminRouter.get('/customers', async (req, res) => {
  try {
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 25, 10), 100);
    const search = String(req.query.q || '').trim();
    const country = String(req.query.country || '').trim();
    const segment = String(req.query.segment || 'all').trim();
    const sort = String(req.query.sort || 'recent').trim();
    const dateStartRaw = req.query.dateStart ? new Date(req.query.dateStart) : null;
    const dateEndRaw = req.query.dateEnd ? new Date(req.query.dateEnd) : null;
    const dateStart = dateStartRaw && !isNaN(dateStartRaw.getTime()) ? dateStartRaw : null;
    const dateEnd = dateEndRaw && !isNaN(dateEndRaw.getTime()) ? dateEndRaw : null;
    const forceRefresh = String(req.query.refresh || '') === '1';
    const cursorIdx = req.query.cursor ? Math.max(0, parseInt(req.query.cursor, 10) || 0) : 0;

    const metricsState = await getSharedAdminCache('customerOrderMetricsState');
    const metricsReady = isCustomerMetricsStateReady(metricsState);

    const allUsers = await getAllUsersSorted(forceRefresh);

    let filtered = allUsers;

    if (dateStart) filtered = filtered.filter(u => u._createdAtMs >= dateStart.getTime());
    if (dateEnd) filtered = filtered.filter(u => u._createdAtMs < dateEnd.getTime());

    if (search) {
      let matched;
      if (search.includes('@')) {
        matched = filtered.filter(u => String(u.email || '').toLowerCase() === search.toLowerCase());
      } else {
        const q = search.toLowerCase();
        matched = filtered.filter(u =>
          String(u.id).toLowerCase() === q ||
          String(u.displayName || u.username || u.name || '').toLowerCase().includes(q) ||
          String(u.email || '').toLowerCase().includes(q)
        );
      }
      const customers = matched.slice(0, limit).map(u => formatCustomerFromUser(u, metricsReady));
      return res.json({ success: true, customers, total: matched.length, page: 1, totalPages: 1, pageSize: limit, nextCursor: null, metricsReady, metricsAsOf: metricsState?.payload?.completedAt || null });
    }

    if (country) {
      const aliases = new Set(getCountryAliases(country).map(v => String(v).toLowerCase()));
      filtered = filtered.filter(u => aliases.has(String(u.country || '').trim().toLowerCase()));
    }

    const orderMetric = u => Number(metricsReady ? (u.adminOrderCount ?? u.totalOrders ?? 0) : (u.totalOrders ?? u.adminOrderCount ?? 0));
    const spendMetric = u => Number(metricsReady ? (u.adminTotalSpent ?? u.totalSpent ?? 0) : (u.totalSpent ?? u.adminTotalSpent ?? 0));
    const profitMetric = u => Number(metricsReady ? (u.adminTotalProfit ?? u.totalProfit ?? 0) : (u.totalProfit ?? u.adminTotalProfit ?? 0));
    const nowMs = Date.now();
    const lastOrderMs = u => Number(u.adminLastOrderAtMs || getTimestampMs(u.adminLastOrderAt) || 0);
    const daysSinceOrder = u => lastOrderMs(u) > 0 ? Math.floor((nowMs - lastOrderMs(u)) / 86400000) : null;
    const signupAgeDays = u => Math.floor((nowMs - Number(u._createdAtMs || 0)) / 86400000);
    const orderedUsers = filtered.filter(u => orderMetric(u) > 0 && spendMetric(u) > 0);
    const vipThreshold = orderedUsers.length ? [...orderedUsers].sort((a,b) => spendMetric(b)-spendMetric(a))[Math.max(0, Math.ceil(orderedUsers.length * 0.10)-1)] : null;
    const vipMinimumSpend = vipThreshold ? spendMetric(vipThreshold) : Number.MAX_SAFE_INTEGER;

    if (segment === 'ordered') filtered = filtered.filter(u => orderMetric(u) > 0);
    else if (segment === 'neverOrdered') filtered = filtered.filter(u => orderMetric(u) === 0);
    else if (segment === 'vip') filtered = filtered.filter(u => orderMetric(u) > 0 && spendMetric(u) >= vipMinimumSpend);
    else if (segment === 'loyal') filtered = filtered.filter(u => orderMetric(u) >= 5 && daysSinceOrder(u) !== null && daysSinceOrder(u) <= 30);
    else if (segment === 'new') filtered = filtered.filter(u => u._createdAtMs > 0 && signupAgeDays(u) <= 30);
    else if (segment === 'atRisk') filtered = filtered.filter(u => orderMetric(u) > 0 && daysSinceOrder(u) !== null && daysSinceOrder(u) >= 7 && daysSinceOrder(u) <= 9);
    else if (segment === 'inactive10') filtered = filtered.filter(u => orderMetric(u) > 0 && daysSinceOrder(u) !== null && daysSinceOrder(u) >= 10 && daysSinceOrder(u) <= 20);
    else if (segment === 'inactive21') filtered = filtered.filter(u => orderMetric(u) > 0 && daysSinceOrder(u) !== null && daysSinceOrder(u) >= 21 && daysSinceOrder(u) <= 29);
    else if (segment === 'inactive30') filtered = filtered.filter(u => orderMetric(u) > 0 && daysSinceOrder(u) !== null && daysSinceOrder(u) >= 30 && daysSinceOrder(u) <= 89);
    else if (segment === 'inactive90') filtered = filtered.filter(u => orderMetric(u) > 0 && daysSinceOrder(u) !== null && daysSinceOrder(u) >= 90 && daysSinceOrder(u) <= 149);
    else if (segment === 'inactive150') filtered = filtered.filter(u => orderMetric(u) > 0 && daysSinceOrder(u) !== null && daysSinceOrder(u) >= 150);

    // Le segment de classement doit primer sur le tri récent par défaut.
    if (sort === 'orders' || segment === 'highOrders' || segment === 'loyal') filtered.sort((a, b) => orderMetric(b) - orderMetric(a));
    else if (sort === 'spent' || segment === 'highSpent' || segment === 'vip') filtered.sort((a, b) => spendMetric(b) - spendMetric(a));
    else if (sort === 'profit' || segment === 'highProfit') filtered.sort((a, b) => profitMetric(b) - profitMetric(a));
    else if (sort === 'balance' || segment === 'highBalance') filtered.sort((a, b) => Number(b.balance || 0) - Number(a.balance || 0));
    else if (['atRisk','inactive10','inactive21','inactive30','inactive90','inactive150'].includes(segment)) filtered.sort((a, b) => lastOrderMs(a) - lastOrderMs(b));
    else if (segment === 'new') filtered.sort((a, b) => b._createdAtMs - a._createdAtMs);
    else filtered.sort((a, b) => b._createdAtMs - a._createdAtMs);

    const total = filtered.length;
    const totalPages = Math.max(1, Math.ceil(total / limit));
    const startIdx = cursorIdx;
    const paginatedUsers = filtered.slice(startIdx, startIdx + limit);
    const nextCursor = (startIdx + limit) < total ? String(startIdx + limit) : null;
    const customers = paginatedUsers.map(u => formatCustomerFromUser(u, metricsReady));

    return res.json({
      success: true,
      customers,
      nextCursor,
      pageSize: limit,
      total,
      totalPages,
      metricsReady,
      metricsAsOf: metricsState?.payload?.completedAt || null,
      note: metricsReady ? 'Statistiques de commandes recalculées depuis les six collections.' : 'Cliquez sur « Recalculer » pour corriger les anciens comptes.'
    });
  } catch (error) {
    console.error('Erreur /api/admin/customers:', error);
    return res.status(500).json({ success: false, error: 'Impossible de charger les utilisateurs.' });
  }
});

function formatCustomerFromUser(u, metricsReady) {
  // Après recalcul, les compteurs admin ont été reconstruits à partir des commandes
  // de toutes les collections ; avant cela, on conserve les compteurs du profil.
  const orderCount = Number(metricsReady ? (u.adminOrderCount ?? u.totalOrders ?? 0) : (u.totalOrders ?? u.adminOrderCount ?? 0));
  const spent = Number(metricsReady ? (u.adminTotalSpent ?? u.totalSpent ?? 0) : (u.totalSpent ?? u.adminTotalSpent ?? 0));
  const profit = Number(metricsReady ? (u.adminTotalProfit ?? u.totalProfit ?? 0) : (u.totalProfit ?? u.adminTotalProfit ?? 0));
  return {
    id: u.id,
    name: u.displayName || u.username || u.name || 'Utilisateur',
    email: u.email || null,
    phone: u.phone || u.whatsapp || null,
    country: u.country || null,
    balance: Number(u.balance || 0),
    totalOrders: orderCount,
    totalSpent: spent,
    totalProfit: profit,
    lastOrderAt: u.adminLastOrderAt || null,
    lastOrderAtMs: Number(u.adminLastOrderAtMs || 0),
    createdAt: u.createdAt || u.created_at || null,
    lastSignIn: u.lastSignIn || u.lastLoginAt || null,
    lastActivityAt: u.lastActivityAt || u.lastSeenAt || u.lastDashboardVisit || u.lastSignIn || u.lastLoginAt || null,
    lastOrderAt: u.adminLastOrderAt || null,
    lastOrderAtMs: Number(u.adminLastOrderAtMs || 0),
    resellerLevel: u.resellerLevel || null,
    hasOrdered: orderCount > 0,
    metricsReady,
  };
}

adminRouter.post('/customers/rebuild-order-metrics', async (req, res) => {
  let rebuildLockRef = null;
  let rebuildDayKey = localDateKey(new Date());
  try {
    if (req.body?.confirm !== true) return res.status(400).json({ success: false, error: 'Confirmation explicite requise.' });

    // La reconstruction complète peut parcourir tout l'historique. Une
    // transaction Firestore interdit une seconde tentative le même jour,
    // même si une autre instance Vercel reçoit la requête.
    rebuildLockRef = db.collection('adminDashboardSettings').doc('customerOrderMetricsRebuildLock');
    let alreadyAttemptedToday = false;
    await db.runTransaction(async tx => {
      const lockSnap = await tx.get(rebuildLockRef);
      const lockData = lockSnap.exists ? (lockSnap.data() || {}) : {};
      if (lockData.dayKey === rebuildDayKey) {
        alreadyAttemptedToday = true;
        return;
      }
      tx.set(rebuildLockRef, {
        dayKey: rebuildDayKey,
        status: 'running',
        startedAt: admin.firestore.FieldValue.serverTimestamp(),
      }, { merge: true });
    });
    if (alreadyAttemptedToday) {
      return res.status(429).json({
        success: false,
        code: 'DAILY_REBUILD_LIMIT',
        error: 'Le recalcul historique a déjà été lancé aujourd’hui. Pour protéger le quota Firestore, une seule tentative est autorisée par jour. Réessayez demain.',
      });
    }
    // Empêche de présenter un ancien classement comme exact pendant un recalcul.
    await setSharedAdminCache('customerOrderMetricsState', {
      version: 1, rebuilding: true, startedAt: new Date().toISOString(),
    }, 60 * 60 * 1000);
    adminMemoryCache.topUsers.data = null; adminMemoryCache.topUsers.expires = 0;
    const metricMap = new Map();
    let ordersRead = 0, unattributedOrders = 0, unattributedAmounts = 0, excludedOrders = 0;

    // Une lecture séquentielle paginée par collection. Chaque document est lu
    // une seule fois, puis attribué à toutes les identités utilisateur qu'il
    // porte, exactement comme la fiche client qui recherche les cinq champs.
    for (const collectionName of ADMIN_ORDER_COLLECTIONS) {
      let last = null;
      while (true) {
        let q = db.collection(collectionName).orderBy(admin.firestore.FieldPath.documentId()).limit(500);
        if (last) q = q.startAfter(last);
        const page = await q.get();
        if (page.empty) break;
        for (const doc of page.docs) {
          ordersRead++;
          const order = doc.data() || {};
          const ownerIds = getCustomerOrderOwnerIds(order);
          const contribution = getCustomerOrderContribution(order, collectionName);
          if (!ownerIds.length) {
            if (contribution.included) unattributedOrders++;
            continue;
          }
          if (!contribution.included) {
            excludedOrders++;
            continue;
          }
          if (contribution.amount === null) unattributedAmounts++;
          ownerIds.forEach(uid => {
            const current = metricMap.get(uid) || { count: 0, spent: 0, profit: 0, lastOrderAtMs: 0 };
            current.count++;
            const orderTimeMs = getTimestampMs(order.createdAt || order.date || order.created_at || order.dateCreated || order.timestamp);
            if (orderTimeMs > current.lastOrderAtMs) current.lastOrderAtMs = orderTimeMs;
            if (contribution.amount !== null) current.spent += Number(contribution.amount || 0);
            if (contribution.profit !== null) current.profit += contribution.profit;
            metricMap.set(uid, current);
          });
        }
        last = page.docs[page.docs.length - 1];
        if (page.size < 500) break;
      }
    }

    let usersRead = 0, changed = 0, userLast = null;
    const rebuiltUsersCache = [];
    while (true) {
      let q = db.collection('users').orderBy(admin.firestore.FieldPath.documentId()).limit(500);
      if (userLast) q = q.startAfter(userLast);
      const page = await q.get();
      if (page.empty) break;
      usersRead += page.size;
      let batch = db.batch(), writes = 0;
      for (const doc of page.docs) {
        const expected = metricMap.get(doc.id) || { count: 0, spent: 0, profit: 0, lastOrderAtMs: 0 };
        const u = doc.data() || {};
        const oldCount = Number(u.adminOrderCount);
        const oldSpent = Number(u.adminTotalSpent);
        const oldProfit = Number(u.adminTotalProfit);
        const oldVersion = Number(u.adminOrderMetricsVersion || 0);
        const rebuiltUser = {
          ...u,
          id: doc.id,
          adminOrderCount: expected.count,
          adminTotalSpent: Math.round(expected.spent),
          adminTotalProfit: Math.round(expected.profit),
          adminLastOrderAtMs: Number(expected.lastOrderAtMs || 0),
          adminLastOrderAt: expected.lastOrderAtMs ? admin.firestore.Timestamp.fromMillis(expected.lastOrderAtMs) : null,
          adminOrderMetricsVersion: CUSTOMER_ORDER_METRICS_VERSION,
          _createdAtMs: getTimestampMs(u.createdAt || u.created_at || u.dateCreated || u.timestamp),
        };
        rebuiltUsersCache.push(rebuiltUser);
        const changedNow = oldCount !== expected.count || oldVersion !== CUSTOMER_ORDER_METRICS_VERSION
          || !Number.isFinite(oldSpent) || Math.round(oldSpent) !== Math.round(expected.spent)
          || !Number.isFinite(oldProfit) || Math.round(oldProfit) !== Math.round(expected.profit)
          || Number(u.adminLastOrderAtMs || 0) !== Number(expected.lastOrderAtMs || 0);
        if (changedNow) {
          batch.set(doc.ref, {
            adminOrderCount: expected.count,
            adminTotalSpent: Math.round(expected.spent),
            adminTotalProfit: Math.round(expected.profit),
            adminLastOrderAtMs: Number(expected.lastOrderAtMs || 0),
            adminLastOrderAt: expected.lastOrderAtMs ? admin.firestore.Timestamp.fromMillis(expected.lastOrderAtMs) : null,
            adminOrderMetricsVersion: CUSTOMER_ORDER_METRICS_VERSION,
            adminOrderMetricsUpdatedAt: admin.firestore.FieldValue.serverTimestamp(),
          }, { merge: true });
          writes++; changed++;
        }
        if (writes >= 400) { await batch.commit(); batch = db.batch(); writes = 0; }
      }
      if (writes) await batch.commit();
      userLast = page.docs[page.docs.length - 1];
      if (page.size < 500) break;
    }

    const completedAt = new Date().toISOString();
    await setSharedAdminCache('customerOrderMetricsState', {
      version: CUSTOMER_ORDER_METRICS_VERSION, completedAt, ordersRead, usersRead, changed,
      unattributedOrders, unattributedAmounts, excludedOrders,
      rule: 'Commandes payées en attente, en cours et terminées incluses dans le volume, les dépenses et la marge ; annulations/rejets exclus. Les coûts manquants sont estimés avec le multiplicateur fournisseur connu.',
    }, 60 * 60 * 24 * 365 * 1000);

    await rebuildLockRef.set({
      dayKey: rebuildDayKey, status: 'completed', completedAt,
      ordersRead, usersRead, changed,
    }, { merge: true });

    await Promise.all(['overview','topUsers','usersStats'].map(key => setSharedAdminCache(key, null, 1000)));
    rebuiltUsersCache.sort((a, b) => b._createdAtMs - a._createdAtMs);
    allUsersCache.data = rebuiltUsersCache;
    allUsersCache.expires = Date.now() + ALL_USERS_CACHE_TTL_MS;
    allUsersCache.lastRefresh = Date.now();
    const rebuiltShardKeys = [];
    for (let i = 0; i < rebuiltUsersCache.length; i += CUSTOMER_INDEX_SHARD_SIZE) {
      const key = `customer-index-v${CUSTOMER_INDEX_VERSION}-part-${String(i / CUSTOMER_INDEX_SHARD_SIZE).padStart(3, '0')}`;
      rebuiltShardKeys.push(key);
      await setSharedAdminCache(key, rebuiltUsersCache.slice(i, i + CUSTOMER_INDEX_SHARD_SIZE).map(u => ({
        id: u.id, displayName: u.displayName || null, username: u.username || null, name: u.name || null,
        email: u.email || null, phone: u.phone || null, whatsapp: u.whatsapp || null,
        country: u.country || u.countryCode || u.country_code || null, balance: Number(u.balance || 0),
        totalOrders: Number(u.totalOrders || 0), totalSpent: Number(u.totalSpent || 0), totalProfit: Number(u.totalProfit || 0),
        adminOrderCount: Number(u.adminOrderCount || 0), adminTotalSpent: Number(u.adminTotalSpent || 0),
        adminTotalProfit: Number(u.adminTotalProfit || 0), adminOrderMetricsVersion: Number(u.adminOrderMetricsVersion || 0),
        adminLastOrderAt: u.adminLastOrderAt || null, adminLastOrderAtMs: Number(u.adminLastOrderAtMs || 0),
        createdAt: u.createdAt || null, created_at: u.created_at || null, dateCreated: u.dateCreated || null, timestamp: u.timestamp || null,
        lastSignIn: u.lastSignIn || null, lastLoginAt: u.lastLoginAt || null, lastActivityAt: u.lastActivityAt || null,
        lastSeenAt: u.lastSeenAt || null, lastDashboardVisit: u.lastDashboardVisit || null,
        resellerLevel: u.resellerLevel || null,
        _createdAtMs: getTimestampMs(u.createdAt || u.created_at || u.dateCreated || u.timestamp),
      })), CUSTOMER_INDEX_TTL_MS);
    }
    await setSharedAdminCache('customer-index-v3-meta', {
      version: CUSTOMER_INDEX_VERSION, count: rebuiltUsersCache.length, shards: rebuiltShardKeys,
      generatedAt: new Date().toISOString(),
    }, CUSTOMER_INDEX_TTL_MS);
    for (const key of ['overview', 'topUsers', 'usersStats']) {
      if (adminMemoryCache[key]) { adminMemoryCache[key].data = null; adminMemoryCache[key].expires = 0; }
    }
    topUsersTodayCache.data = null; topUsersTodayCache.expires = 0;
    topUsersCustomRangeCache.clear();

    return res.json({
      success: true, metricsReady: true, version: CUSTOMER_ORDER_METRICS_VERSION, completedAt,
      ordersRead, usersRead, changed, unattributedOrders, unattributedAmounts, excludedOrders,
      message: `Historique recalculé à partir de ${ordersRead.toLocaleString('fr-FR')} commandes.`,
    });
  } catch (error) {
    console.error('Erreur rebuild adminOrderMetrics:', error);
    if (rebuildLockRef) {
      try {
        await rebuildLockRef.set({ dayKey: rebuildDayKey, status: 'failed', failedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
      } catch (_) {}
    }
    return res.status(500).json({ success: false, error: 'Le recalcul historique a échoué. Pour protéger le quota, une nouvelle tentative ne sera possible que demain.' });
  }
});

adminRouter.post('/customers/:id/email', async (req, res) => {
  try {
    if (!process.env.RESEND_API_KEY || !process.env.RESEND_FROM_EMAIL) {
      return res.status(503).json({ success: false, error: 'RESEND_API_KEY et RESEND_FROM_EMAIL doivent être configurés.' });
    }
    const userId = String(req.params.id || '').trim();
    const userSnap = await db.collection('users').doc(userId).get();
    if (!userSnap.exists) return res.status(404).json({ success: false, error: 'Utilisateur introuvable.' });
    const user = userSnap.data() || {};
    const email = String(user.email || '').trim();
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ success: false, error: 'Cet utilisateur ne possède pas d’adresse email valide.' });
    }
    const subject = String(req.body?.subject || '').trim().slice(0, 180);
    const message = String(req.body?.message || '').trim().slice(0, 12000);
    if (!subject || !message) return res.status(400).json({ success: false, error: 'Objet et message obligatoires.' });

    const result = await sendAdminUserMessage({
      to: email,
      subject,
      bodyText: message,
      ctaLabel: 'Accéder à mon tableau de bord',
      ctaUrl: SBH_DASHBOARD,
    });

    if (!result.success) {
      return res.status(502).json({ success: false, error: result.error || 'Le fournisseur email a refusé l’envoi.' });
    }

    return res.json({
      success: true,
      status: 'accepted',
      providerId: result.id || null,
      recipient: email.replace(/^(.).+(@.*)$/, '$1***$2'),
    });
  } catch (error) {
    console.error('Erreur /api/admin/customers/:id/email:', error);
    return res.status(500).json({ success: false, error: 'Impossible d’envoyer cet email.' });
  }
});


adminRouter.post('/deposits/:source/:docId/verify-status', async (req, res) => {
  try {
    const source = String(req.params.source || '').trim();
    const docId = String(req.params.docId || '').trim();
    if (!source || !docId) return res.status(400).json({ success: false, error: 'Recharge invalide.' });
    const transRef = db.collection(source).doc(docId);
    const transDoc = await transRef.get();
    if (!transDoc.exists) return res.status(404).json({ success: false, error: 'Transaction introuvable.' });
    const result = await verifyAdminDepositDocument(transRef, transDoc.data() || {}, source);
    return res.json({ success: true, ...result, transaction: { id: transDoc.id, ...transDoc.data() }, message: `Recharge ${docId} vérifiée.` });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

adminRouter.get('/customers/:id', async (req, res) => {
  try {
    const userId = String(req.params.id || '').trim();
    if (!userId) return res.status(400).json({ success: false, error: 'Identifiant utilisateur requis.' });
    const userDoc = await db.collection('users').doc(userId).get();
    if (!userDoc.exists) return res.status(404).json({ success: false, error: 'Utilisateur introuvable.' });
    const u = userDoc.data() || {};

    const collectionRows = await fetchCustomerOrderDocuments(userId);
    const all = [];
    const countsByCollection = {};
    const excludedOrdersByCollection = {};
    let derivedSpendPriceXAF = 0, exactOrderCount = 0, unattributedAmountCount = 0;
    let totalGrossProfitXAF = 0, profitEligibleOrders = 0, profitUnavailableOrders = 0, excludedOrderCount = 0;
    let lastOrderAt = null;

    for (const row of collectionRows) {
      let includedCount = 0, excludedCount = 0;
      for (const doc of row.docs) {
        const order = doc.data() || {};
        const contribution = getCustomerOrderContribution(order, row.collectionName);
        const financials = contribution.financials || getOrderFinancials(
          order,
          order.provider || order.fournisseur || order.providerName || order.supplier || (row.collectionName === 'commandes' ? 'EXO' : null),
          row.collectionName
        );
        const createdAt = order.createdAt || order.date || order.created_at || order.dateCreated || order.timestamp || null;
        const included = contribution.included;
        if (included) {
          includedCount++;
          exactOrderCount++;
          if (contribution.amount === null) unattributedAmountCount++;
          else derivedSpendPriceXAF += Number(contribution.amount || 0);
          if (contribution.profitEligible) {
            if (contribution.profit !== null) {
              totalGrossProfitXAF += contribution.profit;
              profitEligibleOrders++;
            } else {
              profitUnavailableOrders++;
            }
          }
          if (!lastOrderAt || getTimestampMs(createdAt) > getTimestampMs(lastOrderAt)) lastOrderAt = createdAt;
        } else {
          excludedCount++;
          excludedOrderCount++;
        }
        all.push({
          id: doc.id,
          source: row.collectionName,
          ...order,
          normalizedAmount: financials.amount,
          normalizedProvider: financials.provider,
          normalizedProviderCost: financials.providerCostXAF,
          normalizedProfit: contribution.profit,
          normalizedMarginPct: contribution.profit !== null && financials.amount > 0
            ? Math.round((contribution.profit / financials.amount) * 10000) / 100 : null,
          providerCostEstimated: financials.providerCostEstimated,
          profitEstimated: financials.profitEstimated,
          includedInCustomerMetrics: included,
        });
      }
      countsByCollection[row.collectionName] = includedCount;
      excludedOrdersByCollection[row.collectionName] = excludedCount;
    }

    all.sort((a, b) => getTimestampMs(b.createdAt || b.date || b.created_at || b.dateCreated || b.timestamp) - getTimestampMs(a.createdAt || a.date || a.created_at || a.dateCreated || a.timestamp));
    const orders = all.slice(0, 50).map(o => ({
      id: o.id, source: o.source, orderId: o.orderId || o.reference || o.order_id || o.id,
      serviceName: o.serviceName || o.service_name || o.name || 'Service',
      quantity: Number(o.quantity || o.qty || o.count || 0),
      provider: o.normalizedProvider || null,
      status: o.status || o.orderStatus || o.state || 'Inconnu',
      amount: o.normalizedAmount,
      providerCostXAF: o.normalizedProviderCost,
      grossProfitXAF: o.includedInCustomerMetrics ? o.normalizedProfit : null,
      profitMarginPct: o.includedInCustomerMetrics ? o.normalizedMarginPct : null,
      providerCostEstimated: o.providerCostEstimated,
      profitEstimated: o.profitEstimated,
      includedInCustomerMetrics: o.includedInCustomerMetrics,
      createdAt: o.createdAt || o.date || o.dateCreated || o.created_at || o.timestamp || null,
    }));

    const lastActivityAt = u.lastActivityAt || u.lastSeenAt || u.lastDashboardVisit || u.lastSignIn || u.lastLoginAt || null;
    const signupAt = u.createdAt || u.created_at || u.dateCreated || u.timestamp || null;
    const customer = {
      id: userDoc.id,
      name: u.displayName || u.username || u.name || 'Utilisateur',
      email: u.email || null,
      phone: u.phone || u.whatsapp || null,
      country: u.country || null,
      balance: Number(u.balance || 0),
      totalOrders: exactOrderCount,
      totalSpent: Math.round(derivedSpendPriceXAF),
      totalGrossProfitXAF: Math.round(totalGrossProfitXAF),
      profitEligibleOrders,
      profitUnavailableOrders,
      createdAt: signupAt,
      lastSignIn: u.lastSignIn || u.lastLoginAt || null,
      lastActivityAt,
      lastOrderAt,
      resellerLevel: u.resellerLevel || null,
    };
    return res.json({
      success: true, customer, orders,
      exactOrderCount,
      derivedSpendPriceXAF: Math.round(derivedSpendPriceXAF),
      totalGrossProfitXAF: Math.round(totalGrossProfitXAF),
      profitEligibleOrders,
      profitUnavailableOrders,
      storedTotalSpent: Number(u.totalSpent || 0),
      countsByCollection,
      excludedOrdersByCollection,
      excludedOrderCount,
      ordersReturned: orders.length,
      capped: all.length > orders.length,
      unattributedAmountCount,
      spendNote: 'Le volume et les dépenses incluent les commandes en attente, en cours et terminées ; les commandes annulées ou rejetées sont exclues. La marge brute est calculée sur les commandes réussies, terminées ou en cours, comme dans le classement.',
    });
  } catch (error) {
    console.error('Erreur /api/admin/customers/:id:', error);
    return res.status(500).json({ success: false, error: 'Impossible de charger la fiche utilisateur.' });
  }
});

function escapeHtmlEmail(value) {
  return String(value == null ? '' : value).slice(0, 5000)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

adminRouter.get('/gifts/:id/recipient', async (req, res) => {
  try {
    const giftDoc = await db.collection('welcomeGiftClaims').doc(String(req.params.id)).get();
    if (!giftDoc.exists) return res.status(404).json({ success: false, error: 'Demande de cadeau introuvable.' });
    const gift = giftDoc.data() || {};
    let email = String(gift.email || '').trim();
    if (!email && gift.userId) {
      const userDoc = await db.collection('users').doc(String(gift.userId)).get();
      if (userDoc.exists) email = String(userDoc.data().email || '').trim();
    }
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(404).json({ success: false, error: 'Aucune adresse email valide associée à ce cadeau.' });
    }
    return res.json({ success: true, email, userName: gift.userName || null });
  } catch (error) {
    console.error('Erreur /api/admin/gifts/:id/recipient:', error);
    return res.status(500).json({ success: false, error: 'Impossible de résoudre le destinataire.' });
  }
});

function buildGiftEmailServerTemplate(gift, type) {
  const name = String(gift.userName || 'cher client').slice(0, 120);
  const gt = giftPlainLabel(gift.giftType);
  const createdAtFormatted = gift.createdAt
    ? new Date(getTimestampMs(gift.createdAt)).toLocaleString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric' })
    : 'date récente';
  const ageLabel = giftAgeLabel(gift.createdAt);
  const needsLink = giftNeedsLinkConfirmation(gift.giftType);
  const link = gift.link || '(non fourni)';
  const country = gift.country ? `🌍 Pays : ${gift.country}\n` : '';
  const dashboardLine = `🔗 Votre tableau de bord : ${SBH_DASHBOARD}`;
  const waLine = `💬 Besoin d'aide ? Contactez-nous sur WhatsApp : ${SBH_WA_DISPLAY}\n   ${SBH_WA_LINK}`;

  if (type === 'confirmation') {
    if (!needsLink) {
      return `Bonjour ${name},

Nous espérons sincèrement que vous allez bien et que vous profitez pleinement de votre expérience sur Social Boost Horizon.

NOUS AVONS UNE BONNE NOUVELLE POUR VOUS !
Votre cadeau de bienvenue a bien été enregistré :

🎁 Cadeau : ${gt}
📅 Demandé le : ${createdAtFormatted} (${ageLabel})
${country}
Nous avons bien noté votre demande et notre équipe est en train de finaliser le crédit sur votre compte. Aucune action n'est requise de votre part — nous nous occupons de tout.

UNE FOIS LE CRÉDIT EFFECTUÉ
• Votre solde sera automatiquement mis à jour
• Vous pourrez consulter votre nouveau solde en vous connectant à votre tableau de bord
• Vous pourrez utiliser ce crédit pour passer des commandes ou recharger davantage

${dashboardLine}

DÉCOUVREZ NOS NOUVEAUTÉS
Boost de vos réseaux sociaux (Instagram, TikTok, Facebook, YouTube…), création de boutique en ligne personnalisée, accompagnement digital et bien plus encore. Notre équipe est là pour vous accompagner dans tous vos projets digitaux.

${waLine}

Merci de votre confiance et à très bientôt sur Social Boost Horizon.

Cordialement,
L'équipe Social Boost Horizon`;
    }
    return `Bonjour ${name},

Nous espérons sincèrement que vous allez bien. Nous vous contactons au sujet de votre demande de cadeau de bienvenue enregistrée le ${createdAtFormatted}.

RÉCAPITULATIF DE VOTRE DEMANDE :
• Type de cadeau : ${gt}
• Date de la demande : ${createdAtFormatted} (${ageLabel})
${gift.country ? `• Pays : ${gift.country}\n` : ''}• Lien à créditer : ${link}

⚠️ ACTION REQUISE : Nous avons besoin que vous CONFIRMIEZ le lien ci-dessus avant de pouvoir lancer votre cadeau. Sans cette confirmation, nous ne serons pas en mesure de procéder à la livraison.

Merci de répondre simplement à cet email avec « OUI » pour confirmer, ou de nous envoyer le bon lien si celui-ci est incorrect.

Une fois votre confirmation reçue, votre cadeau sera traité en PRIORITÉ par notre équipe.

${dashboardLine}

DÉCOUVREZ NOS NOUVEAUTÉS
Boost réseaux sociaux, création de boutique en ligne, accompagnement digital… Il y a beaucoup à découvrir sur Social Boost Horizon. Nous serions ravis de vous y retrouver.

${waLine}

Merci de votre confiance et à très bientôt sur Social Boost Horizon.

Cordialement,
L'équipe Social Boost Horizon`;
  }

  if (type === 'launched') {
    if (!needsLink) {
      return `Bonjour ${name},

Bonne nouvelle ! Votre cadeau de bienvenue a été TRAITÉ avec succès par notre équipe.

🎁 Cadeau : ${gt}
📅 Demandé le : ${createdAtFormatted} (${ageLabel})
${country}
VÉRIFIEZ VOTRE SOLDE MAINTENANT
Votre crédit a été ajouté à votre compte. Rendez-vous sur votre tableau de bord pour vérifier votre nouveau solde et commencer à passer vos commandes :

${dashboardLine}

VOUS AVEZ BESOIN D'AUTRE CHOSE ?
• Recharger votre solde pour commander davantage
• Découvrir nos services de boost réseaux sociaux (Instagram, TikTok, Facebook, YouTube…)
• Créer votre boutique en ligne personnalisée
• Profiter de notre accompagnement digital

${waLine}

Merci de votre confiance et à très bientôt sur Social Boost Horizon.

Cordialement,
L'équipe Social Boost Horizon`;
    }
    return `Bonjour ${name},

Nous avons le plaisir de vous informer que votre cadeau de bienvenue est désormais en cours de traitement par notre équipe.

RÉCAPITULATIF :
• Cadeau : ${gt}
• Demandé le : ${createdAtFormatted} (${ageLabel})
${country}• Lien crédité : ${link}

Notre équipe met tout en œuvre pour finaliser votre commande dans les meilleurs délais. Vous recevrez votre cadeau très prochainement.

DÉCOUVREZ NOS NOUVEAUTÉS
Boost réseaux sociaux, création de boutique en ligne, accompagnement digital et bien plus encore. Nous serions ravis de vous accompagner dans tous vos projets digitaux.

${waLine}

Merci de votre patience et de votre confiance.

Cordialement,
L'équipe Social Boost Horizon`;
  }

  if (type === 'delay') {
    if (!needsLink) {
      return `Bonjour ${name},

Nous vous contactons concernant votre demande de cadeau de bienvenue effectuée le ${createdAtFormatted}, soit ${ageLabel}.

Nous tenons à vous présenter nos plus sincères excuses pour ce retard. Nous comprenons parfaitement votre impatience et nous mettons tout en œuvre pour résoudre cette situation dans les plus brefs délais.

RÉCAPITULATIF DE VOTRE DEMANDE :
• Cadeau : ${gt}
• Demandé le : ${createdAtFormatted} (${ageLabel})
${country}
BONNE NOUVELLE : Aucune action n'est requise de votre part. Notre équipe traite votre demande en PRIORITÉ et votre crédit sera automatiquement ajouté à votre compte. Vous pourrez vérifier votre solde depuis votre tableau de bord :

${dashboardLine}

${waLine}

Merci de votre compréhension et de votre patience.

Cordialement,
L'équipe Social Boost Horizon`;
    }
    return `Bonjour ${name},

Nous vous contactons concernant votre demande de cadeau de bienvenue effectuée le ${createdAtFormatted}, soit ${ageLabel}.

Nous tenons à vous présenter nos plus sincères excuses pour ce retard. Nous comprenons parfaitement votre impatience et nous mettons tout en œuvre pour résoudre cette situation dans les plus brefs délais.

RÉCAPITULATIF :
• Cadeau : ${gt}
• Demandé le : ${createdAtFormatted} (${ageLabel})
${country}• Lien à créditer : ${link}

⚠️ ACTION REQUISE : Pour que nous puissions lancer immédiatement votre cadeau, nous avons besoin que vous CONFIRMIEZ que le lien suivant est bien celui à créditer :
${link}

Merci de répondre à cet email avec « OUI » pour confirmer, ou de nous envoyer le bon lien si celui-ci n'est pas correct. Sans cette confirmation, nous ne serons pas en mesure de finaliser votre cadeau.

Dès réception de votre confirmation, votre demande sera traitée en PRIORITÉ ABSOLUE par notre équipe.

${waLine}

Nous vous remercions de votre compréhension et de votre patience.

Cordialement,
L'équipe Social Boost Horizon`;
  }

  if (type === 'delivered') {
    if (!needsLink) {
      return `Bonjour ${name},

C'est avec plaisir que nous vous confirmons que votre cadeau de bienvenue a été LIVRÉ AVEC SUCCÈS.

🎁 Cadeau : ${gt}
📅 Demandé le : ${createdAtFormatted} (${ageLabel})
${country}
VÉRIFIEZ MAINTENANT
Votre crédit a bien été ajouté à votre solde. Connectez-vous à votre tableau de bord pour confirmer votre nouveau solde :

${dashboardLine}

ET MAINTENANT, PLACE À L'ACTION !
• Recharger votre solde pour passer plus de commandes
• Commander du boost pour vos réseaux sociaux (Instagram, TikTok, Facebook, YouTube…)
• Créer votre propre boutique en ligne personnalisée
• Bénéficier de notre accompagnement digital

${waLine}

Merci de votre confiance et à très bientôt sur Social Boost Horizon.

Cordialement,
L'équipe Social Boost Horizon`;
    }
    return `Bonjour ${name},

C'est avec plaisir que nous vous confirmons que votre cadeau de bienvenue a été LIVRÉ AVEC SUCCÈS.

🎁 Cadeau : ${gt}
📅 Demandé le : ${createdAtFormatted} (${ageLabel})
${country}• Lien crédité : ${link}

VÉRIFIEZ MAINTENANT
Votre cadeau a bien été appliqué sur le lien fourni. Nous vous invitons à vérifier votre compte concerné pour constater le résultat :

${dashboardLine}

ET MAINTENANT, PLACE À L'ACTION !
• Recharger votre solde pour passer plus de commandes
• Découvrir nos services de boost réseaux sociaux
• Créer votre propre boutique en ligne
• Profiter de notre accompagnement digital

${waLine}

Merci de votre confiance et à très bientôt sur Social Boost Horizon.

Cordialement,
L'équipe Social Boost Horizon`;
  }

  return '';
}

adminRouter.post('/gifts/:id/email', async (req, res) => {
  try {
    const { type, customMessage } = req.body || {};
    const validTypes = ['confirmation', 'launched', 'delay', 'delivered', 'custom'];
    if (!validTypes.includes(type)) return res.status(400).json({ success: false, error: 'Type de message invalide.' });
    if (!process.env.RESEND_API_KEY || !process.env.RESEND_FROM_EMAIL) {
      return res.status(503).json({ success: false, error: 'Configurez RESEND_API_KEY et RESEND_FROM_EMAIL avant l’envoi.' });
    }
    const giftRef = db.collection('welcomeGiftClaims').doc(String(req.params.id));
    const giftDoc = await giftRef.get();
    if (!giftDoc.exists) return res.status(404).json({ success: false, error: 'Demande de cadeau introuvable.' });
    const gift = giftDoc.data() || {};
    let email = String(gift.email || '').trim();
    if (!email && gift.userId) {
      const userDoc = await db.collection('users').doc(String(gift.userId)).get();
      if (userDoc.exists) email = String(userDoc.data().email || '').trim();
    }
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ success: false, error: 'Aucune adresse email valide associée à ce cadeau.' });
    }

    let bodyText;
    if (customMessage && String(customMessage).trim().length > 0) {
      bodyText = String(customMessage).trim();
    } else {
      bodyText = buildGiftEmailServerTemplate(gift, type);
      if (!bodyText) {
        return res.status(400).json({ success: false, error: 'Le message est vide et aucun template n\'a pu être généré.' });
      }
    }

    const subjectBase = {
      confirmation: giftNeedsLinkConfirmation(gift.giftType)
        ? 'Confirmation requise : votre cadeau de bienvenue — Social Boost Horizon'
        : 'Votre cadeau de bienvenue a bien été enregistré — Social Boost Horizon',
      launched: giftNeedsLinkConfirmation(gift.giftType)
        ? 'Bonne nouvelle : votre cadeau est en cours de traitement — Social Boost Horizon'
        : 'Bonne nouvelle : votre cadeau a été traité — Social Boost Horizon',
      delay: giftNeedsLinkConfirmation(gift.giftType)
        ? 'Nos excuses pour le retard + confirmation requise — Social Boost Horizon'
        : 'Nos excuses pour le retard — Social Boost Horizon',
      delivered: giftNeedsLinkConfirmation(gift.giftType)
        ? 'Votre cadeau a été livré avec succès — Social Boost Horizon'
        : 'Votre solde a été crédité avec succès — Social Boost Horizon',
      custom: 'Message de Social Boost Horizon',
    };
    const subject = subjectBase[type] || 'Message de Social Boost Horizon';

    const result = await sendAdminUserMessage({
      to: email,
      subject,
      bodyText,
      ctaLabel: 'Accéder à mon tableau de bord',
      ctaUrl: SBH_DASHBOARD,
    });

    if (!result.success) {
      return res.status(502).json({ success: false, error: result.error || 'Le fournisseur email a refusé l’envoi.' });
    }

    await giftRef.update({
      lastEmailAt: admin.firestore.FieldValue.serverTimestamp(),
      lastEmailType: type,
      lastEmailStatus: 'accepted',
      lastEmailProviderId: result.id || null,
    });
    clearGiftsCache();

    res.json({
      success: true,
      email: email.replace(/^(.).+(@.*)$/, '$1***$2'),
      providerId: result.id || null,
      status: 'accepted',
      messageLength: bodyText.length,
    });
  } catch (error) {
    console.error('Erreur /api/admin/gifts/:id/email:', error);
    res.status(500).json({ success: false, error: 'Erreur pendant l’envoi du message.' });
  }
});

function financialWindow(range) {
  const now = new Date();
  const dayMs = 24 * 60 * 60 * 1000;
  const businessOffsetMs = 60 * 60 * 1000;
  const localNow = new Date(now.getTime() + businessOffsetMs);
  const startOfToday = new Date(Date.UTC(localNow.getUTCFullYear(), localNow.getUTCMonth(), localNow.getUTCDate()) - businessOffsetMs);
  if (range === 'all') return { start: null, end: null, previousStart: null, previousEnd: null };
  if (range === 'today') return { start: startOfToday, end: now, previousStart: new Date(startOfToday.getTime() - dayMs), previousEnd: new Date(now.getTime() - dayMs) };
  if (range === 'yesterday') {
    const start = new Date(startOfToday.getTime() - dayMs);
    return { start, end: startOfToday, previousStart: new Date(start.getTime() - dayMs), previousEnd: start };
  }
  if (range === 'dayBefore') {
    const start = new Date(startOfToday.getTime() - 2 * dayMs);
    const end = new Date(startOfToday.getTime() - dayMs);
    return { start, end, previousStart: new Date(start.getTime() - dayMs), previousEnd: start };
  }
  if (range === 'year') {
    const start = new Date(Date.UTC(localNow.getUTCFullYear(), 0, 1) - businessOffsetMs);
    const previousStart = new Date(Date.UTC(localNow.getUTCFullYear() - 1, 0, 1) - businessOffsetMs);
    const previousEnd = new Date(Date.UTC(localNow.getUTCFullYear() - 1, localNow.getUTCMonth(), localNow.getUTCDate(), localNow.getUTCHours(), localNow.getUTCMinutes(), localNow.getUTCSeconds()) - businessOffsetMs);
    return { start, end: now, previousStart, previousEnd };
  }
  if (range === 'month') {
    const start = new Date(Date.UTC(localNow.getUTCFullYear(), localNow.getUTCMonth(), 1) - businessOffsetMs);
    const elapsed = now.getTime() - start.getTime();
    return { start, end: now, previousStart: new Date(start.getTime() - elapsed), previousEnd: start };
  }
  const durationDays = range === '7d' ? 7 : range === '90d' ? 90 : 30;
  const durationMs = durationDays * 24 * 60 * 60 * 1000;
  return { start: new Date(now.getTime() - durationMs), end: now, previousStart: new Date(now.getTime() - 2 * durationMs), previousEnd: new Date(now.getTime() - durationMs) };
}

// Les champs type=date du panneau sont interprétés en heure locale UTC+1
// (Cameroun). La borne de fin est exclusive pour inclure toute la journée choisie.
function parseBusinessDate(value, endExclusive = false) {
  const match = String(value || '').trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const year = Number(match[1]), month = Number(match[2]), day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day + (endExclusive ? 1 : 0)) - 60 * 60 * 1000);
  const check = new Date(Date.UTC(year, month - 1, day));
  if (check.getUTCFullYear() !== year || check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) return null;
  return date;
}

function periodPayloadFromAggregate(range, start, end, agg) {
  const grossMarginAfterRefunds = Number(agg.netSales || 0) - Number(agg.totalSupplierCost || 0);
  return {
    range,
    start: start ? start.toISOString() : null,
    end: end ? end.toISOString() : new Date().toISOString(),
    autoOrdersCount: Number(agg.totalOrders || 0),
    legacyOrdersCount: 0,
    totalOrders: Number(agg.totalOrders || 0),
    autoOrdersGrossSales: Number(agg.totalSales || 0),
    autoOrdersRefunds: Number(agg.totalRefunds || 0),
    autoOrdersNetSales: Number(agg.netSales || 0),
    supplierCostWithSnapshots: Number(agg.totalSupplierCost || 0),
    // Marge de gestion demandée : ventes nettes - coût fournisseur.
    // Les remboursements sont déjà retirés des ventes nettes.
    grossMarginAfterRefunds,
    recordedGrossProfitBeforeRefunds: grossMarginAfterRefunds,
    providerRecordedProfitBeforeRefunds: Number(agg.totalProfit || 0),
    financialScope: 'Les ventes, coûts et marges couvrent toutes les collections de commandes (autoOrders, commandes EXO, etc.).',
  };
}

async function getDashboardVisitsInWindow(start, end) {
  if (!start || !end) return 0;
  const startKey = localDateKey(start);
  const endKey = localDateKey(end);
  const collection = db.collection('dailyCounters');
  const query = collection
    .where(admin.firestore.FieldPath.documentId(), '>=', startKey)
    .where(admin.firestore.FieldPath.documentId(), '<', endKey);
  try {
    const result = await query.aggregate({ total: admin.firestore.AggregateField.sum('dashboardVisits') }).get();
    return Number(result.data()?.total || 0);
  } catch (error) {
    // Compatibilité si l'agrégation sur les IDs de documents n'est pas disponible.
    try {
      const snap = await query.get();
      return snap.docs.reduce((sum, doc) => sum + Number(doc.data()?.dashboardVisits || 0), 0);
    } catch (_) {
      console.warn('Agrégation des visites dashboard indisponible :', error.message);
      return 0;
    }
  }
}

async function buildOverviewRange(start, end, forceRefresh = false) {
  const [financials, newUsersCount, dashboardVisits] = await Promise.all([
    getCachedFinancialAggregate(start, end, forceRefresh),
    countUsersInWindow(start, end),
    getDashboardVisitsInWindow(start, end),
  ]);
  const grossMargin = Number(financials.netSales || 0) - Number(financials.totalSupplierCost || 0);
  return {
    totalOrders: Number(financials.totalOrders || 0),
    autoOrdersNetSales: Number(financials.netSales || 0),
    autoOrdersRefunds: Number(financials.totalRefunds || 0),
    supplierCostWithSnapshots: Number(financials.totalSupplierCost || 0),
    recordedGrossProfitBeforeRefunds: grossMargin,
    grossMarginAfterRefunds: grossMargin,
    newUsersCount: Number(newUsersCount || 0),
    _newUsersCount: Number(newUsersCount || 0),
    dashboardVisits: Number(dashboardVisits || 0),
    start: start.toISOString(),
    end: end.toISOString(),
  };
}

function applyTimeWindow(query, start, end) {
  if (start) query = query.where('createdAt', '>=', admin.firestore.Timestamp.fromDate(start));
  if (end) query = query.where('createdAt', '<', admin.firestore.Timestamp.fromDate(end));
  return query;
}
function applyIsoTimeWindow(query, start, end) {
  if (start) query = query.where('createdAt', '>=', start.toISOString());
  if (end) query = query.where('createdAt', '<', end.toISOString());
  return query;
}
async function countInWindow(collectionRef, start, end) {
  if (!start && !end) {
    const result = await collectionRef.count().get();
    return result.data().count || 0;
  }
  const [timestampResult, isoResult] = await Promise.all([
    applyTimeWindow(collectionRef, start, end).count().get().catch(() => ({ data: () => ({ count: 0 }) })),
    applyIsoTimeWindow(collectionRef, start, end).count().get().catch(() => ({ data: () => ({ count: 0 }) })),
  ]);
  return (timestampResult.data().count || 0) + (isoResult.data().count || 0);
}

async function countCreatedBetween(collectionRef, start, end) {
  return countInWindow(collectionRef, start, end);
}

async function readFinancialPeriod(range, forceRefresh = false) {
  const bounds = financialWindow(range);
  const agg = await getCachedFinancialAggregate(bounds.start, bounds.end, forceRefresh);
  return {
    range,
    start: bounds.start ? bounds.start.toISOString() : null,
    end: bounds.end ? bounds.end.toISOString() : new Date().toISOString(),
    autoOrdersCount: agg.totalOrders,
    legacyOrdersCount: 0,
    totalOrders: agg.totalOrders,
    autoOrdersGrossSales: agg.totalSales,
    autoOrdersRefunds: agg.totalRefunds,
    autoOrdersNetSales: agg.netSales,
    supplierCostWithSnapshots: agg.totalSupplierCost,
    recordedGrossProfitBeforeRefunds: agg.totalProfit,
    financialScope: 'Les ventes, coûts et marges couvrent toutes les collections de commandes (autoOrders, commandes EXO, etc.).',
  };
}

adminRouter.get('/financials', async (req, res) => {
  try {
    const acceptedRanges = ['today', 'yesterday', 'dayBefore', '7d', '30d', '90d', 'month', 'year', 'all'];
    const requestedRange = String(req.query.range || '30d');
    const isCustom = requestedRange === 'custom' || Boolean(req.query.dateStart || req.query.dateEnd);
    const range = isCustom ? 'custom' : (acceptedRanges.includes(requestedRange) ? requestedRange : '30d');
    const forceRefresh = String(req.query.refresh || '') === '1';

    let bounds;
    if (isCustom) {
      const start = parseBusinessDate(req.query.dateStart, false);
      const end = parseBusinessDate(req.query.dateEnd, true);
      if (!start || !end || start >= end) {
        return res.status(400).json({ success: false, error: 'Sélectionnez une date de début et une date de fin valides.' });
      }
      let previousStart = null, previousEnd = null;
      const hasCompareStart = Boolean(req.query.compareStart);
      const hasCompareEnd = Boolean(req.query.compareEnd);
      if (hasCompareStart !== hasCompareEnd) {
        return res.status(400).json({ success: false, error: 'Pour comparer, renseignez les deux dates de la période de comparaison.' });
      }
      if (hasCompareStart && hasCompareEnd) {
        previousStart = parseBusinessDate(req.query.compareStart, false);
        previousEnd = parseBusinessDate(req.query.compareEnd, true);
        if (!previousStart || !previousEnd || previousStart >= previousEnd) {
          return res.status(400).json({ success: false, error: 'Les dates de comparaison sont invalides.' });
        }
      } else {
        const duration = end.getTime() - start.getTime();
        previousEnd = new Date(start.getTime());
        previousStart = new Date(start.getTime() - duration);
      }
      bounds = { start, end, previousStart, previousEnd };
    } else {
      bounds = financialWindow(range);
    }

    const cacheKey = isCustom
      ? `financials:custom:${bounds.start.toISOString()}:${bounds.end.toISOString()}:${bounds.previousStart.toISOString()}:${bounds.previousEnd.toISOString()}`
      : `financials:${range}`;
    const sharedKey = `financials-response-v3-${sha256Short(cacheKey)}`;
    const cached = adminMemoryCache.financialsMap.get(cacheKey);
    if (!forceRefresh && cached && Date.now() < cached.expires) {
      return res.json({ success: true, data: cached.data, previous: cached.previous, cached: true, cacheScope: 'instance' });
    }
    if (!forceRefresh) {
      const shared = await getSharedAdminCache(sharedKey);
      if (shared) {
        const ttl = Math.max(1000, shared.expiresAtMs - Date.now());
        adminMemoryCache.financialsMap.set(cacheKey, { ...shared.payload, expires: Date.now() + ttl });
        return res.json({ success: true, data: shared.payload.data, previous: shared.payload.previous, cached: true, cacheScope: 'shared' });
      }
    }

    let current, previous = null;
    if (isCustom) {
      const [currentAgg, previousAgg] = await Promise.all([
        getCachedFinancialAggregate(bounds.start, bounds.end, forceRefresh),
        getCachedFinancialAggregate(bounds.previousStart, bounds.previousEnd, forceRefresh),
      ]);
      current = periodPayloadFromAggregate('custom', bounds.start, bounds.end, currentAgg);
      previous = periodPayloadFromAggregate('custom-comparison', bounds.previousStart, bounds.previousEnd, previousAgg);
    } else {
      current = await readFinancialPeriod(range, forceRefresh);
      if (bounds.previousStart && bounds.previousEnd) {
        const pAgg = await getCachedFinancialAggregate(bounds.previousStart, bounds.previousEnd, forceRefresh);
        previous = periodPayloadFromAggregate('previous', bounds.previousStart, bounds.previousEnd, pAgg);
      }
      current.grossMarginAfterRefunds = Number(current.autoOrdersNetSales || 0) - Number(current.supplierCostWithSnapshots || 0);
      current.recordedGrossProfitBeforeRefunds = current.grossMarginAfterRefunds;
    }

    const [allAutoOrders, marginSnapshotOrders] = await Promise.all([
      db.collection('autoOrders').count().get(),
      db.collection('autoOrders').where('profitCalculationVersion', '==', 1).count().get(),
    ]);
    current.profitSnapshotOrdersAllTime = marginSnapshotOrders.data().count || 0;
    current.autoOrdersAllTime = allAutoOrders.data().count || 0;
    current.profitSnapshotCoveragePctAllTime = current.autoOrdersAllTime
      ? Math.round(current.profitSnapshotOrdersAllTime / current.autoOrdersAllTime * 1000) / 10
      : 0;
    const salesBase = previous && previous.autoOrdersNetSales > 0 ? previous.autoOrdersNetSales : 0;
    current.netSalesChangePct = previous && salesBase > 0
      ? Math.round(((current.autoOrdersNetSales - previous.autoOrdersNetSales) / salesBase) * 1000) / 10
      : null;
    const orderBase = previous && previous.totalOrders > 0 ? previous.totalOrders : 0;
    current.ordersChangePct = previous && orderBase > 0
      ? Math.round(((current.totalOrders - previous.totalOrders) / orderBase) * 1000) / 10
      : null;
    if (previous) {
      previous.grossMarginAfterRefunds = Number(previous.autoOrdersNetSales || 0) - Number(previous.supplierCostWithSnapshots || 0);
      previous.recordedGrossProfitBeforeRefunds = previous.grossMarginAfterRefunds;
    }

    adminMemoryCache.financialsMap.set(cacheKey, { data: current, previous, expires: Date.now() + 60 * 60 * 1000 });
    await setSharedAdminCache(sharedKey, { data: current, previous }, 60 * 60 * 1000);
    res.json({ success: true, data: current, previous, cached: false, custom: isCustom });
  } catch (error) {
    console.error('Erreur /api/admin/financials:', error);
    res.status(500).json({ success: false, error: 'Impossible de charger les données financières. Vérifiez les index Firestore et les données de commandes.' });
  }
});

// Vue d'ensemble sur une période manuelle : mêmes agrégats financiers, plus
// inscriptions et visites du tableau de bord, avec cache mémoire 15 minutes.
adminRouter.get('/overview-range', async (req, res) => {
  try {
    const start = parseBusinessDate(req.query.dateStart, false);
    const end = parseBusinessDate(req.query.dateEnd, true);
    if (!start || !end || start >= end) {
      return res.status(400).json({ success: false, error: 'Sélectionnez une plage de dates valide.' });
    }
    const hasCompareStart = Boolean(req.query.compareStart);
    const hasCompareEnd = Boolean(req.query.compareEnd);
    if (hasCompareStart !== hasCompareEnd) {
      return res.status(400).json({ success: false, error: 'Pour comparer, renseignez les deux dates de comparaison.' });
    }
    let previousStart = null, previousEnd = null;
    if (hasCompareStart && hasCompareEnd) {
      previousStart = parseBusinessDate(req.query.compareStart, false);
      previousEnd = parseBusinessDate(req.query.compareEnd, true);
      if (!previousStart || !previousEnd || previousStart >= previousEnd) {
        return res.status(400).json({ success: false, error: 'La plage de comparaison est invalide.' });
      }
    } else {
      const duration = end.getTime() - start.getTime();
      previousEnd = new Date(start.getTime());
      previousStart = new Date(start.getTime() - duration);
    }
    const forceRefresh = String(req.query.refresh || '') === '1';
    const key = `${start.toISOString()}|${end.toISOString()}|${previousStart.toISOString()}|${previousEnd.toISOString()}`;
    const sharedKey = `overview-range-response-v3-${sha256Short(key)}`;
    const cached = overviewRangeResponseCache.get(key);
    if (!forceRefresh && cached && Date.now() < cached.expires) {
      return res.json({ success: true, data: cached.data, previous: cached.previous, cached: true, cacheScope: 'instance' });
    }
    if (!forceRefresh) {
      const shared = await getSharedAdminCache(sharedKey);
      if (shared) {
        const ttl = Math.max(1000, shared.expiresAtMs - Date.now());
        overviewRangeResponseCache.set(key, { ...shared.payload, expires: Date.now() + ttl });
        return res.json({ success: true, ...shared.payload, cached: true, cacheScope: 'shared' });
      }
    }
    if (!forceRefresh && OVERVIEW_RANGE_INFLIGHT.has(key)) {
      const result = await OVERVIEW_RANGE_INFLIGHT.get(key);
      return res.json({ success: true, ...result, cached: true, cacheScope: 'inflight' });
    }
    const computePromise = (async () => {
      const [data, previous] = await Promise.all([
        buildOverviewRange(start, end, forceRefresh),
        buildOverviewRange(previousStart, previousEnd, forceRefresh),
      ]);
      const result = { data, previous };
      overviewRangeResponseCache.set(key, { ...result, expires: Date.now() + CUSTOM_RANGE_CACHE_TTL_MS });
      await setSharedAdminCache(sharedKey, result, CUSTOM_RANGE_CACHE_TTL_MS);
      return result;
    })();
    if (!forceRefresh) OVERVIEW_RANGE_INFLIGHT.set(key, computePromise);
    try {
      const result = await computePromise;
      return res.json({ success: true, ...result, cached: false });
    } finally {
      OVERVIEW_RANGE_INFLIGHT.delete(key);
    }
  } catch (error) {
    console.error('Erreur /api/admin/overview-range:', error);
    res.status(500).json({ success: false, error: 'Impossible de calculer les indicateurs de cette période.' });
  }
});

adminRouter.post('/cache/clear', (req, res) => {
  adminMemoryCache.overview.data = null;   adminMemoryCache.overview.expires = 0;
  adminMemoryCache.topUsers.data = null;   adminMemoryCache.topUsers.expires = 0;
  adminMemoryCache.usersStats.data = null; adminMemoryCache.usersStats.expires = 0;
  adminMemoryCache.financialsMap.clear();
  financialRangeAggregateCache.clear();
  overviewRangeResponseCache.clear();
  OVERVIEW_RANGE_INFLIGHT.clear();
  adminMemoryCache.orderSummary.data = null; adminMemoryCache.orderSummary.expires = 0;
  adminMemoryCache.giftsMap.clear();
  allUsersCache.data = null;
  allUsersCache.expires = 0;
  usersCountRangeCache.clear();
  topUsersTodayCache.data = null;
  topUsersTodayCache.expires = 0;
  topUsersCustomRangeCache.clear(); // ✅ FIX : vide aussi le cache custom
  depositsCache.data = null;
  depositsCache.expires = 0;
  ordersCache.data = null;
  ordersCache.expires = 0;
  Object.keys(DATE_FIELD_CACHE).forEach(k => delete DATE_FIELD_CACHE[k]);
  DATE_TYPE_CACHE.clear();
  FINANCIAL_SCHEMA_CACHE.clear();
  PAYMENT_SCHEMA_CACHE.clear();
  res.json({ success: true, message: 'Cache vidé.' });
});

app.use('/api/admin', adminRouter);

try {
  const createPublicRouter = require('./server.js');
  const publicRouter = createPublicRouter({
    db,
    admin,
    callMTP,
    callExo,
    callAfriqueBoost,
    callSmmWiz,
    detectPlatformName,
    MTP_USD_TO_XAF,
    MTP_MULTIPLIER,
    EXO_USD_TO_XAF,
    EXO_MULTIPLIER,
    AFB_MULTIPLIER,
    SMMWIZ_USD_TO_XAF,
    SMMWIZ_MULTIPLIER,
  });
  app.use('/api/v1', publicRouter);
  console.log('✅ Routeur API publique monté sur /api/v1 (codes opaques, sources multiples)');
} catch (err) {
  console.error('❌ Erreur chargement routeur public :', err.message);
}

app.post('/api/partenariat', async (req, res) => {
  try {
    const { name, email, whatsapp, type, message } = req.body || {};

    if (!name || !email || !whatsapp || !type || !message) {
      return res.status(400).json({ success: false, error: 'Tous les champs sont requis.' });
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({ success: false, error: 'Adresse email invalide.' });
    }

    const cleanName     = String(name).trim().slice(0, 120);
    const cleanEmail    = String(email).trim().toLowerCase().slice(0, 120);
    const cleanWhatsapp = String(whatsapp).trim().slice(0, 30);
    const cleanType     = String(type).trim().slice(0, 100);
    const cleanMessage  = String(message).trim().slice(0, 3000);

    if (cleanMessage.length < 20) {
      return res.status(400).json({ success: false, error: 'Merci de détailler davantage votre projet (20 caractères minimum).' });
    }

    const ip = getClientIp(req);
    const ipHash = sha256Short('partner:' + ip);
    const rateRef = db.collection('partnerRequestRateLimits').doc(ipHash);
    const rateDoc = await rateRef.get();
    const lastAt = rateDoc.exists ? getTimestampMs(rateDoc.data().lastAt) : 0;
    if (Date.now() - lastAt < 60 * 1000) {
      return res.status(429).json({
        success: false,
        error: 'Veuillez patienter une minute avant d\'envoyer une nouvelle candidature.',
      });
    }

    const docRef = await db.collection('partnerRequests').add({
      name: cleanName,
      email: cleanEmail,
      whatsapp: cleanWhatsapp,
      type: cleanType,
      message: cleanMessage,
      status: 'new',
      ipHash,
      userAgent: (req.headers['user-agent'] || '').slice(0, 200),
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    await rateRef.set({ lastAt: admin.firestore.FieldValue.serverTimestamp() });

    let emailSent = false;
    try {
      await sendPartnershipEmail({
        name: cleanName,
        email: cleanEmail,
        whatsapp: cleanWhatsapp,
        type: cleanType,
        message: cleanMessage,
        requestId: docRef.id,
      });
      emailSent = true;
    } catch (emailErr) {
      console.error('❌ Erreur envoi email partenariat:', emailErr.message);
    }

    console.log(`📥 Nouvelle candidature partenariat [${docRef.id}] — ${cleanName} (${cleanType}) — email ${emailSent ? 'envoyé' : 'échoué'}`);

    res.json({ success: true, requestId: docRef.id });
  } catch (error) {
    console.error('Erreur /api/partenariat:', error);
    res.status(500).json({ success: false, error: 'Erreur lors du traitement de la candidature. Veuillez réessayer.' });
  }
});

app.use((req, res) => res.status(404).json({ success: false, error: `Route non trouvée : ${req.method} ${req.path}` }));
app.use((err, req, res, next) => {
  res.status(500).json({ success: false, error: err.message || 'Erreur interne.' });
});

module.exports = app;
