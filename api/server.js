/**
 * API Publique Social Boost Horizon — Routeur Express exportable
 *
 * Ce module exporte une FONCTION FACTORY qui crée et renvoie un express.Router
 * destiné à être monté par api/index.js sur le préfixe /api/v1.
 *
 * ⚠️ Ce fichier ne doit JAMAIS appeler app.listen() ni utiliser de données mockées.
 * Toutes les lectures/écritures passent par Firestore et les helpers fournisseurs
 * injectés par index.js.
 *
 * Format des service_id publics : "<provider>_<idFournisseur>"
 *   ex. "mtp_1234", "afb_5678", "smmwiz_910"
 */

const express = require('express');

module.exports = function createPublicRouter(deps) {
  const {
    db,
    admin,
    callMTP,
    callAfriqueBoost,
    callSmmWiz,
    detectPlatformName,
    MTP_USD_TO_XAF,
    MTP_MULTIPLIER,
    AFB_MULTIPLIER,
    SMMWIZ_USD_TO_XAF,
    SMMWIZ_MULTIPLIER,
  } = deps;

  if (!db || !admin) {
    throw new Error('createPublicRouter: db et admin sont requis.');
  }
  if (typeof callMTP !== 'function' || typeof callAfriqueBoost !== 'function' || typeof callSmmWiz !== 'function') {
    throw new Error('createPublicRouter: helpers fournisseurs manquants.');
  }

  const router = express.Router();

  // ─── Cache catalogue (5 min) ─────────────────────────────────
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

  async function buildCatalog() {
    const now = Date.now();
    if (_catalogCache && (now - _catalogCacheTime) < CATALOG_TTL) {
      return _catalogCache;
    }

    const services = [];

    // MTP
    try {
      const raw = await callMTP({ action: 'services' });
      if (Array.isArray(raw)) {
        raw.forEach(s => {
          const rate = parseFloat(s.rate) || 0;
          const priceXAF = Math.round(rate * MTP_USD_TO_XAF * MTP_MULTIPLIER);
          if (priceXAF > 0) {
            services.push({
              service_id: `mtp_${s.service}`,
              provider: 'mtp',
              name: s.name || '',
              category: s.category || '',
              type: s.type || 'default',
              price_per_1000: priceXAF,
              min: parseInt(s.min) || 0,
              max: parseInt(s.max) || 0,
              refill: s.refill === true || s.refill === 'true',
              cancel: s.cancel === true || s.cancel === 'true',
              description: s.description || null,
            });
          }
        });
      }
    } catch (e) {
      console.error('[public/catalog] MTP:', e.message);
    }

    // AfriqueBoost
    try {
      const raw = await callAfriqueBoost({ action: 'services' });
      if (Array.isArray(raw)) {
        raw.forEach(s => {
          const rateXAF = parseFloat(s.rate) || 0;
          const priceXAF = Math.round(rateXAF * AFB_MULTIPLIER);
          if (priceXAF > 0) {
            services.push({
              service_id: `afb_${s.service}`,
              provider: 'afriqueboost',
              name: s.name || '',
              category: s.category || '',
              type: s.type || 'default',
              price_per_1000: priceXAF,
              min: parseInt(s.min) || 0,
              max: parseInt(s.max) || 0,
              refill: s.refill === true || s.refill === 'true' || s.refill === 1,
              cancel: s.cancel === true || s.cancel === 'true' || s.cancel === 1,
              description: s.description || null,
            });
          }
        });
      }
    } catch (e) {
      console.error('[public/catalog] AFB:', e.message);
    }

    // SMMWiz
    try {
      const raw = await callSmmWiz({ action: 'services' });
      if (Array.isArray(raw)) {
        raw.forEach(s => {
          const rate = parseFloat(s.rate) || 0;
          const priceXAF = Math.round(rate * SMMWIZ_USD_TO_XAF * SMMWIZ_MULTIPLIER);
          if (priceXAF > 0) {
            services.push({
              service_id: `smmwiz_${s.service}`,
              provider: 'smmwiz',
              name: s.name || '',
              category: s.category || '',
              type: s.type || 'default',
              price_per_1000: priceXAF,
              min: parseInt(s.min) || 0,
              max: parseInt(s.max) || 0,
              refill: s.refill === true || s.refill === 'true',
              cancel: s.cancel === true || s.cancel === 'true',
              description: s.description || null,
            });
          }
        });
      }
    } catch (e) {
      console.error('[public/catalog] SMMWiz:', e.message);
    }

    _catalogCache = services;
    _catalogCacheTime = Date.now();
    return services;
  }

  // ─── Middleware X-Api-Key ────────────────────────────────────
  async function authenticateApiKey(req, res, next) {
    const apiKey = req.header('X-Api-Key');

    if (!apiKey || typeof apiKey !== 'string' || apiKey.length < 10) {
      return res.status(401).json({
        success: false,
        error: 'Clé API manquante ou invalide.'
      });
    }

    try {
      const snapshot = await db.collection('users')
        .where('apiKey', '==', apiKey)
        .limit(1)
        .get();

      if (snapshot.empty) {
        return res.status(401).json({
          success: false,
          error: 'Clé API invalide ou révoquée.'
        });
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
      if (!userDoc.exists) {
        return res.status(404).json({ success: false, error: 'Compte introuvable.' });
      }
      const data = userDoc.data();
      res.json({
        success: true,
        balance: data.balance || 0,
        currency: 'XAF'
      });
    } catch (err) {
      console.error('[public/balance]', err);
      res.status(500).json({ success: false, error: 'Erreur serveur.' });
    }
  });

  // ─── GET /api/v1/services ────────────────────────────────────
  router.get('/services', async (req, res) => {
    try {
      const services = await buildCatalog();
      const catalog = (req.query.catalog || '').toString().toLowerCase();
      let filtered = services;
      if (catalog) {
        filtered = services.filter(s =>
          s.provider === catalog || (s.category || '').toLowerCase() === catalog
        );
      }
      res.json({
        success: true,
        services: filtered,
        total: filtered.length
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
      const idx = serviceIdStr.indexOf('_');
      if (idx < 1) {
        return res.status(400).json({ success: false, error: 'Format service_id invalide (attendu : "provider_id").' });
      }
      const provider = serviceIdStr.substring(0, idx);
      const providerServiceId = serviceIdStr.substring(idx + 1);

      const services = await buildCatalog();
      const service = services.find(s => s.service_id === serviceIdStr);
      if (!service) {
        return res.status(400).json({ success: false, error: 'Service introuvable dans le catalogue.' });
      }

      if (qty < service.min) {
        return res.status(400).json({ success: false, error: `Quantité minimale : ${service.min}.` });
      }
      if (qty > service.max) {
        return res.status(400).json({ success: false, error: `Quantité maximale : ${service.max}.` });
      }

      const isPackage = (service.type || '').toLowerCase().includes('package');
      const cost = isPackage
        ? service.price_per_1000
        : Math.round((service.price_per_1000 / 1000) * qty);

      if (cost <= 0) {
        return res.status(400).json({ success: false, error: 'Coût de commande invalide.' });
      }

      // Pré-vérification du solde (économie d'appel fournisseur)
      const userDoc = await db.collection('users').doc(req.apiUser.uid).get();
      if (!userDoc.exists) {
        return res.status(404).json({ success: false, error: 'Compte introuvable.' });
      }
      const currentBalance = userDoc.data().balance || 0;
      if (currentBalance < cost) {
        return res.status(400).json({
          success: false,
          error: `Solde insuffisant. Requis : ${cost} XAF, disponible : ${currentBalance} XAF.`
        });
      }

      // Passage de la commande chez le fournisseur
      let providerOrderId = null;
      let providerName = '';

      if (provider === 'mtp') {
        const params = { action: 'add', service: providerServiceId, link, quantity: qty };
        if (comments) params.comments = String(comments).substring(0, 500);
        const result = await callMTP(params);
        if (result.error) return res.status(400).json({ success: false, error: 'Erreur fournisseur : ' + result.error });
        if (!result.order) return res.status(400).json({ success: false, error: 'Commande non confirmée par le fournisseur.' });
        providerOrderId = result.order;
        providerName = 'mtp';
      } else if (provider === 'afb') {
        const params = { action: 'add', service: providerServiceId, link, quantity: qty };
        if (comments) params.comments = String(comments).substring(0, 500);
        const result = await callAfriqueBoost(params);
        if (result.error) return res.status(400).json({ success: false, error: 'Erreur fournisseur : ' + result.error });
        if (!result.order) return res.status(400).json({ success: false, error: 'Commande non confirmée par le fournisseur.' });
        providerOrderId = result.order;
        providerName = 'afriqueboost';
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
        providerName = 'smmwiz';
      } else {
        return res.status(400).json({ success: false, error: "Fournisseur non supporté par l'API publique." });
      }

      // Transaction Firestore : débit + enregistrement
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
          provider: providerName,
          providerOrderId,
          serviceId: parseInt(providerServiceId, 10) || 0,
          serviceName: service.name,
          platform,
          link,
          quantity: qty,
          priceXAF: cost,
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
        balance: newBalance,
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
      if (!orderId) {
        return res.status(400).json({ success: false, error: 'orderId requis.' });
      }

      const snapshot = await db.collection('autoOrders')
        .where('orderId', '==', orderId)
        .limit(1)
        .get();

      if (snapshot.empty) {
        return res.status(404).json({ success: false, error: 'Commande introuvable.' });
      }

      const data = snapshot.docs[0].data();
      if (data.userId !== req.apiUser.uid) {
        // On renvoie 404 plutôt que 403 pour ne pas révéler l'existence de la commande
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

      const snapshot = await db.collection('autoOrders')
        .where('userId', '==', req.apiUser.uid)
        .get();

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

      res.json({
        success: true,
        orders,
        total: orders.length
      });
    } catch (err) {
      console.error('[public/orders]', err);
      res.status(500).json({ success: false, error: 'Erreur serveur.' });
    }
  });

  // ─── Filet de sécurité 404 local au routeur public ───────────
  router.use((req, res) => {
    res.status(404).json({
      success: false,
      error: `Route publique non trouvée : ${req.method} ${req.originalUrl}`
    });
  });

  return router;
};