/**
 * API Publique Social Boost Horizon — Routeur Express exportable
 *
 * ⚠️ CONFIDENTIEL : Ce fichier ne doit JAMAIS exposer les noms
 * des fournisseurs partenaires. Les identifiants publics utilisent
 * des codes opaques SBH1, SBH2, SBH3, SBH4.
 */

const express = require('express');

module.exports = function createPublicRouter(deps) {
  const {
    db, admin,
    callMTP, callExo, callAfriqueBoost, callSmmWiz,
    detectPlatformName,
    MTP_USD_TO_XAF, MTP_MULTIPLIER,
    EXO_USD_TO_XAF, EXO_MULTIPLIER,
    AFB_MULTIPLIER,
    SMMWIZ_USD_TO_XAF, SMMWIZ_MULTIPLIER,
  } = deps;

  if (!db || !admin) throw new Error('createPublicRouter: db et admin sont requis.');
  if (typeof callMTP !== 'function' || typeof callAfriqueBoost !== 'function' || typeof callSmmWiz !== 'function') {
    throw new Error('createPublicRouter: helpers fournisseurs manquants.');
  }

  // ═══════════════════════════════════════════════════════════════
  // CODES SOURCES PUBLIQUES — SBH1 / SBH2 / SBH3 / SBH4
  // Ne JAMAIS révéler la vraie source derrière chaque code.
  // ═══════════════════════════════════════════════════════════════
  const PROVIDER_CODES = {
    'mtp':          'SBH1',
    'exo':          'SBH2',
    'afriqueboost': 'SBH3',
    'smmwiz':       'SBH4',
  };
  const CODES_TO_PROVIDER = {};
  Object.keys(PROVIDER_CODES).forEach(k => { CODES_TO_PROVIDER[PROVIDER_CODES[k]] = k; });
  const PUBLIC_SOURCES = Object.values(PROVIDER_CODES); // ['SBH1','SBH2','SBH3','SBH4']

  const router = express.Router();

  let _catalogCache = null;
  let _catalogCacheTime = 0;
  const CATALOG_TTL = 5 * 60 * 1000;

  function getTimestampMs(val) {
    if (!val) return 0;
    if (typeof val.toDate === 'function') return val.toDate().getTime();
    if (val instanceof Date) return val.getTime();
    if (typeof val === 'number') return val;
    const parsed = new Date(val).getTime();
    return isNaN(parsed) ? 0 : parsed;
  }

  function makeEntry(s, providerKey, rate, usdToXaf, multiplier) {
    const priceXAF = usdToXaf
      ? Math.round(rate * usdToXaf * multiplier)
      : Math.round(rate * multiplier);
    if (priceXAF <= 0 || !s.service) return null;
    return {
      service_id: `sbh_${PROVIDER_CODES[providerKey]}_${s.service}`,
      provider: 'sbh',
      source: PROVIDER_CODES[providerKey],
      name: s.name || '',
      category: s.category || '',
      type: s.type || 'default',
      price_per_1000: priceXAF,
      min: parseInt(s.min) || 0,
      max: parseInt(s.max) || 0,
      refill: s.refill === true || s.refill === 'true' || s.refill === 1,
      cancel: s.cancel === true || s.cancel === 'true' || s.cancel === 1,
      description: s.description || null,
    };
  }

  async function buildCatalog() {
    const now = Date.now();
    if (_catalogCache && (now - _catalogCacheTime) < CATALOG_TTL) return _catalogCache;

    const services = [];

    // ── SBH1 ──
    try {
      const raw = await callMTP({ action: 'services' });
      if (Array.isArray(raw)) {
        raw.forEach(s => {
          const e = makeEntry(s, 'mtp', parseFloat(s.rate) || 0, MTP_USD_TO_XAF, MTP_MULTIPLIER);
          if (e) services.push(e);
        });
      }
    } catch (e) { console.error('[public/catalog] SBH1 indisponible:', e.message); }

    // ── SBH2 ──
    if (typeof callExo === 'function' && EXO_USD_TO_XAF && EXO_MULTIPLIER) {
      try {
        const raw = await callExo({ action: 'services' });
        if (Array.isArray(raw)) {
          raw.forEach(s => {
            const e = makeEntry(s, 'exo', parseFloat(s.rate) || 0, EXO_USD_TO_XAF, EXO_MULTIPLIER);
            if (e) services.push(e);
          });
        }
      } catch (e) { console.error('[public/catalog] SBH2 indisponible:', e.message); }
    }

    // ── SBH3 ──
    try {
      const raw = await callAfriqueBoost({ action: 'services' });
      if (Array.isArray(raw)) {
        raw.forEach(s => {
          const e = makeEntry(s, 'afriqueboost', parseFloat(s.rate) || 0, null, AFB_MULTIPLIER);
          if (e) services.push(e);
        });
      }
    } catch (e) { console.error('[public/catalog] SBH3 indisponible:', e.message); }

    // ── SBH4 ──
    try {
      const raw = await callSmmWiz({ action: 'services' });
      if (Array.isArray(raw)) {
        raw.forEach(s => {
          const e = makeEntry(s, 'smmwiz', parseFloat(s.rate) || 0, SMMWIZ_USD_TO_XAF, SMMWIZ_MULTIPLIER);
          if (e) services.push(e);
        });
      }
    } catch (e) { console.error('[public/catalog] SBH4 indisponible:', e.message); }

    _catalogCache = services;
    _catalogCacheTime = Date.now();
    console.log(`[public/catalog] ${services.length} services exposés (sources SBH1-SBH4)`);
    return services;
  }

  async function authenticateApiKey(req, res, next) {
    const apiKey = req.header('X-Api-Key');
    if (!apiKey || typeof apiKey !== 'string' || apiKey.length < 10) {
      return res.status(401).json({ success: false, error: 'Clé API manquante ou invalide.' });
    }
    try {
      const snapshot = await db.collection('users').where('apiKey', '==', apiKey).limit(1).get();
      if (snapshot.empty) {
        return res.status(401).json({ success: false, error: 'Clé API invalide ou révoquée.' });
      }
      const userDoc = snapshot.docs[0];
      req.apiUser = Object.assign({ uid: userDoc.id }, userDoc.data());
      req.apiKey = apiKey;
      next();
    } catch (err) {
      console.error('[public/auth]', err);
      return res.status(500).json({ success: false, error: "Erreur d'authentification." });
    }
  }

  router.use(authenticateApiKey);

  // ─── GET /api/v1/balance ─────────────────────────────────────
  router.get('/balance', async (req, res) => {
    try {
      const userDoc = await db.collection('users').doc(req.apiUser.uid).get();
      if (!userDoc.exists) return res.status(404).json({ success: false, error: 'Compte introuvable.' });
      const data = userDoc.data();
      res.json({ success: true, balance: Math.round(data.balance || 0), currency: 'XAF' });
    } catch (err) {
      console.error('[public/balance]', err);
      res.status(500).json({ success: false, error: 'Erreur serveur.' });
    }
  });

  // ─── GET /api/v1/sources ─────────────────────────────────────
  // Renvoie la liste des sources publiques (SBH1, SBH2, SBH3, SBH4)
  // + le nombre de services disponibles par source.
  router.get('/sources', async (req, res) => {
    try {
      const services = await buildCatalog();
      const counts = {};
      PUBLIC_SOURCES.forEach(src => { counts[src] = 0; });
      services.forEach(s => {
        if (s.source && counts[s.source] !== undefined) counts[s.source]++;
      });
      const sources = PUBLIC_SOURCES.map(code => ({
        code,
        count: counts[code]
      }));
      res.json({ success: true, sources, total: services.length });
    } catch (err) {
      console.error('[public/sources]', err);
      res.status(500).json({ success: false, error: 'Erreur serveur.' });
    }
  });

  // ─── GET /api/v1/services ────────────────────────────────────
  router.get('/services', async (req, res) => {
    try {
      const services = await buildCatalog();
      const catalog = (req.query.catalog || '').toString().trim().toLowerCase();
      const source  = (req.query.source  || '').toString().trim().toUpperCase();

      let filtered = services;

      // Filtre par source (SBH1, SBH2, SBH3, SBH4)
      if (source) {
        if (!PUBLIC_SOURCES.includes(source)) {
          return res.status(400).json({
            success: false,
            error: 'Source inconnue. Sources valides : ' + PUBLIC_SOURCES.join(', ')
          });
        }
        filtered = filtered.filter(s => s.source === source);
      }

      // Filtre par catégorie
      if (catalog) {
        filtered = filtered.filter(s => (s.category || '').toLowerCase().includes(catalog));
      }

      res.json({
        success: true,
        services: filtered,
        total: filtered.length,
        sources: PUBLIC_SOURCES
      });
    } catch (err) {
      console.error('[public/services]', err);
      res.status(500).json({ success: false, error: 'Erreur serveur.' });
    }
  });

  // ─── POST /api/v1/order ──────────────────────────────────────
  router.post('/order', async (req, res) => {
    try {
      const body = req.body || {};
      const serviceIdRaw = body.service_id;
      const link = body.link;
      const quantityRaw = body.quantity;
      const comments = body.comments;

      if (serviceIdRaw === undefined || serviceIdRaw === null || !link || quantityRaw === undefined) {
        return res.status(400).json({ success: false, error: 'Paramètres requis : service_id, link, quantity.' });
      }
      if (typeof link !== 'string' || link.length < 4 || link.length > 800) {
        return res.status(400).json({ success: false, error: 'Lien invalide.' });
      }
      const qty = parseInt(quantityRaw, 10);
      if (!Number.isInteger(qty) || qty <= 0) {
        return res.status(400).json({ success: false, error: 'Quantité invalide.' });
      }

      const serviceIdStr = String(serviceIdRaw);
      const parts = serviceIdStr.split('_');
      if (parts.length !== 3 || parts[0] !== 'sbh') {
        return res.status(400).json({ success: false, error: 'Format service_id invalide.' });
      }
      const providerCode = parts[1];
      const providerServiceId = parts[2];
      const provider = CODES_TO_PROVIDER[providerCode];
      if (!provider) {
        return res.status(400).json({ success: false, error: 'Service introuvable dans le catalogue.' });
      }

      const services = await buildCatalog();
      const service = services.find(s => s.service_id === serviceIdStr);
      if (!service) {
        return res.status(400).json({ success: false, error: 'Service introuvable dans le catalogue.' });
      }

      if (qty < service.min) return res.status(400).json({ success: false, error: `Quantité minimale : ${service.min}.` });
      if (qty > service.max) return res.status(400).json({ success: false, error: `Quantité maximale : ${service.max}.` });

      const isPackage = (service.type || '').toLowerCase().includes('package');
      const costRaw = isPackage ? service.price_per_1000 : (service.price_per_1000 / 1000) * qty;
      const cost = Math.max(1, Math.round(costRaw));
      if (!Number.isFinite(cost) || cost <= 0) {
        return res.status(400).json({ success: false, error: 'Coût de commande invalide.' });
      }

      const userDoc = await db.collection('users').doc(req.apiUser.uid).get();
      if (!userDoc.exists) return res.status(404).json({ success: false, error: 'Compte introuvable.' });
      const currentBalance = userDoc.data().balance || 0;
      if (currentBalance < cost) {
        return res.status(400).json({
          success: false,
          error: `Solde insuffisant. Requis : ${cost} XAF, disponible : ${Math.round(currentBalance)} XAF.`
        });
      }

      let providerOrderId = null;

      if (provider === 'mtp') {
        const params = { action: 'add', service: providerServiceId, link, quantity: qty };
        if (comments) params.comments = String(comments).substring(0, 500);
        const result = await callMTP(params);
        if (result.error) return res.status(400).json({ success: false, error: 'Erreur fournisseur : ' + result.error });
        if (!result.order) return res.status(400).json({ success: false, error: 'Commande non confirmée par le fournisseur.' });
        providerOrderId = result.order;
      } else if (provider === 'exo' && typeof callExo === 'function') {
        const params = { action: 'add', service: providerServiceId, link, quantity: qty };
        if (comments) params.comments = String(comments).substring(0, 500);
        const result = await callExo(params);
        if (result.error) return res.status(400).json({ success: false, error: 'Erreur fournisseur : ' + result.error });
        if (!result.order) return res.status(400).json({ success: false, error: 'Commande non confirmée par le fournisseur.' });
        providerOrderId = result.order;
      } else if (provider === 'afriqueboost') {
        const params = { action: 'add', service: providerServiceId, link, quantity: qty };
        if (comments) params.comments = String(comments).substring(0, 500);
        const result = await callAfriqueBoost(params);
        if (result.error) return res.status(400).json({ success: false, error: 'Erreur fournisseur : ' + result.error });
        if (!result.order) return res.status(400).json({ success: false, error: 'Commande non confirmée par le fournisseur.' });
        providerOrderId = result.order;
      } else if (provider === 'smmwiz') {
        const type = (service.type || 'default').toLowerCase();
        if (type !== 'default' && type !== 'package') {
          return res.status(400).json({ success: false, error: "Ce type de service n'est pas encore supporté par l'API publique." });
        }
        const params = { action: 'add', service: providerServiceId, link };
        if (type === 'default') params.quantity = qty;
        const result = await callSmmWiz(params);
        if (result.error) return res.status(400).json({ success: false, error: 'Erreur fournisseur : ' + result.error });
        if (!result.order) return res.status(400).json({ success: false, error: 'Commande non confirmée par le fournisseur.' });
        providerOrderId = result.order;
      } else {
        return res.status(400).json({ success: false, error: "Service temporairement indisponible." });
      }

      let finalOrderId;
      let newBalance;
      await db.runTransaction(async (transaction) => {
        const counterRef = db.collection('counters').doc('autoOrders');
        const freshUserRef = db.collection('users').doc(req.apiUser.uid);
        const counterDoc = await transaction.get(counterRef);
        const freshUserDoc = await transaction.get(freshUserRef);

        if (!freshUserDoc.exists) throw new Error('USER_NOT_FOUND');
        const freshBalance = freshUserDoc.data().balance || 0;
        if (freshBalance < cost) throw new Error('INSUFFICIENT_BALANCE');

        const nextId = ((counterDoc.exists ? counterDoc.data().lastId : 0) || 0) + 1;
        finalOrderId = `SBH-AUTO-${nextId}`;
        newBalance = freshBalance - cost;
        const platform = detectPlatformName(service.name || '', link);

        transaction.set(counterRef, { lastId: nextId }, { merge: true });
        transaction.update(freshUserRef, {
          balance: newBalance,
          totalOrders: admin.firestore.FieldValue.increment(1),
          totalSpent: admin.firestore.FieldValue.increment(cost),
        });

        const orderRef = db.collection('autoOrders').doc();
        transaction.set(orderRef, {
          orderId: finalOrderId,
          userId: req.apiUser.uid,
          provider: provider,
          providerOrderId,
          serviceId: parseInt(providerServiceId, 10) || 0,
          serviceName: service.name,
          platform, link, quantity: qty, priceXAF: cost,
          status: 'En attente',
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
          providerStartCount: 0,
          providerRemains: qty,
          refunded: false,
          source: 'public_api',
        });
      });

      return res.json({
        success: true,
        order_id: finalOrderId,
        service: service.name,
        quantity: qty,
        price: cost,
        currency: 'XAF',
        balance: Math.round(newBalance),
        status: 'pending'
      });

    } catch (err) {
      if (err.message === 'INSUFFICIENT_BALANCE') {
        return res.status(400).json({ success: false, error: 'Solde insuffisant (vérifié pendant le traitement).' });
      }
      if (err.message === 'USER_NOT_FOUND') {
        return res.status(404).json({ success: false, error: 'Compte introuvable.' });
      }
      console.error('[public/order]', err);
      return res.status(500).json({ success: false, error: 'Erreur technique. Veuillez réessayer.' });
    }
  });

  // ─── GET /api/v1/order/:orderId ──────────────────────────────
  router.get('/order/:orderId', async (req, res) => {
    try {
      const { orderId } = req.params;
      if (!orderId) return res.status(400).json({ success: false, error: 'orderId requis.' });
      const snapshot = await db.collection('autoOrders').where('orderId', '==', orderId).limit(1).get();
      if (snapshot.empty) return res.status(404).json({ success: false, error: 'Commande introuvable.' });
      const data = snapshot.docs[0].data();
      if (data.userId !== req.apiUser.uid) {
        return res.status(404).json({ success: false, error: 'Commande introuvable.' });
      }
      res.json({
        success: true,
        order: {
          order_id: data.orderId,
          service: data.serviceName,
          link: data.link,
          quantity: data.quantity,
          price: data.priceXAF,
          currency: 'XAF',
          status: data.status,
          created_at: data.createdAt,
        }
      });
    } catch (err) {
      console.error('[public/order/:id]', err);
      res.status(500).json({ success: false, error: 'Erreur serveur.' });
    }
  });

  // ─── GET /api/v1/orders ──────────────────────────────────────
  router.get('/orders', async (req, res) => {
    try {
      const limitRaw = parseInt(req.query.limit, 10);
      const limit = Math.min(Math.max(isNaN(limitRaw) ? 50 : limitRaw, 1), 200);
      const snapshot = await db.collection('autoOrders').where('userId', '==', req.apiUser.uid).get();
      let orders = snapshot.docs.map(d => {
        const data = d.data();
        return {
          order_id: data.orderId,
          service: data.serviceName,
          quantity: data.quantity,
          price: data.priceXAF,
          status: data.status,
          created_at: data.createdAt,
        };
      });
      orders.sort((a, b) => getTimestampMs(b.created_at) - getTimestampMs(a.created_at));
      orders = orders.slice(0, limit);
      res.json({ success: true, orders, total: orders.length });
    } catch (err) {
      console.error('[public/orders]', err);
      res.status(500).json({ success: false, error: 'Erreur serveur.' });
    }
  });

  router.use((req, res) => {
    res.status(404).json({
      success: false,
      error: `Route publique non trouvée : ${req.method} ${req.originalUrl}`
    });
  });

  return router;
};