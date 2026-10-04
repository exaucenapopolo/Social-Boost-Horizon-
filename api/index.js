const express = require('express');
const cors    = require('cors');
const admin   = require('firebase-admin');
const crypto  = require('crypto');

const { sendWelcomeEmail } = require('./email-service.js');

const app = express();

app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'x-admin-password']
}));
app.use(express.json({ limit: '10mb' }));

app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
  next();
});

function getTimestampMs(val) {
  if (!val) return 0;
  if (typeof val.toDate === 'function') return val.toDate().getTime();
  if (val instanceof Date) return val.getTime();
  if (typeof val === 'number') return val;
  const parsed = new Date(val).getTime();
  return isNaN(parsed) ? 0 : parsed;
}

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
// CONFIGURATIONS FOURNISSEURS GLOBALES (MTP, EXO, AFB, SMMGen)
// ═══════════════════════════════════════════════════════════════
const MTP_API_URL    = 'https://morethanpanel.com/api/v2';
const MTP_USD_TO_XAF = 650;
const MTP_MULTIPLIER = 2.5;

const EXO_API_URL    = 'https://exosupplier.com/api/v2';
const EXO_USD_TO_XAF = 650;
const EXO_MULTIPLIER = 1.51;

const AFRIQUEBOOST_API_URL = 'https://afriqueboost.com/api/v2';
const AFB_MULTIPLIER       = 2.5;

const SMMGEN_API_URL      = 'https://my.smmgen.com/api/v2';
const SMMGEN_USD_TO_XAF   = 650;
const SMMGEN_MULTIPLIER   = 2.5;

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

async function callSmmGen(params) {
  if (!process.env.SMMGEN_API_KEY) throw new Error('SMMGEN_API_KEY non définie.');
  const body = new URLSearchParams({ key: process.env.SMMGEN_API_KEY, ...params });
  const res  = await fetch(SMMGEN_API_URL, {
    method: 'POST', body, headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  });
  if (!res.ok) throw new Error(`SMMGen HTTP ${res.status}`);
  return res.json();
}

// ═══════════════════════════════════════════════════════════════
// MTP API
// ═══════════════════════════════════════════════════════════════
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
    const priceXAF = Math.round(rate * MTP_USD_TO_XAF * MTP_MULTIPLIER);
    const qty = parseInt(quantity);
    const isPackage = (service.type || '').toLowerCase().includes('package');
    const cost = isPackage ? priceXAF : Math.round((priceXAF / 1000) * qty);

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
      transaction.update(freshUserRef, { balance: newBalance });

      const orderRef = db.collection('autoOrders').doc();
      transaction.set(orderRef, {
        orderId: finalOrderId, userId: uid, provider: 'mtp', providerOrderId: orderResult.order,
        serviceId: parseInt(serviceId), serviceName: service.name, platform, link, quantity: qty,
        priceXAF: cost, status: 'En attente', createdAt: admin.firestore.FieldValue.serverTimestamp(),
        providerStartCount: 0, providerRemains: qty, refunded: false,
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

// ═══════════════════════════════════════════════════════════════
// EXO API
// ═══════════════════════════════════════════════════════════════
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

// ═══════════════════════════════════════════════════════════════
// AfriqueBoost API
// ═══════════════════════════════════════════════════════════════
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
    const priceXAF = Math.round(rateXAF * AFB_MULTIPLIER);
    const qty = parseInt(quantity);
    const isPackage = (service.type || '').toLowerCase().includes('package');
    const cost = isPackage ? priceXAF : Math.round((priceXAF / 1000) * qty);

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
      transaction.update(freshUserRef, { balance: newBalance });

      const orderRef = db.collection('autoOrders').doc();
      transaction.set(orderRef, {
        orderId: finalOrderId, userId: uid, provider: 'afriqueboost', providerOrderId: orderResult.order,
        serviceId: parseInt(serviceId), serviceName: service.name, platform, link, quantity: qty,
        priceXAF: cost, status: 'En attente', createdAt: admin.firestore.FieldValue.serverTimestamp(),
        providerStartCount: 0, providerRemains: qty, refunded: false,
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

// ═══════════════════════════════════════════════════════════════
// SMMGen API
// ═══════════════════════════════════════════════════════════════
let _smmgenServicesCache     = null;
let _smmgenServicesCacheTime = 0;
const SMMGEN_CACHE_TTL = 10 * 60 * 1000;

function getSmmGenPricingMode(type) {
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

function buildSmmGenOrderParams(service, body) {
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

function computeSmmGenCost(service, qty, pricingMode) {
  const rate = parseFloat(service.rate) || 0;
  const priceXAF = Math.round(rate * SMMGEN_USD_TO_XAF * SMMGEN_MULTIPLIER);

  if (pricingMode === 'package') {
    return priceXAF;
  } else if (pricingMode === 'per_unit') {
    return Math.round(priceXAF * qty);
  } else {
    return Math.round((priceXAF / 1000) * qty);
  }
}

app.get('/api/smmgen/services', async (req, res) => {
  try {
    const now = Date.now();
    if (_smmgenServicesCache && (now - _smmgenServicesCacheTime) < SMMGEN_CACHE_TTL) {
      return res.json({ success: true, services: _smmgenServicesCache, cached: true });
    }
    const rawServices = await callSmmGen({ action: 'services' });
    if (!Array.isArray(rawServices)) return res.status(500).json({ success: false, error: 'Réponse SMMGen invalide' });

    const services = rawServices.map(s => {
      const rate = parseFloat(s.rate) || 0;
      const priceXAF = Math.round(rate * SMMGEN_USD_TO_XAF * SMMGEN_MULTIPLIER);
      const type = s.type || 'Default';
      const pricingMode = getSmmGenPricingMode(type);

      return {
        id: parseInt(s.service),
        provider: 'smmgen',
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

    _smmgenServicesCache = services;
    _smmgenServicesCacheTime = now;
    res.json({ success: true, services });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/api/smmgen/order', checkAuth, async (req, res) => {
  const uid = req.user.uid;
  const { serviceId, link } = req.body;

  if (!serviceId || !link) {
    return res.status(400).json({ success: false, error: 'serviceId et link sont requis.' });
  }

  try {
    let allServices;
    if (_smmgenServicesCache) {
      allServices = _smmgenServicesCache;
    } else {
      allServices = await callSmmGen({ action: 'services' });
    }

    const service = allServices.find(s => parseInt(s.service || s.id) === parseInt(serviceId));
    if (!service) {
      return res.status(400).json({ success: false, error: 'Service SMMGen introuvable.' });
    }

    if (service.provider && service.provider !== 'smmgen') {
      return res.status(400).json({ success: false, error: 'Ce service n\'appartient pas à SMMGen.' });
    }

    const type = service.type || 'Default';
    const pricingMode = getSmmGenPricingMode(type);

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

    const cost = computeSmmGenCost(service, qty, pricingMode);

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

    const orderParams = buildSmmGenOrderParams(service, req.body);
    const orderResult = await callSmmGen(orderParams);

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
      transaction.update(freshUserRef, { balance: newBalance });

      const orderRef = db.collection('autoOrders').doc();
      transaction.set(orderRef, {
        orderId: finalOrderId,
        userId: uid,
        provider: 'smmgen',
        providerOrderId: providerOrderId,
        providerServiceId: parseInt(serviceId),
        serviceId: parseInt(serviceId),
        serviceName: service.name,
        serviceType: type,
        platform: platform,
        link: link,
        quantity: qty,
        priceXAF: cost,
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
    console.error('SMMGen order error:', error);
    if (error.message.toLowerCase().includes('insuffisant')) {
      return res.status(400).json({ success: false, error: error.message });
    }
    res.status(500).json({ success: false, error: 'Erreur technique. Veuillez réessayer.' });
  }
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

    if (orderData.provider !== 'smmgen') {
      return res.status(400).json({ success: false, error: 'Cette commande n\'est pas une commande SMMGen.' });
    }

    const statusResult = await callSmmGen({ action: 'status', order: orderData.providerOrderId });

    if (statusResult.error) {
      return res.status(400).json({ success: false, error: 'Erreur SMMGen: ' + statusResult.error });
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
    console.error('SMMGen status error:', error);
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

    if (orderData.provider !== 'smmgen') {
      return res.status(400).json({ success: false, error: 'Cette commande n\'est pas une commande SMMGen.' });
    }

    let serviceSupportsRefill = true;
    if (_smmgenServicesCache) {
      const svc = _smmgenServicesCache.find(s => s.id === orderData.providerServiceId);
      if (svc && svc.refill === false) {
        serviceSupportsRefill = false;
      }
    }

    if (!serviceSupportsRefill) {
      return res.status(400).json({ success: false, error: 'Ce service ne supporte pas le refill.' });
    }

    const result = await callSmmGen({ action: 'refill', order: orderData.providerOrderId });

    if (result.error) {
      return res.status(400).json({ success: false, error: 'Erreur SMMGen: ' + result.error });
    }

    await orderDoc.ref.update({
      lastRefill: admin.firestore.FieldValue.serverTimestamp(),
      refillId: result.refill || null,
      refillStatus: 'En attente',
    });

    res.json({ success: true, refillId: result.refill });

  } catch (error) {
    console.error('SMMGen refill error:', error);
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

    const result = await callSmmGen({ action: 'refill_status', refill: refillId });

    if (result.error) {
      return res.status(400).json({ success: false, error: 'Erreur SMMGen: ' + result.error });
    }

    if (orderId && result.status) {
      await db.collection('autoOrders').doc(orderId).update({
        refillStatus: result.status,
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      });
    }

    res.json({ success: true, status: result.status, refillId: refillId });

  } catch (error) {
    console.error('SMMGen refill status error:', error);
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

    if (orderData.provider !== 'smmgen') {
      return res.status(400).json({ success: false, error: 'Cette commande n\'est pas une commande SMMGen.' });
    }

    if (orderData.refunded) {
      return res.status(400).json({ success: false, error: 'Cette commande a déjà été remboursée.' });
    }

    const currentStatus = (orderData.status || '').toLowerCase();
    if (!['en attente', 'pending', 'en cours', 'in progress', 'processing'].includes(currentStatus)) {
      return res.status(400).json({ success: false, error: 'Cette commande ne peut plus être annulée, son statut ne le permet pas.' });
    }

    try {
      await callSmmGen({ action: 'cancel', orders: orderData.providerOrderId });
    } catch (smmgenErr) {
      console.error('SMMGen cancel error:', smmgenErr);
    }

    res.json({
      success: true,
      message: "Demande d'annulation transmise au fournisseur. Le remboursement sera effectué automatiquement dès que le fournisseur confirmera l'annulation."
    });

  } catch (error) {
    console.error('SMMGen cancel error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ═══════════════════════════════════════════════════════════════
// Routes utilisateur
// ═══════════════════════════════════════════════════════════════
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
    const newSettings = req.body;

    if (!newSettings || typeof newSettings !== 'object' || Object.keys(newSettings).length === 0) {
      return res.status(400).json({ success: false, error: 'Aucun paramètre fourni.' });
    }

    const updatePayload = {};
    for (const [key, value] of Object.entries(newSettings)) {
      updatePayload[`settings.${key}`] = value;
    }
    updatePayload.updatedAt = admin.firestore.FieldValue.serverTimestamp();

    await db.collection('users').doc(uid).update(updatePayload);

    res.json({ success: true, message: 'Paramètres mis à jour avec succès.' });
  } catch (error) {
    if (error.code === 5) {
      await db.collection('users').doc(req.user.uid).set({
        settings: req.body,
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      }, { merge: true });
      return res.json({ success: true, message: 'Paramètres créés et mis à jour avec succès.' });
    }
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
      res.json({ success: true, hasKey: true, createdAt: data.apiKeyCreatedAt });
    } else {
      res.json({ success: true, hasKey: false });
    }
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/api/user/generate-api-key', checkAuth, async (req, res) => {
  try {
    const uid = req.user.uid;

    const newApiKey = 'sbh_live_' + crypto.randomBytes(24).toString('hex');

    await db.collection('users').doc(uid).set({
      apiKey: newApiKey,
      apiKeyCreatedAt: admin.firestore.FieldValue.serverTimestamp()
    }, { merge: true });

    res.json({ success: true, apiKey: newApiKey });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Erreur lors de la génération de la clé API.' });
  }
});

// ═══════════════════════════════════════════════════════════════
// Fapshi – Paiement Mobile Money (INCHANGÉ)
// ═══════════════════════════════════════════════════════════════
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

// ═══════════════════════════════════════════════════════════════
// NelsiusPay – Paiement par carte bancaire Visa/Mastercard
// ═══════════════════════════════════════════════════════════════
const NELSIUSPAY_API_URL          = 'https://api.nelsiuspay.com/api/v1';
const NELSIUSPAY_MIN_AMOUNT_XAF   = 1380;   // 2 € × 690 XAF
const NELSIUSPAY_MAX_AMOUNT_XAF   = 10000000;
const NELSIUSPAY_FEE_BEARER       = 'customer';
const NELSIUSPAY_MIN_PROVIDER_AMT = 100;    // minimum imposé par NelsiusPay dans la devise envoyée

/**
 * Table de taux de change — convention : 1 unité de devise = X XAF.
 * Synchronisée avec CURRENCIES du frontend (paiement-carte.html).
 * Taux EUR fixé par SBH à 690 XAF.
 */
const SBH_CURRENCY_RATES = {
  'XAF': 1,
  'XOF': 1,
  'USD': 590,
  'EUR': 690,
  'GBP': 771.60,
  'CAD': 408.95,
  'CHF': 703.08,
  'JPY': 3.6921,
  'CNY': 86.92,
  'INR': 6.0616,
  'AED': 158.68,
  'SAR': 155.20,
  'TRY': 11.86,
  'RUB': 6.9466,
  'ZAR': 35.01,
  'MAD': 58.68,
  'GHS': 49.67,
  'NGN': 0.4346,
  'KES': 4.4919,
  'UGX': 0.1577,
  'TZS': 0.2260,
  'RWF': 0.4200,
  'ZMW': 24.39,
  'CDF': 0.2344,
  'AOA': 0.6400,
  'MZN': 9.1200,
  'BRL': 103.50,
  'MXN': 29.60,
  'AUD': 375.40,
  'NZD': 340.20,
  'KRW': 0.4233,
  'SGD': 432.10,
  'THB': 16.90,
  'MYR': 130.20,
  'IDR': 0.0373,
  'PHP': 10.35,
  'VND': 0.0230,
  'PLN': 147.80,
  'SEK': 54.20,
  'NOK': 52.80,
  'DKK': 92.60,
  'CZK': 25.10,
  'HUF': 1.5900,
  'RON': 138.70,
  'BGN': 352.80,
  'HRK': 91.50,
  'UAH': 14.05,
  'ILS': 158.30,
  'EGP': 11.90,
  'TND': 187.60,
  'DZD': 4.3500,
  'LYD': 120.50,
  'QAR': 159.80,
  'KWD': 1898.00,
  'BHD': 1545.00,
  'OMR': 1514.00,
  'JOD': 822.00,
  'LBP': 0.0065,
  'PKR': 2.0800,
  'BDT': 4.8300,
  'LKR': 1.9800,
  'NPR': 3.7800,
  'MUR': 12.60,
  'SCR': 42.30,
  'MGA': 0.1300,
  'MVR': 37.80,
  'AFN': 7.8000,
  'IRR': 0.0138,
  'IQD': 0.4450,
  'SYP': 0.0440,
  'YER': 2.3800,
  'ETB': 4.1500,
  'GMD': 8.2000,
  'GNF': 0.0670,
  'LRD': 3.0200,
  'SLL': 0.0270,
  'SOS': 1.0100,
  'SDG': 0.9700,
  'SSP': 0.4500,
  'DJF': 3.2800,
  'KMF': 1.3800,
  'CVE': 6.3100,
  'STN': 28.20,
  'BIF': 0.2000,
  'ERN': 38.80,
  'LSL': 35.10,
  'SZL': 35.10,
  'NAD': 35.10,
  'BWP': 44.50,
  'MWK': 0.3350,
  'ZWG': 22.10,
  'ZWL': 0.0020,
  'ALL': 6.30,
  'XCD': 215.80,
  'AMD': 1.50,
  'AZN': 347.00,
  'BSD': 582.82,
  'BBD': 291.41,
  'BZD': 291.41,
  'BTN': 6.06,
  'BYN': 178.00,
  'MMK': 0.28,
  'BOB': 84.50,
  'BAM': 352.80,
  'BND': 432.10,
  'KHR': 0.14,
  'KPW': 0.65,
  'CRC': 1.13,
  'CUP': 24.28,
  'ANG': 325.60,
  'GIP': 771.60,
  'GTQ': 75.10,
  'GYD': 2.79,
  'HTG': 4.42,
  'HNL': 23.50,
  'ISK': 4.20,
  'JMD': 3.75,
  'KZT': 1.20,
  'KGS': 6.67,
  'LAK': 0.027,
  'MKD': 10.20,
  'MDL': 32.80,
  'MNT': 0.17,
  'NIO': 16.00,
  'XPF': 5.78,
  'UZS': 0.046,
  'PAB': 582.82,
  'PGK': 155.00,
  'PYG': 0.079,
  'HKD': 74.60,
  'RSD': 5.88,
  'SRD': 16.50,
  'TJS': 53.50,
  'TWD': 18.30,
  'TOP': 245.00,
  'TTD': 86.00,
  'TMT': 166.50,
  'WST': 210.00,
  'SBD': 71.00,
  'MRU': 14.68,
  'PEN': 155.00,
  'CLP': 0.61,
  'COP': 0.14,
  'ARS': 1.40,
  'UYU': 14.60,
  'VES': 16.00,
  'GEL': 216.00,
  'FJD': 258.00,
  'VUV': 4.90,
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

// ── POST /api/nelsiuspay/checkout ─────────────────────────────
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

// ── POST /api/nelsiuspay/status ───────────────────────────────
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
      await creditUserIfNeeded(reference, uid, transData);
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

// ── POST /api/nelsiuspay/webhook ──────────────────────────────
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
      await creditUserIfNeeded(reference, transData.userId, transData);
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

    console.log(`[NelsiusPay] Crédit effectué: +${amountToCredit} XAF → ${userId} (solde: ${currentBalance} → ${newBalance})`);
  });
}

// ═══════════════════════════════════════════════════════════════
// NOUVEAU — Suivi des visites dashboard + Gestion des cadeaux
// de bienvenue sécurisée (IP + téléphone + email + compte)
// ═══════════════════════════════════════════════════════════════

/**
 * Récupère l'IP client de la manière la plus fiable possible,
 * même derrière un proxy (Render, Vercel, Cloudflare, etc.).
 */
function getClientIp(req) {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.length) {
    // x-forwarded-for peut contenir plusieurs IP séparées par des virgules
    // (client, proxy1, proxy2...). La première est l'IP réelle du client.
    return forwarded.split(',')[0].trim();
  }
  return (req.ip || req.connection?.remoteAddress || req.socket?.remoteAddress || 'unknown').toString();
}

/**
 * Hash stable d'une chaîne (IP / numéro) — 32 caractères hex.
 * On ne stocke JAMAIS l'IP en clair dans Firestore (RGPD-friendly).
 */
function sha256Short(str) {
  return crypto.createHash('sha256').update(String(str)).digest('hex').slice(0, 32);
}

/**
 * Normalise un numéro WhatsApp : on enlève tout sauf les chiffres
 * et le premier "+" éventuel, pour éviter les doublons du type
 * "+237699853665" vs "00237699853665" vs "237 699 85 36 65".
 */
function normalizeWhatsappNumber(input) {
  if (!input) return '';
  let digits = String(input).replace(/[^0-9]/g, '');
  // Retire les zéros de tête "00" (format international composé)
  digits = digits.replace(/^00+/, '');
  return digits;
}

// ── POST /api/track-dashboard-visit ───────────────────────────
app.post('/api/track-dashboard-visit', async (req, res) => {
  try {
    const { userId } = req.body || {};
    if (!userId) return res.json({ success: true, shouldShowPromo: false });

    const userRef = db.collection('users').doc(userId);
    const userDoc = await userRef.get();

    const visitCount = userDoc.exists ? (userDoc.data().dashboardVisitCount || 0) : 0;
    const lastPromoSeen = userDoc.exists ? userDoc.data().lastPromoSeen : null;
    const lastPromoMs = getTimestampMs(lastPromoSeen);

    // Décision d'affichage de la promo :
    //  - Jamais vue → afficher
    //  - Vue il y a plus de 24h → afficher
    const shouldShowPromo = !lastPromoMs || (Date.now() - lastPromoMs) > 24 * 60 * 60 * 1000;

    await userRef.set({
      dashboardVisitCount: visitCount + 1,
      lastDashboardVisit: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });

    return res.json({ success: true, shouldShowPromo });
  } catch (error) {
    console.error('Erreur /api/track-dashboard-visit:', error);
    return res.json({ success: false, shouldShowPromo: false });
  }
});

// ── POST /api/mark-promo-seen ─────────────────────────────────
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

// ── GET /api/check-gift-eligibility ───────────────────────────
// Utilisé par le dashboard au chargement : { eligible: true/false, reason? }
app.get('/api/check-gift-eligibility', checkAuth, async (req, res) => {
  try {
    const uid = req.user.uid;
    const ip  = getClientIp(req);
    const ipHash = sha256Short('ip:' + ip);

    // 1) L'utilisateur a-t-il déjà réclamé ?
    const userDoc = await db.collection('users').doc(uid).get();
    if (userDoc.exists && userDoc.data().welcomeGiftClaimed === true) {
      return res.json({ eligible: false, reason: 'already_claimed' });
    }

    // 2) L'IP a-t-elle déjà servi à réclamer ?
    const ipDoc = await db.collection('welcomeGiftIps').doc(ipHash).get();
    if (ipDoc.exists) {
      return res.json({ eligible: false, reason: 'ip_already_claimed' });
    }

    // 3) Compte trop ancien (> 7 jours) → plus éligible
    if (userDoc.exists) {
      const createdMs = getTimestampMs(userDoc.data().createdAt);
      if (createdMs && (Date.now() - createdMs) > 7 * 24 * 60 * 60 * 1000) {
        return res.json({ eligible: false, reason: 'account_too_old' });
      }
    }

    return res.json({ eligible: true });
  } catch (error) {
    console.error('Erreur /api/check-gift-eligibility:', error);
    // En cas d'erreur, on refuse par défaut (sécurité)
    return res.json({ eligible: false, reason: 'error' });
  }
});

// ── POST /api/claim-welcome-gift ──────────────────────────────
app.post('/api/claim-welcome-gift', checkAuth, async (req, res) => {
  try {
    const uid = req.user.uid;
    const { giftType, whatsapp, platform, link } = req.body || {};

    // ── Validations d'entrée ──
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

    // ── Transaction atomique : tout ou rien ──
    await db.runTransaction(async (t) => {
      const userDoc  = await t.get(userRef);
      const ipDoc    = await t.get(ipRef);
      const phoneDoc = await t.get(phoneRef);
      const emailDoc = emailRef ? await t.get(emailRef) : null;

      // a) Déjà réclamé par cet utilisateur ?
      if (userDoc.exists && userDoc.data().welcomeGiftClaimed === true) {
        throw new Error('ALREADY_CLAIMED');
      }

      // b) Déjà réclamé depuis cette IP ?
      if (ipDoc.exists) {
        throw new Error('IP_ALREADY_CLAIMED');
      }

      // c) Déjà réclamé avec ce numéro WhatsApp ?
      if (phoneDoc.exists) {
        throw new Error('PHONE_ALREADY_CLAIMED');
      }

      // d) Déjà réclamé avec cet email ?
      if (emailDoc && emailDoc.exists) {
        throw new Error('EMAIL_ALREADY_CLAIMED');
      }

      // e) Compte trop ancien ?
      if (userDoc.exists) {
        const createdMs = getTimestampMs(userDoc.data().createdAt);
        if (createdMs && (Date.now() - createdMs) > 7 * 24 * 60 * 60 * 1000) {
          throw new Error('ACCOUNT_TOO_OLD');
        }
      }

      // ── Création des enregistrements ──
      const claimRef = db.collection('welcomeGiftClaims').doc();
      t.set(claimRef, {
        userId: uid,
        email: req.user.email || null,
        giftType,
        whatsapp: whatsappClean,
        platform: platform || null,
        link: link || null,
        ipHash,
        status: 'pending',
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      t.set(ipRef, {
        userId: uid,
        giftType,
        claimedAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      t.set(phoneRef, {
        userId: uid,
        giftType,
        claimedAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      if (emailRef) {
        t.set(emailRef, {
          userId: uid,
          giftType,
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

// ═══════════════════════════════════════════════════════════════
// ADMIN API (ZÉRO LECTURE FIRESTORE)
// ═══════════════════════════════════════════════════════════════
const ADMIN_PASSWORD = '209644209644';
function checkAdminPassword(req, res, next) {
  const pass = req.headers['x-admin-password'];
  if (!pass || pass !== ADMIN_PASSWORD) {
    return res.status(403).json({ success: false, error: 'Accès refusé. Clé invalide.' });
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

  if (process.env.SMMGEN_API_KEY) {
    try {
      const smmgenData = await callSmmGen({ action: 'services' });
      if (Array.isArray(smmgenData)) {
        smmgenData.forEach(s => {
          const rate = parseFloat(s.rate) || 0; const providerCost = Math.round(rate * SMMGEN_USD_TO_XAF);
          const finalPrice = Math.round(providerCost * SMMGEN_MULTIPLIER); const profit = finalPrice - providerCost;
          allServices.push({ id: s.service, provider: 'SMMGen', name: s.name, category: s.category || '', providerCost, finalPrice, profit, profitMargin: Math.round((profit / finalPrice) * 100) || 0, min: parseInt(s.min) || 0, max: parseInt(s.max) || 0 });
        });
      }
    } catch (e) { console.warn('Erreur SMMGen:', e.message); }
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
  };
  adminCache.services = result; adminCache.lastFetch.services = Date.now();
  return result;
}

const adminRouter = express.Router();
adminRouter.use(checkAdminPassword);

adminRouter.get('/ping', (req, res) => res.json({ success: true, message: 'Admin API accessible' }));
adminRouter.get('/services', async (req, res) => {
  try {
    res.json({ success: true, data: await getServicesData() });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.use('/api/admin', adminRouter);

app.use((req, res) => res.status(404).json({ success: false, error: `Route non trouvée : ${req.method} ${req.path}` }));
app.use((err, req, res, next) => {
  res.status(500).json({ success: false, error: err.message || 'Erreur interne.' });
});

module.exports = app;