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

const SBH_WA_DISPLAY = '+1 (423) 675-2034';
const SBH_WA_LINK    = 'https://wa.me/14236752034';
const SBH_SITE_URL   = 'https://socialboosthorizon.com/';
const SBH_DASHBOARD  = 'https://socialboosthorizon.com/tableau-de-bord.html';

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

    return res.json({ success: true, checkoutUrl });
  } catch (err) {
    clearTimeout(timer);
    return res.status(500).json({ success: false, error: 'Erreur communication avec Fapshi.' });
  }
});

app.post('/api/fapshi-webhook', async (req, res) => {
  const { status, amount, transId } = req.body;
  if (status !== 'SUCCESSFUL') return res.status(200).json({ message: 'Statut ignoré.' });

  const amountNum = Number(amount);
  const transRef = db.collection('fapshiTransactions').doc(transId);

  try {
    const transDoc = await transRef.get();
    if (!transDoc.exists || transDoc.data().status === 'CONFIRMED') return res.status(200).json({ message: 'OK' });

    const transData = transDoc.data();
    await transRef.update({ status: 'CONFIRMED', amountConfirmed: amountNum, dateConfirmed: admin.firestore.FieldValue.serverTimestamp() });

    const userRef = db.collection('users').doc(transData.userId);
    await db.runTransaction(async (t) => {
      const userDoc = await t.get(userRef);
      if (!userDoc.exists) t.set(userRef, { balance: amountNum });
      else t.update(userRef, { balance: (userDoc.data().balance || 0) + amountNum });
    });
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
          await db.runTransaction(async (t) => {
            const userDoc = await t.get(userRef);
            const currentBalance = userDoc.exists ? (userDoc.data().balance || 0) : 0;
            t.update(userRef, { balance: currentBalance + amountToCredit });
            t.update(transRef, {
              status: 'CONFIRMED',
              dateConfirmed: admin.firestore.FieldValue.serverTimestamp()
            });
          });
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
    console.log(`[NelsiusPay] Crédit effectué: +${amountToCredit} XAF → ${userId} (solde: ${currentBalance} → ${newBalance})`);
  });

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
const ALL_USERS_CACHE_TTL_MS = 30 * 60 * 1000;

const topUsersTodayCache = { data: null, expires: 0, lastRefresh: 0 };
const TOP_USERS_TODAY_CACHE_TTL_MS = 5 * 60 * 1000;

const depositsCache = { data: null, expires: 0 };
const DEPOSITS_CACHE_TTL_MS = 5 * 60 * 1000;

const ordersCache = { data: null, expires: 0 };
const ORDERS_CACHE_TTL_MS = 5 * 60 * 1000;

const DATE_FIELD_CACHE = {};

async function detectDateField(collectionName) {
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

async function getAllUsersSorted(forceRefresh = false) {
  const now = Date.now();
  if (!forceRefresh && allUsersCache.data && now < allUsersCache.expires) {
    return allUsersCache.data;
  }
  const allUsers = [];
  let last = null;
  while (true) {
    let q = db.collection('users').orderBy(admin.firestore.FieldPath.documentId()).limit(500);
    if (last) q = q.startAfter(last);
    const page = await q.get();
    if (page.empty) break;
    page.forEach(doc => {
      const data = doc.data() || {};
      allUsers.push({
        id: doc.id,
        ...data,
        _createdAtMs: getTimestampMs(data.createdAt || data.created_at || data.dateCreated || data.timestamp),
      });
    });
    last = page.docs[page.docs.length - 1];
    if (page.size < 500) break;
  }
  allUsers.sort((a, b) => b._createdAtMs - a._createdAtMs);
  allUsersCache.data = allUsers;
  allUsersCache.expires = now + ALL_USERS_CACHE_TTL_MS;
  allUsersCache.lastRefresh = now;
  console.log(`[Cache] ${allUsers.length} utilisateurs chargés et triés (TTL 30 min)`);
  return allUsers;
}

async function countUsersInWindow(start, end) {
  try {
    const [tsCount, isoCount] = await Promise.all([
      db.collection('users')
        .where('createdAt', '>=', admin.firestore.Timestamp.fromDate(start))
        .where('createdAt', '<', admin.firestore.Timestamp.fromDate(end))
        .count().get().catch(() => null),
      db.collection('users')
        .where('createdAt', '>=', start.toISOString())
        .where('createdAt', '<', end.toISOString())
        .count().get().catch(() => null),
    ]);
    return (tsCount?.data()?.count || 0) + (isoCount?.data()?.count || 0);
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
    const [tsR, isoR] = await Promise.all([
      ref.where(dateField, '>=', admin.firestore.Timestamp.fromDate(start))
         .where(dateField, '<', admin.firestore.Timestamp.fromDate(end))
         .count().get().catch(() => null),
      ref.where(dateField, '>=', start.toISOString())
         .where(dateField, '<', end.toISOString())
         .count().get().catch(() => null),
    ]);
    return (tsR?.data()?.count || 0) + (isoR?.data()?.count || 0);
  } catch (_) { return 0; }
}

// ✅ VERSION ROBUSTE : double requête (Timestamp + ISO string), fallback en mémoire
async function getFinancialsForCollection(colName, start, end) {
  const dateField = await detectDateField(colName);
  const ref = db.collection(colName);

  const queries = [];
  if (!start && !end) {
    queries.push(ref);
  } else {
    let qTs = ref, qIso = ref;
    if (start) {
      qTs = qTs.where(dateField, '>=', admin.firestore.Timestamp.fromDate(start));
      qIso = qIso.where(dateField, '>=', start.toISOString());
    }
    if (end) {
      qTs = qTs.where(dateField, '<', admin.firestore.Timestamp.fromDate(end));
      qIso = qIso.where(dateField, '<', end.toISOString());
    }
    queries.push(qTs, qIso);
  }

  const result = { ordersCount: 0, sales: 0, supplierCost: 0, grossProfit: 0, refunds: 0 };

  // Count via .count().get() — TOUJOURS fiable
  for (const q of queries) {
    try {
      const c = await q.count().get();
      result.ordersCount += Number(c.data()?.count || 0);
    } catch (_) {}
  }

  // Try aggregation
  let aggSucceeded = false;
  try {
    const fields = {
      a: admin.firestore.AggregateField.sum('priceXAF'),
      b: admin.firestore.AggregateField.sum('totalCost'),
      c: admin.firestore.AggregateField.sum('finalCost'),
      d: admin.firestore.AggregateField.sum('cost'),
      e: admin.firestore.AggregateField.sum('amount'),
      f: admin.firestore.AggregateField.sum('providerCostXAF'),
      g: admin.firestore.AggregateField.sum('supplierCostXAF'),
      h: admin.firestore.AggregateField.sum('estimatedProfitXAF'),
      i: admin.firestore.AggregateField.sum('refundedAmount'),
    };

    let allOk = true;
    for (const q of queries) {
      try {
        const snap = await q.aggregate(fields).get();
        const dd = snap.data() || {};
        const sales = Math.max(
          Number(dd.a || 0), Number(dd.b || 0), Number(dd.c || 0),
          Number(dd.d || 0), Number(dd.e || 0)
        );
        result.sales += sales;
        result.supplierCost += Math.max(Number(dd.f || 0), Number(dd.g || 0));
        result.grossProfit += Number(dd.h || 0);
        result.refunds += Number(dd.i || 0);
      } catch (e) {
        allOk = false;
        break;
      }
    }
    aggSucceeded = allOk;
  } catch (e) {
    console.warn(`[Fin] Aggregate indisponible pour ${colName}, fallback mémoire :`, e.message);
  }

  // Fallback : lecture en mémoire
  if (!aggSucceeded) {
    let memSales = 0, memCost = 0, memProfit = 0, memRefunds = 0;
    for (const q of queries) {
      try {
        const docs = await q.limit(2000).get();
        docs.forEach(doc => {
          const data = doc.data() || {};
          const amount = getOrderAmountXAF(data, colName);
          const fin = getOrderFinancials(data, null, colName);
          memSales += amount || 0;
          memCost += fin.providerCostXAF || 0;
          memProfit += fin.grossProfitXAF || 0;
          memRefunds += fin.refundedAmount || 0;
        });
      } catch (e) {
        console.warn(`[Fin] Fallback mémoire échoué pour ${colName}:`, e.message);
      }
    }
    result.sales = memSales;
    result.supplierCost = memCost;
    result.grossProfit = memProfit;
    result.refunds = memRefunds;
  }

  return result;
}

async function getFinancialsAllCollections(start, end) {
  let totalSales = 0, totalRefunds = 0, totalSupplierCost = 0, totalProfit = 0, totalOrders = 0;

  for (const colName of ADMIN_ORDER_COLLECTIONS) {
    try {
      const r = await getFinancialsForCollection(colName, start, end);
      totalSales += r.sales;
      totalRefunds += r.refunds;
      totalSupplierCost += r.supplierCost;
      totalProfit += r.grossProfit;
      totalOrders += r.ordersCount;
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
  };
}

async function countDepositsAllCollections(start, end) {
  let total = 0;
  for (const colName of PAYMENT_COLLECTIONS) {
    try { total += await countOrdersInWindow(colName, start, end); } catch (_) {}
  }
  return total;
}

async function getDepositsStatsAllCollections(start, end) {
  let total = 0, success = 0, pending = 0, failed = 0;
  let totalCreditedXAF = 0;
  const successByUser = new Map();

  const successVariants = ['CONFIRMED','confirmed','SUCCESS','success','SUCCEEDED','succeeded','PAID','paid','SUCCESSFUL','successful','completed','COMPLETED'];
  const pendingVariants = ['PENDING','pending','PROCESSING','processing','INITIATED','initiated','WAITING','waiting'];
  const failedVariants  = ['FAILED','failed','FAILURE','failure','CANCELLED','cancelled','REJECTED','rejected','EXPIRED','expired'];

  for (const colName of PAYMENT_COLLECTIONS) {
    try {
      const dateField = await detectDateField(colName);
      let baseQ = db.collection(colName);
      if (start) baseQ = baseQ.where(dateField, '>=', admin.firestore.Timestamp.fromDate(start));
      if (end)   baseQ = baseQ.where(dateField, '<', admin.firestore.Timestamp.fromDate(end));

      const [totalSnap, successSnap, pendingSnap, failedSnap] = await Promise.all([
        baseQ.count().get().catch(() => null),
        baseQ.where('status', 'in', successVariants).count().get().catch(() => null),
        baseQ.where('status', 'in', pendingVariants).count().get().catch(() => null),
        baseQ.where('status', 'in', failedVariants).count().get().catch(() => null),
      ]);

      const colTotal = Number(totalSnap?.data()?.count || 0);
      const colSuccess = Number(successSnap?.data()?.count || 0);
      const colPending = Number(pendingSnap?.data()?.count || 0);
      const colFailed = Number(failedSnap?.data()?.count || 0);

      total += colTotal;
      success += colSuccess;
      pending += colPending;
      failed += colFailed;

      if (colSuccess > 0) {
        const successDocs = await baseQ.where('status', 'in', successVariants).limit(500).get().catch(() => null);
        if (successDocs) {
          successDocs.forEach(doc => {
            const d = doc.data() || {};
            const pick = keys => { for (const k of keys) if (d[k] !== undefined && d[k] !== null && d[k] !== '') return d[k]; return null; };
            const amount = Number(
              pick(['creditedAmountXAF','amountCredited','amount','amountXAF','total','montant','requestedAmount']) || 0
            );
            totalCreditedXAF += amount;
            const uid = d.userId || d.uid || d.user_id || null;
            if (uid) {
              const cur = successByUser.get(uid) || { amount: 0, count: 0, lastAt: null };
              cur.amount += amount;
              cur.count++;
              cur.lastAt = d[dateField] || d.createdAt || d.created_at || null;
              successByUser.set(uid, cur);
            }
          });
        }
      }
    } catch (e) {
      console.warn(`DepositsStats ${colName}:`, e.message);
    }
  }

  let topDepositor = null;
  if (successByUser.size > 0) {
    const sorted = [...successByUser.entries()].sort((a, b) => b[1].amount - a[1].amount);
    const [uid, stats] = sorted[0];
    try {
      const userDoc = await db.collection('users').doc(uid).get();
      if (userDoc.exists) {
        const u = userDoc.data();
        topDepositor = {
          userId: uid,
          name: u.displayName || u.username || u.name || 'Anonyme',
          email: u.email || null,
          phone: u.phone || u.whatsapp || null,
          country: u.country || null,
          amount: stats.amount,
          count: stats.count,
          lastAt: stats.lastAt,
        };
      }
    } catch (_) {}
  }

  return { total, success, pending, failed, totalCreditedXAF, topDepositor };
}

async function getTopUsersToday(forceRefresh = false) {
  const now = Date.now();
  if (!forceRefresh && topUsersTodayCache.data && now < topUsersTodayCache.expires) {
    return topUsersTodayCache.data;
  }

  const local = new Date(now + 60 * 60 * 1000);
  const todayStart = new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate()) - 60 * 60 * 1000);
  const tomorrowStart = new Date(todayStart.getTime() + 24 * 60 * 60 * 1000);

  const userAgg = new Map();

  for (const colName of ADMIN_ORDER_COLLECTIONS) {
    try {
      const dateField = await detectDateField(colName);
      let q = db.collection(colName)
        .where(dateField, '>=', admin.firestore.Timestamp.fromDate(todayStart))
        .where(dateField, '<', admin.firestore.Timestamp.fromDate(tomorrowStart))
        .limit(500);
      const snap = await q.get().catch(() => null);
      if (!snap) continue;

      snap.forEach(doc => {
        const d = doc.data() || {};
        const uid = d.userId || d.uid || d.user_id || d.customerId || null;
        if (!uid) return;

        const f = getOrderFinancials(d, null, colName);
        const cur = userAgg.get(uid) || { count: 0, totalPaid: 0, totalProfit: 0, orders: [] };
        cur.count++;
        cur.totalPaid += f.amount || 0;
        cur.totalProfit += f.grossProfitXAF || 0;
        cur.orders.push({
          orderId: d.orderId || d.reference || d.order_id || doc.id,
          serviceName: d.serviceName || d.service_name || d.name || 'Service',
          provider: f.provider,
          amount: f.amount,
          profit: f.grossProfitXAF,
          createdAt: d[dateField] || d.createdAt || d.created_at || null,
        });
        userAgg.set(uid, cur);
      });
    } catch (e) {
      console.warn(`TopUsersToday ${colName}:`, e.message);
    }
  }

  const userIds = [...userAgg.keys()];
  const userSnaps = await Promise.all(userIds.map(id => db.collection('users').doc(id).get()));
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
      });
    }
  });

  const result = [...userAgg.entries()].map(([uid, stats]) => {
    const u = usersMap.get(uid) || {};
    return {
      id: uid,
      name: u.name || 'Client',
      email: u.email || null,
      phone: u.phone || null,
      country: u.country || null,
      balance: u.balance || 0,
      orderCount: stats.count,
      totalPaid: stats.totalPaid,
      totalProfit: stats.totalProfit,
      orders: stats.orders.slice(0, 10),
    };
  }).sort((a, b) => b.totalProfit - a.totalProfit);

  topUsersTodayCache.data = result;
  topUsersTodayCache.expires = now + TOP_USERS_TODAY_CACHE_TTL_MS;
  return result;
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
function getOrderFinancials(d = {}, rawProvider = null, collectionName = '') {
  const amount = getOrderAmountXAF(d, collectionName);
  const provider = normalizeProvider(rawProvider || d.provider || d.fournisseur || d.providerName || d.supplier || d.api);
  const storedMultiplier = Number(d.providerMultiplier || d.multiplier || 0);
  const multiplierByProvider = { MTP: MTP_MULTIPLIER, EXO: EXO_MULTIPLIER, AfriqueBoost: AFB_MULTIPLIER, SMMWiz: SMMWIZ_MULTIPLIER, SMMGen: SMMGEN_MULTIPLIER };
  const multiplier = storedMultiplier > 1 ? storedMultiplier : multiplierByProvider[provider];
  const storedCost = d.providerCostXAF ?? d.supplierCostXAF ?? d.provider_cost_xaf ?? d.supplier_cost_xaf;
  let providerCostXAF = storedCost !== undefined && storedCost !== null && Number.isFinite(Number(storedCost)) ? Math.max(0, Number(storedCost)) : null;
  let providerCostEstimated = false;
  if (providerCostXAF === null && amount !== null && multiplier && multiplier > 1) { providerCostXAF = Math.round(amount / multiplier); providerCostEstimated = true; }
  let grossProfitXAF = d.estimatedProfitXAF !== undefined && d.estimatedProfitXAF !== null && Number.isFinite(Number(d.estimatedProfitXAF)) ? Number(d.estimatedProfitXAF) : (amount !== null && providerCostXAF !== null ? amount - providerCostXAF : null);
  const profitEstimated = !(d.estimatedProfitXAF !== undefined && d.estimatedProfitXAF !== null && Number.isFinite(Number(d.estimatedProfitXAF))) && (providerCostEstimated || providerCostXAF === null || amount === null);
  const refundedAmount = Number(d.refundedAmount ?? d.refundAmount ?? 0) || 0;
  return { amount, provider, providerCostXAF, grossProfitXAF, profitMarginPct: amount > 0 && grossProfitXAF !== null ? Math.round((grossProfitXAF / amount) * 10000) / 100 : null, providerCostEstimated, profitEstimated, multiplier: multiplier || null, refundedAmount };
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

adminRouter.get('/overview', async (req, res) => {
  try {
    const forceRefresh = String(req.query.refresh || '') === '1';
    const cached = !forceRefresh ? memCacheGet(adminMemoryCache.overview) : null;
    if (cached) return res.json({ success: true, data: cached, cached: true });
    if (!forceRefresh) {
      const shared = await getSharedAdminCache('overview');
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
      getFinancialsAllCollections(todayStart, tomorrowStart),
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
    memCacheSet(adminMemoryCache.overview, data, 15 * 60 * 1000);
    await setSharedAdminCache('overview', data, 15 * 60 * 1000);
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

adminRouter.get('/top-users', async (req, res) => {
  try {
    const forceRefresh = String(req.query.refresh || '') === '1';
    const period = String(req.query.period || 'all').toLowerCase();

    if (period === 'today') {
      const users = await getTopUsersToday(forceRefresh);
      return res.json({ success: true, period: 'today', users, cached: !forceRefresh && topUsersTodayCache.data !== null });
    }

    const cached = !forceRefresh ? memCacheGet(adminMemoryCache.topUsers) : null;
    if (cached) return res.json({ success: true, period: 'all', users: cached, cached: true });
    if (!forceRefresh) {
      const shared = await getSharedAdminCache('topUsers');
      if (shared) { memCacheSet(adminMemoryCache.topUsers, shared.payload, Math.max(1000, shared.expiresAtMs - Date.now())); return res.json({ success: true, period: 'all', users: shared.payload, cached: true, cacheScope: 'shared' }); }
    }

    let usersSnap;
    try {
      usersSnap = await db.collection('users').orderBy('adminOrderCount', 'desc').limit(20).get();
    } catch {
      usersSnap = await db.collection('users').where('adminOrderCount', '>', 0).orderBy('adminOrderCount', 'desc').limit(20).get();
    }

    const users = usersSnap.docs.map(d => {
      const u = d.data();
      return {
        id: d.id,
        name: u.displayName || u.username || u.name || 'Anonyme',
        email: u.email || null,
        phone: u.phone || u.whatsapp || null,
        balance: u.balance || 0,
        country: u.country || null,
        createdAt: u.createdAt || null,
        orderCount: Number(u.adminOrderCount || 0),
        totalSpent: Number(u.adminTotalSpent || 0),
        totalProfit: Number(u.adminTotalProfit || 0),
      };
    });

    users.sort((a, b) => (b.orderCount - a.orderCount) || (b.totalSpent - a.totalSpent));

    memCacheSet(adminMemoryCache.topUsers, users, 60 * 60 * 1000);
    await setSharedAdminCache('topUsers', users, 60 * 60 * 1000);
    res.json({ success: true, period: 'all', users, cached: false, reads: usersSnap.size });
  } catch (error) {
    console.error('Erreur /top-users:', error);
    res.status(500).json({ success: false, error: 'Impossible de charger le classement des utilisateurs.' });
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
      completed: ['Terminé', 'Terminée', 'Terminee', 'completed', 'Completed', 'Done', 'done', 'Delivered', 'delivered'],
      cancelled: ['Annulé', 'Annulée', 'Annule', 'Canceled', 'Cancelled', 'canceled', 'cancelled'],
      failed: ['Échouée', 'Echouée', 'failed', 'Failed', 'error', 'Erreur', 'failed'],
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
      return res.json({
        success: true,
        orders: cached.slice(offset, offset + limit),
        total: cached.length,
        offset,
        limit,
        hasMore: offset + limit < cached.length,
        cached: true,
      });
    }

    const statusAliases = {
      'en attente': ['en attente','pending'], 'en cours': ['en cours','in progress','processing'],
      'terminé': ['terminé','terminée','terminee','completed','done','delivered'],
      'annulé': ['annulé','annulée','annule','canceled','cancelled'], 'partiel': ['partiel','partial'],
      'échouée': ['échouée','echouee','failed','error','erreur'],
    };
    const providerAliases = { mtp:['mtp','morethanpanel'], exo:['exo'], afriqueboost:['afriqueboost','afb'], smmwiz:['smmwiz'], smmgen:['smmgen'] };

    const collected = [];

    for (const collectionName of ADMIN_ORDER_COLLECTIONS) {
      const ref = db.collection(collectionName);
      const dateField = await detectDateField(collectionName);

      try {
        let docs = [];
        if (userId) {
          const [a, b, c] = await Promise.all([
            ref.where('userId', '==', userId).limit(500).get(),
            ref.where('uid', '==', userId).limit(500).get(),
            ref.where('user_id', '==', userId).limit(500).get(),
          ]);
          const seen = new Set();
          [...a.docs, ...b.docs, ...c.docs].forEach(d => {
            if (!seen.has(d.id)) { seen.add(d.id); docs.push(d); }
          });
        } else {
          // Tenter orderBy date, sinon fallback limit simple
          let snap;
          try {
            snap = await ref.orderBy(dateField, 'desc').limit(500).get();
          } catch (orderErr) {
            console.warn(`[Orders] orderBy ${dateField} échoué sur ${collectionName}, fallback limit simple`);
            snap = await ref.limit(500).get();
          }
          docs = snap.docs;
        }

        for (const doc of docs) {
          const data = doc.data() || {};
          const dateVal = data[dateField] || data.createdAt || data.created_at || data.timestamp || data.date || null;
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

    if (!ordersCache.data) ordersCache.data = {};
    ordersCache.data[cacheKey] = { orders: collected, expires: Date.now() + ORDERS_CACHE_TTL_MS };

    const slice = collected.slice(offset, offset + limit);
    const enriched = await enrichAdminOrderUsers(slice);

    return res.json({
      success: true,
      orders: enriched,
      total: collected.length,
      offset,
      limit,
      hasMore: offset + limit < collected.length,
      pageSizePerCollection: limit,
      collections: ADMIN_ORDER_COLLECTIONS,
      providerFilter: providerFilter || null,
    });
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

function normalizeAdminOrder(doc, collectionName) {
  const d = doc.data() || {}; const rawProvider = d.provider || d.fournisseur || d.providerName || d.supplier || d.api || (collectionName === 'commandes' ? 'EXO' : null);
  const financials = getOrderFinancials(d, rawProvider, collectionName);
  return { id:doc.id, collection:collectionName, orderId:d.orderId||d.reference||d.order_id||doc.id,
    userId:d.userId||d.uid||d.user_id||d.customerId||null, provider:financials.provider, providerRaw:rawProvider,
    serviceId:d.serviceId??d.service_id??d.service??null, serviceName:d.serviceName||d.service_name||d.name||d.serviceTitle||'Service',
    platform:d.platform||null, link:d.link||d.targetLink||d.target||null, quantity:Number(d.quantity||d.qty||0),
    amount:financials.amount, providerCostXAF:financials.providerCostXAF, grossProfitXAF:financials.grossProfitXAF,
    profitMarginPct:financials.profitMarginPct, providerCostEstimated:financials.providerCostEstimated, profitEstimated:financials.profitEstimated, multiplier:financials.multiplier,
    status:d.status||d.orderStatus||d.state||'Inconnu', refunded:Boolean(d.refunded||d.isRefunded||d.refund), refundedAmount:financials.refundedAmount,
    createdAt:d.createdAt||d.date||d.dateCreated||d.created_at||d.timestamp||null };
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

    const cacheKey = `deposits:${status}:${providerFilter}:${dateStart?.getTime() || 'x'}:${dateEnd?.getTime() || 'x'}`;
    if (!forceRefresh && depositsCache.data && depositsCache.data[cacheKey] && Date.now() < depositsCache.data[cacheKey].expires) {
      return res.json({ success: true, transactions: depositsCache.data[cacheKey].transactions, cached: true, sources: PAYMENT_COLLECTIONS });
    }

    const sources = [
      { name: 'paymentTransactions', providerFallback: 'NelsiusPay', amountKeys: ['requestedAmount','amount'], currencyKeys: ['requestedCurrency','currency'], creditKeys: ['creditedAmountXAF','amountXAF'] },
      { name: 'fapshiTransactions', providerFallback: 'Fapshi', amountKeys: ['amount','requestedAmount'], currencyKeys: ['currency','requestedCurrency'], creditKeys: ['creditedAmountXAF','creditedAmount','amountCreditedXAF'] },
      { name: 'payments', providerFallback: 'Swychr', amountKeys: ['amount','amountXAF','total','montant'], currencyKeys: ['currency','devise'], creditKeys: ['creditedAmountXAF','amountCredited','amount'] },
      { name: 'rechargements', providerFallback: 'Rechargement', amountKeys: ['amount','amountXAF','total','montant','requestedAmount'], currencyKeys: ['currency','devise'], creditKeys: ['creditedAmountXAF','amountCredited','amount'] },
      { name: 'recharges', providerFallback: 'Recharge', amountKeys: ['amount','amountXAF','total','montant','requestedAmount'], currencyKeys: ['currency','devise'], creditKeys: ['creditedAmountXAF','amountCredited','amount'] },
      { name: 'transactions', providerFallback: 'Transaction', amountKeys: ['amount','amountXAF','total','montant','requestedAmount'], currencyKeys: ['currency','devise'], creditKeys: ['creditedAmountXAF','amountCredited','amount'] },
    ];

    const statusVariants = {
      CONFIRMED: ['CONFIRMED','confirmed','SUCCESS','success','SUCCEEDED','succeeded','PAID','paid','SUCCESSFUL','successful','completed','COMPLETED'],
      PENDING: ['PENDING','pending','PROCESSING','processing','INITIATED','initiated','WAITING','waiting'],
      FAILED: ['FAILED','failed','FAILURE','failure','CANCELLED','cancelled','REJECTED','rejected','EXPIRED','expired']
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
        const snap = await db.collection(source.name).limit(500).get();

        const items = snap.docs.map(doc => {
          const d = doc.data() || {};
          const pick = keys => { for (const k of keys) if (d[k] !== undefined && d[k] !== null && d[k] !== '') return d[k]; return null; };
          const rawStatus = String(d.status || d.paymentStatus || d.state || 'UNKNOWN');
          const amount = Number(pick(source.amountKeys) || 0);
          const creditedRaw = pick(source.creditKeys);
          const createdAtRaw = d[dateField] || d.createdAt || d.dateInitiated || d.created_at || d.dateCreated || d.timestamp || d.date || null;
          const createdAtMs = getTimestampMs(createdAtRaw);

          if (dateStart && createdAtMs < dateStart.getTime()) return null;
          if (dateEnd && createdAtMs >= dateEnd.getTime()) return null;

          return {
            id: doc.id,
            source: source.name,
            reference: d.reference || d.transId || d.fapshiTransId || d.transactionId || doc.id,
            userId: d.userId || d.uid || d.user_id || null,
            userName: d.userName || d.displayName || d.name || d.customer_name || null,
            userEmail: d.email || d.userEmail || d.customer_email || null,
            provider: d.provider || d.paymentProvider || source.providerFallback,
            status: rawStatus,
            requestedAmount: amount,
            requestedCurrency: pick(source.currencyKeys) || 'XAF',
            creditedAmountXAF: creditedRaw === null ? null : Number(creditedRaw),
            createdAt: createdAtRaw,
            completedAt: d.completedAt || d.dateConfirmed || d.creditedAt || d.updatedAt || null,
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
    if (status !== 'ALL' && statusVariants[status]) {
      const allowed = statusVariants[status].map(s => s.toLowerCase());
      transactions = transactions.filter(t => allowed.includes(String(t.status).toLowerCase()));
    }

    const userIds = [...new Set(transactions.filter(t => t.userId && (!t.userName || !t.userEmail)).map(t => t.userId))];
    if (userIds.length) {
      const userSnaps = await Promise.all(userIds.map(id => db.collection('users').doc(id).get()));
      const users = new Map(userSnaps.filter(s => s.exists).map(s => { const u = s.data() || {}; return [s.id, { name: u.displayName || u.username || u.name || null, email: u.email || null }]; }));
      for (const t of transactions) { const u = users.get(t.userId); if (u) { t.userName = t.userName || u.name; t.userEmail = t.userEmail || u.email; } }
    }

    transactions.sort((a, b) => b._createdMs - a._createdMs);
    const totalAvailable = transactions.length;
    transactions = transactions.slice(0, limit).map(t => { delete t._createdMs; return t; });

    if (!depositsCache.data) depositsCache.data = {};
    depositsCache.data[cacheKey] = { transactions, expires: Date.now() + DEPOSITS_CACHE_TTL_MS };

    return res.json({ success: true, transactions, total: totalAvailable, pageSize: limit, sources: results.map(s => s.source), providerFilter });
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
    const metricsReady = Boolean(metricsState?.payload?.completedAt);

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

    if (segment === 'ordered') filtered = filtered.filter(u => Number(u.adminOrderCount || 0) > 0);
    else if (segment === 'neverOrdered') filtered = filtered.filter(u => Number(u.adminOrderCount || 0) === 0);
    else if (segment === 'highOrders') filtered.sort((a, b) => Number(b.adminOrderCount || 0) - Number(a.adminOrderCount || 0));
    else if (segment === 'highBalance') filtered.sort((a, b) => Number(b.balance || 0) - Number(a.balance || 0));

    if (sort === 'orders') filtered.sort((a, b) => Number(b.adminOrderCount || 0) - Number(a.adminOrderCount || 0));
    else if (sort === 'balance') filtered.sort((a, b) => Number(b.balance || 0) - Number(a.balance || 0));
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
  const orderCount = Number(u.adminOrderCount ?? u.totalOrders ?? 0);
  const spent = Number(u.adminTotalSpent ?? u.totalSpent ?? 0);
  const profit = Number(u.adminTotalProfit ?? 0);
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
    createdAt: u.createdAt || u.created_at || null,
    lastSignIn: u.lastSignIn || u.lastLoginAt || null,
    lastActivityAt: u.lastActivityAt || u.lastSeenAt || u.lastDashboardVisit || null,
    resellerLevel: u.resellerLevel || null,
    hasOrdered: orderCount > 0,
    metricsReady,
  };
}

adminRouter.post('/customers/rebuild-order-metrics', async (req, res) => {
  try {
    if (req.body?.confirm !== true) return res.status(400).json({ success: false, error: 'Confirmation explicite requise.' });
    const metricMap = new Map(); let ordersRead = 0, unattributedOrders = 0, unattributedAmounts = 0;
    for (const collectionName of ADMIN_ORDER_COLLECTIONS) {
      let last = null;
      while (true) {
        let q = db.collection(collectionName).orderBy(admin.firestore.FieldPath.documentId()).limit(500);
        if (last) q = q.startAfter(last);
        const page = await q.get();
        if (page.empty) break;
        for (const doc of page.docs) {
          ordersRead++;
          const d = doc.data() || {};
          const uid = String(d.userId || d.uid || d.user_id || d.customerId || d.customerUid || '').trim();
          if (!uid) { unattributedOrders++; continue; }
          const current = metricMap.get(uid) || { count: 0, spent: 0, profit: 0 };
          current.count++;
          const f = getOrderFinancials(d, null, collectionName);
          if (f.amount === null) unattributedAmounts++; else current.spent += f.amount;
          if (f.grossProfitXAF) current.profit += f.grossProfitXAF;
          metricMap.set(uid, current);
        }
        last = page.docs[page.docs.length - 1];
        if (page.size < 500) break;
      }
    }
    let usersRead = 0, changed = 0, userLast = null;
    while (true) {
      let q = db.collection('users').orderBy(admin.firestore.FieldPath.documentId()).limit(500);
      if (userLast) q = q.startAfter(userLast);
      const page = await q.get();
      if (page.empty) break;
      usersRead += page.size;
      let batch = db.batch(), writes = 0;
      for (const doc of page.docs) {
        const expected = metricMap.get(doc.id) || { count: 0, spent: 0, profit: 0 };
        const u = doc.data() || {};
        const oldCount = Number(u.adminOrderCount);
        const oldSpent = Number(u.adminTotalSpent);
        const oldProfit = Number(u.adminTotalProfit);
        const changedNow = oldCount !== expected.count
          || !Number.isFinite(oldSpent) || Math.round(oldSpent) !== Math.round(expected.spent)
          || !Number.isFinite(oldProfit) || Math.round(oldProfit) !== Math.round(expected.profit);
        if (changedNow) {
          batch.set(doc.ref, {
            adminOrderCount: expected.count,
            adminTotalSpent: Math.round(expected.spent),
            adminTotalProfit: Math.round(expected.profit),
            adminOrderMetricsUpdatedAt: admin.firestore.FieldValue.serverTimestamp()
          }, { merge: true });
          writes++; changed++;
        }
        if (writes >= 400) { await batch.commit(); batch = db.batch(); writes = 0; }
      }
      if (writes) { await batch.commit(); }
      userLast = page.docs[page.docs.length - 1];
      if (page.size < 500) break;
    }
    const completedAt = new Date().toISOString();
    await setSharedAdminCache('customerOrderMetricsState', { completedAt, ordersRead, usersRead, changed, unattributedOrders, unattributedAmounts }, 60 * 60 * 24 * 365 * 1000);
    allUsersCache.data = null;
    allUsersCache.expires = 0;
    for (const key of ['overview', 'topUsers', 'usersStats']) {
      if (adminMemoryCache[key]) { adminMemoryCache[key].data = null; adminMemoryCache[key].expires = 0; }
    }
    return res.json({ success: true, metricsReady: true, completedAt, ordersRead, usersRead, changed, unattributedOrders, unattributedAmounts, message: `Historique recalculé à partir de ${ordersRead.toLocaleString('fr-FR')} commandes.` });
  } catch (error) {
    console.error('Erreur rebuild adminOrderMetrics:', error);
    return res.status(500).json({ success: false, error: 'Le recalcul historique a échoué. Aucun chiffre ne sera présenté comme recalculé.' });
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

adminRouter.get('/customers/:id', async (req, res) => {
  try {
    const userId = String(req.params.id || '').trim(); if (!userId) return res.status(400).json({ success: false, error: 'Identifiant utilisateur requis.' });
    const userDoc = await db.collection('users').doc(userId).get(); if (!userDoc.exists) return res.status(404).json({ success: false, error: 'Utilisateur introuvable.' }); const u = userDoc.data() || {};
    const all = []; const countsByCollection = {}; let derivedSpendPriceXAF = 0, exactOrderCount = 0, unattributedAmountCount = 0;
    for (const collectionName of ADMIN_ORDER_COLLECTIONS) {
      const [a, b, c, d, e] = await Promise.all([db.collection(collectionName).where('userId','==',userId).get(), db.collection(collectionName).where('uid','==',userId).get(), db.collection(collectionName).where('user_id','==',userId).get(), db.collection(collectionName).where('customerId','==',userId).get(), db.collection(collectionName).where('customerUid','==',userId).get()]);
      const docsMap = new Map(); [...a.docs, ...b.docs, ...c.docs, ...d.docs, ...e.docs].forEach(doc => docsMap.set(doc.id, doc)); const docs = [...docsMap.values()];
      countsByCollection[collectionName] = docs.length; exactOrderCount += docs.length;
      for (const doc of docs) {
        const d = doc.data() || {};
        const financials = getOrderFinancials(d, d.provider || d.fournisseur || d.providerName || d.supplier || (collectionName === 'commandes' ? 'EXO' : null), collectionName);
        const amount = financials.amount;
        if (amount === null) unattributedAmountCount++; else derivedSpendPriceXAF += amount;
        all.push({ id: doc.id, source: collectionName, ...d, normalizedAmount: amount, normalizedProvider: financials.provider, normalizedProviderCost: financials.providerCostXAF, normalizedProfit: financials.grossProfitXAF, normalizedMarginPct: financials.profitMarginPct, providerCostEstimated: financials.providerCostEstimated, profitEstimated: financials.profitEstimated });
      }
    }
    all.sort((a, b) => getTimestampMs(b.createdAt || b.date || b.created_at || b.dateCreated) - getTimestampMs(a.createdAt || a.date || a.created_at || a.dateCreated));
    const orders = all.slice(0, 50).map(o => ({ id: o.id, source: o.source, orderId: o.orderId || o.reference || o.order_id || o.id, serviceName: o.serviceName || o.service_name || o.name || 'Service', quantity: Number(o.quantity || o.qty || o.count || 0), provider: o.normalizedProvider || null, status: o.status || o.orderStatus || o.state || 'Inconnu', amount: o.normalizedAmount, providerCostXAF: o.normalizedProviderCost, grossProfitXAF: o.normalizedProfit, profitMarginPct: o.normalizedMarginPct, providerCostEstimated: o.providerCostEstimated, profitEstimated: o.profitEstimated, createdAt: o.createdAt || o.date || o.dateCreated || o.created_at || o.timestamp || null }));
    return res.json({ success: true, customer: { id: userDoc.id, name: u.displayName || u.username || u.name || 'Utilisateur', email: u.email || null, phone: u.phone || u.whatsapp || null, country: u.country || null, balance: Number(u.balance || 0), totalOrders: exactOrderCount, totalSpent: Math.round(derivedSpendPriceXAF), createdAt: u.createdAt || u.created_at || null, lastSignIn: u.lastSignIn || u.lastLoginAt || null, lastActivityAt: u.lastActivityAt || u.lastSeenAt || u.lastDashboardVisit || u.lastSignIn || u.lastLoginAt || null, resellerLevel: u.resellerLevel || null }, orders, exactOrderCount, derivedSpendPriceXAF: Math.round(derivedSpendPriceXAF), storedTotalSpent: Number(u.totalSpent || 0), countsByCollection, ordersReturned: orders.length, capped: exactOrderCount > orders.length, unattributedAmountCount, spendNote: 'Total brut des montants de commandes retrouvés dans les six collections, en normalisant les champs connus. Les commandes sans montant reconnu sont comptées dans le volume, mais pas dans le total dépensé.' });
  } catch (error) { console.error('Erreur /api/admin/customers/:id:', error); return res.status(500).json({ success: false, error: 'Impossible de charger la fiche utilisateur.' }); }
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

async function readFinancialPeriod(range) {
  const bounds = financialWindow(range);
  const agg = await getFinancialsAllCollections(bounds.start, bounds.end);
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
    const range = acceptedRanges.includes(String(req.query.range || '30d')) ? String(req.query.range || '30d') : '30d';
    const cacheKey = `financials:${range}`;
    const sharedKey = `financials-${range}`;
    const cached = adminMemoryCache.financialsMap.get(cacheKey);
    const forceRefresh = String(req.query.refresh || '') === '1';
    if (!forceRefresh && cached && Date.now() < cached.expires) return res.json({ success: true, data: cached.data, previous: cached.previous, cached: true, cacheScope: 'instance' });
    if (!forceRefresh) {
      const shared = await getSharedAdminCache(sharedKey);
      if (shared) {
        const ttl = Math.max(1000, shared.expiresAtMs - Date.now());
        adminMemoryCache.financialsMap.set(cacheKey, { ...shared.payload, expires: Date.now() + ttl });
        return res.json({ success: true, data: shared.payload.data, previous: shared.payload.previous, cached: true, cacheScope: 'shared' });
      }
    }

    const bounds = financialWindow(range);
    const current = await readFinancialPeriod(range);
    let previous = null;
    if (bounds.previousStart && bounds.previousEnd) {
      const pAgg = await getFinancialsAllCollections(bounds.previousStart, bounds.previousEnd);
      previous = {
        start: bounds.previousStart.toISOString(),
        end: bounds.previousEnd.toISOString(),
        autoOrdersCount: pAgg.totalOrders,
        legacyOrdersCount: 0,
        totalOrders: pAgg.totalOrders,
        autoOrdersGrossSales: pAgg.totalSales,
        autoOrdersRefunds: pAgg.totalRefunds,
        autoOrdersNetSales: pAgg.netSales,
        supplierCostWithSnapshots: pAgg.totalSupplierCost,
        recordedGrossProfitBeforeRefunds: pAgg.totalProfit,
      };
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

    adminMemoryCache.financialsMap.set(cacheKey, { data: current, previous, expires: Date.now() + 15 * 60 * 1000 });
    await setSharedAdminCache(sharedKey, { data: current, previous }, 15 * 60 * 1000);
    res.json({ success: true, data: current, previous, cached: false });
  } catch (error) {
    console.error('Erreur /api/admin/financials:', error);
    res.status(500).json({ success: false, error: 'Impossible de charger les données financières. Vérifiez les index Firestore et les données de commandes.' });
  }
});

adminRouter.post('/cache/clear', (req, res) => {
  adminMemoryCache.overview.data = null;   adminMemoryCache.overview.expires = 0;
  adminMemoryCache.topUsers.data = null;   adminMemoryCache.topUsers.expires = 0;
  adminMemoryCache.usersStats.data = null; adminMemoryCache.usersStats.expires = 0;
  adminMemoryCache.financialsMap.clear();
  adminMemoryCache.orderSummary.data = null; adminMemoryCache.orderSummary.expires = 0;
  adminMemoryCache.giftsMap.clear();
  allUsersCache.data = null;
  allUsersCache.expires = 0;
  topUsersTodayCache.data = null;
  topUsersTodayCache.expires = 0;
  depositsCache.data = null;
  depositsCache.expires = 0;
  ordersCache.data = null;
  ordersCache.expires = 0;
  Object.keys(DATE_FIELD_CACHE).forEach(k => delete DATE_FIELD_CACHE[k]);
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