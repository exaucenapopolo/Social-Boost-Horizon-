// admin.js – Routeur administrateur pour Social Boost Horizon
const express = require('express');
const admin = require('firebase-admin');
const router = express.Router();

// ── VÉRIFICATION FIREBASE ADMIN ──────────────────────────────
if (!admin.apps.length) {
  try {
    const privateKey = process.env.FIREBASE_PRIVATE_KEY
      ? process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n')
      : undefined;

    if (!process.env.FIREBASE_PROJECT_ID || !process.env.FIREBASE_CLIENT_EMAIL || !privateKey) {
      throw new Error('Variables Firebase manquantes');
    }

    admin.initializeApp({
      credential: admin.credential.cert({
        projectId: process.env.FIREBASE_PROJECT_ID,
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
        privateKey,
      }),
    });
    console.log('✅ Firebase Admin initialisé (admin.js)');
  } catch (error) {
    console.error('❌ Erreur Firebase Admin :', error.message);
  }
}

const db = admin.firestore();

// ── MOT DE PASSE ADMIN ─────────────────────────────────────────
const ADMIN_PASSWORD = '209644209644';

// ── MIDDLEWARE DE SÉCURITÉ ─────────────────────────────────────
function checkAdminPassword(req, res, next) {
  const pass = req.headers['x-admin-password'];
  if (!pass || pass !== ADMIN_PASSWORD) {
    return res.status(403).json({ success: false, error: 'Accès refusé. Clé invalide.' });
  }
  next();
}

// ── CACHE MÉMOIRE ──────────────────────────────────────────────
const CACHE_TTL = 15 * 60 * 1000; // 15 minutes
let cache = {
  stats: null,
  services: null,
  users: null,
  orders: null,
  lastFetch: {
    stats: 0,
    services: 0,
    users: 0,
    orders: 0,
  },
};

function isCacheValid(key) {
  return cache[key] && (Date.now() - cache.lastFetch[key] < CACHE_TTL);
}

// ── CONFIGURATION FINANCIÈRE ──────────────────────────────────
const MTP_USD_TO_XAF = 620;
const MTP_MULTIPLIER = 3;
const EXO_USD_TO_XAF = 650;
const EXO_MULTIPLIER = 2.5;

// ── APPELS AUX FOURNISSEURS ──────────────────────────────────
async function callMTP(params) {
  if (!process.env.MORETHANPANEL_API_KEY) {
    throw new Error('MORETHANPANEL_API_KEY manquante');
  }
  const body = new URLSearchParams({ key: process.env.MORETHANPANEL_API_KEY, ...params });
  const res = await fetch('https://morethanpanel.com/api/v2', {
    method: 'POST',
    body,
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  });
  if (!res.ok) throw new Error(`MTP HTTP ${res.status}`);
  return res.json();
}

async function callExo(params) {
  if (!process.env.EXO_API_KEY) {
    throw new Error('EXO_API_KEY manquante');
  }
  const body = new URLSearchParams({ key: process.env.EXO_API_KEY, ...params });
  const res = await fetch('https://exosupplier.com/api/v2', {
    method: 'POST',
    body,
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  });
  if (!res.ok) throw new Error(`EXO HTTP ${res.status}`);
  return res.json();
}

// ── LOGIQUE DE RÉCUPÉRATION DES DONNÉES (RÉUTILISABLE) ─────────

async function getStatsData() {
  if (isCacheValid('stats')) return cache.stats;

  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const weekAgo = new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000);
  const monthAgo = new Date(today.getTime() - 30 * 24 * 60 * 60 * 1000);
  const yearAgo = new Date(today.getTime() - 365 * 24 * 60 * 60 * 1000);

  const [usersCount, mtpOrdersCount, exoOrdersCount] = await Promise.all([
    db.collection('users').count().get(),
    db.collection('autoOrders').count().get(),
    db.collection('commandes').count().get(),
  ]);
  const totalOrders = mtpOrdersCount.data().count + exoOrdersCount.data().count;

  async function getPeriodStats(startDate) {
    const mtpSnap = await db.collection('autoOrders')
      .where('createdAt', '>=', admin.firestore.Timestamp.fromDate(startDate))
      .where('status', 'in', ['Terminé', 'En cours', 'Completed'])
      .get();

    const exoSnap = await db.collection('commandes')
      .where('createdAt', '>=', admin.firestore.Timestamp.fromDate(startDate))
      .where('status', 'in', ['Terminé', 'En cours', 'Completed'])
      .get();

    let revenue = 0, cost = 0;
    mtpSnap.forEach(doc => {
      const data = doc.data();
      const price = data.priceXAF || 0;
      revenue += price;
      cost += price / MTP_MULTIPLIER;
    });
    exoSnap.forEach(doc => {
      const data = doc.data();
      const price = data.totalCost || data.finalCost || data.cost || 0;
      revenue += price;
      cost += price / EXO_MULTIPLIER;
    });
    return { revenue: Math.round(revenue), cost: Math.round(cost), profit: Math.round(revenue - cost) };
  }

  const [todayStats, weekStats, monthStats, yearStats] = await Promise.all([
    getPeriodStats(today),
    getPeriodStats(weekAgo),
    getPeriodStats(monthAgo),
    getPeriodStats(yearAgo),
  ]);

  const stats = {
    totalUsers: usersCount.data().count,
    totalOrders,
    today: todayStats,
    week: weekStats,
    month: monthStats,
    year: yearStats,
    lastUpdated: new Date().toISOString(),
  };

  cache.stats = stats;
  cache.lastFetch.stats = Date.now();
  return stats;
}

async function getServicesData() {
  if (isCacheValid('services')) return cache.services;

  let allServices = [];

  if (process.env.MORETHANPANEL_API_KEY) {
    try {
      const mtpData = await callMTP({ action: 'services' });
      if (Array.isArray(mtpData)) {
        mtpData.forEach(s => {
          const rate = parseFloat(s.rate) || 0;
          const providerCost = Math.round(rate * MTP_USD_TO_XAF);
          const finalPrice = Math.round(providerCost * MTP_MULTIPLIER);
          const profit = finalPrice - providerCost;
          allServices.push({
            id: s.service, provider: 'MTP', name: s.name, category: s.category || '',
            providerCost, finalPrice, profit, profitMargin: Math.round((profit / finalPrice) * 100) || 0,
            min: parseInt(s.min) || 0, max: parseInt(s.max) || 0,
          });
        });
      }
    } catch (e) { console.warn('Erreur MTP services:', e.message); }
  }

  if (process.env.EXO_API_KEY) {
    try {
      const exoData = await callExo({ action: 'services' });
      if (Array.isArray(exoData)) {
        exoData.forEach(s => {
          const rate = parseFloat(s.rate) || 0;
          const providerCost = Math.round(rate * EXO_USD_TO_XAF);
          const finalPrice = Math.round(providerCost * EXO_MULTIPLIER);
          const profit = finalPrice - providerCost;
          allServices.push({
            id: s.service, provider: 'EXO', name: s.name, category: s.category || '',
            providerCost, finalPrice, profit, profitMargin: Math.round((profit / finalPrice) * 100) || 0,
            min: parseInt(s.min) || 0, max: parseInt(s.max) || 0,
          });
        });
      }
    } catch (e) { console.warn('Erreur EXO services:', e.message); }
  }

  const prices = allServices.map(s => s.finalPrice);
  const minPrice = prices.length ? Math.min(...prices) : 0;
  const maxPrice = prices.length ? Math.max(...prices) : 0;
  const avgPrice = prices.length ? Math.round(prices.reduce((a, b) => a + b, 0) / prices.length) : 0;

  const byProvider = {};
  allServices.forEach(s => {
    if (!byProvider[s.provider]) byProvider[s.provider] = [];
    byProvider[s.provider].push(s);
  });

  const result = {
    services: allServices,
    stats: {
      total: allServices.length, minPrice, maxPrice, avgPrice,
      byProvider: Object.keys(byProvider).map(p => ({
        provider: p, count: byProvider[p].length,
        min: Math.min(...byProvider[p].map(s => s.finalPrice)),
        max: Math.max(...byProvider[p].map(s => s.finalPrice)),
        avg: Math.round(byProvider[p].reduce((sum, s) => sum + s.finalPrice, 0) / byProvider[p].length),
      })),
    },
  };

  cache.services = result;
  cache.lastFetch.services = Date.now();
  return result;
}

async function getOrdersData() {
  if (isCacheValid('orders')) return cache.orders;

  const mtpSnap = await db.collection('autoOrders').orderBy('createdAt', 'desc').limit(200).get();
  const mtpOrders = mtpSnap.docs.map(doc => {
    const data = doc.data();
    const price = data.priceXAF || 0;
    const cost = price / MTP_MULTIPLIER;
    return {
      id: doc.id, source: 'MTP', orderId: data.orderId, userId: data.userId,
      serviceName: data.serviceName || 'Service MTP', quantity: data.quantity || 0,
      price, cost, profit: price - cost, profitMargin: price ? Math.round(((price - cost) / price) * 100) : 0,
      status: data.status || 'Inconnu', createdAt: data.createdAt,
    };
  });

  const exoSnap = await db.collection('commandes').orderBy('createdAt', 'desc').limit(200).get();
  const exoOrders = exoSnap.docs.map(doc => {
    const data = doc.data();
    const price = data.totalCost || data.finalCost || data.cost || 0;
    const cost = price / EXO_MULTIPLIER;
    return {
      id: doc.id, source: 'EXO', orderId: data.orderId || data.id, userId: data.userId,
      serviceName: data.serviceName || 'Service EXO', quantity: data.quantity || 0,
      price, cost, profit: price - cost, profitMargin: price ? Math.round(((price - cost) / price) * 100) : 0,
      status: data.status || 'Inconnu', createdAt: data.createdAt,
    };
  });

  const fapshiSnap = await db.collection('fapshiTransactions')
    .where('status', '==', 'CONFIRMED').orderBy('dateConfirmed', 'desc').limit(100).get();
  const fapshiOrders = fapshiSnap.docs.map(doc => {
    const data = doc.data();
    const amount = data.amount || 0;
    const cost = Math.round(amount * 0.8);
    return {
      id: doc.id, source: 'Fapshi', orderId: doc.id, userId: data.userId,
      serviceName: 'Recharge Fapshi', quantity: 1, price: amount, cost, profit: amount - cost,
      profitMargin: amount ? Math.round(((amount - cost) / amount) * 100) : 0,
      status: 'Confirmé', createdAt: data.dateConfirmed || data.dateInitiated,
    };
  });

  const allOrders = [...mtpOrders, ...exoOrders, ...fapshiOrders];
  allOrders.sort((a, b) => {
    const da = a.createdAt ? a.createdAt.toDate() : new Date(0);
    const db = b.createdAt ? b.createdAt.toDate() : new Date(0);
    return db - da;
  });

  const totalOrders = allOrders.length;
  const totalRevenue = allOrders.reduce((sum, o) => sum + o.price, 0);
  const totalCost = allOrders.reduce((sum, o) => sum + o.cost, 0);
  const totalProfit = totalRevenue - totalCost;
  const avgMargin = totalRevenue ? Math.round((totalProfit / totalRevenue) * 100) : 0;

  const result = {
    orders: allOrders.slice(0, 200),
    stats: { total: totalOrders, revenue: totalRevenue, cost: totalCost, profit: totalProfit, avgMargin },
  };

  cache.orders = result;
  cache.lastFetch.orders = Date.now();
  return result;
}

// ── ROUTES ──────────────────────────────────────────────────────
router.use(checkAdminPassword);

// Ping
router.get('/ping', (req, res) => {
  res.json({ success: true, message: 'Admin API accessible' });
});

// 1. Statistiques
router.get('/stats', async (req, res) => {
  try {
    const stats = await getStatsData();
    res.json({ success: true, data: stats });
  } catch (error) {
    console.error('Erreur stats:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// 2. Services
router.get('/services', async (req, res) => {
  try {
    const services = await getServicesData();
    res.json({ success: true, data: services });
  } catch (error) {
    console.error('Erreur services:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// 3. Utilisateurs
router.get('/users', async (req, res) => {
  try {
    if (isCacheValid('users')) {
      return res.json({ success: true, cached: true, data: cache.users });
    }

    const snapshot = await db.collection('users')
      .select('displayName', 'username', 'email', 'phone', 'balance', 'totalOrders', 'createdAt')
      .orderBy('createdAt', 'desc')
      .limit(500)
      .get();

    const users = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    const topByBalance = [...users].sort((a, b) => (b.balance || 0) - (a.balance || 0)).slice(0, 10);
    const topByOrders = [...users].sort((a, b) => (b.totalOrders || 0) - (a.totalOrders || 0)).slice(0, 10);

    const result = { users, topByBalance, topByOrders, total: users.length };
    cache.users = result;
    cache.lastFetch.users = Date.now();

    res.json({ success: true, data: result });
  } catch (error) {
    console.error('Erreur users:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// 4. Commandes
router.get('/orders', async (req, res) => {
  try {
    const orders = await getOrdersData();
    res.json({ success: true, data: orders });
  } catch (error) {
    console.error('Erreur orders:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ── EXPORTS ─────────────────────────────────────────────────────

// VCF
router.get('/export/contacts', async (req, res) => {
  try {
    const snapshot = await db.collection('users').select('displayName', 'username', 'phone').get();
    let vcf = '';
    snapshot.forEach(doc => {
      const data = doc.data();
      const phone = data.phone || '';
      if (phone) {
        const name = data.displayName || data.username || 'Client SBH';
        vcf += `BEGIN:VCARD\nVERSION:3.0\nFN:SBH - ${name}\nTEL;TYPE=CELL:${phone}\nEND:VCARD\n`;
      }
    });
    res.setHeader('Content-Type', 'text/vcard;charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="SBH_Contacts.vcf"');
    res.send(vcf);
  } catch (error) {
    console.error('Erreur export VCF:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// PDF Services
router.get('/export/services-pdf', async (req, res) => {
  try {
    const { jsPDF } = require('jspdf');
    require('jspdf-autotable');

    // On utilise notre nouvelle fonction interne (fini les crashs localhost)
    const servicesData = await getServicesData();

    const doc = new jsPDF();
    doc.setFontSize(18);
    doc.setTextColor(8, 14, 26);
    doc.text("Rapport des Services - Social Boost Horizon", 14, 20);
    doc.setFontSize(10);
    doc.setTextColor(100);
    doc.text(`Généré le ${new Date().toLocaleString('fr-FR')}`, 14, 28);

    const tableColumn = ["ID", "Partenaire", "Nom", "Coût", "Prix final", "Bénéfice", "Marge"];
    const tableRows = servicesData.services.map(s => [
      s.id, s.provider, s.name.substring(0, 40), `${s.providerCost} FCFA`,
      `${s.finalPrice} FCFA`, `+${s.profit} FCFA`, `${s.profitMargin}%`
    ]);

    doc.autoTable({
      head: [tableColumn], body: tableRows, startY: 35, theme: 'striped',
      headStyles: { fillColor: [8, 14, 26], textColor: [212, 175, 55] }, styles: { fontSize: 8 },
    });

    doc.text(`Total services: ${servicesData.stats.total}`, 14, doc.lastAutoTable.finalY + 10);
    doc.text(`Prix min: ${servicesData.stats.minPrice} FCFA, max: ${servicesData.stats.maxPrice} FCFA, moy: ${servicesData.stats.avgPrice} FCFA`, 14, doc.lastAutoTable.finalY + 18);

    const buffer = doc.output('arraybuffer');
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename="Services_SBH.pdf"');
    res.send(Buffer.from(buffer));
  } catch (error) {
    console.error('Erreur export PDF services:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// PDF Profits
router.get('/export/profits-pdf', async (req, res) => {
  try {
    const { jsPDF } = require('jspdf');
    require('jspdf-autotable');

    // Utilisation de la fonction interne
    const statsData = await getStatsData();

    const doc = new jsPDF();
    doc.setFontSize(18);
    doc.setTextColor(8, 14, 26);
    doc.text("Rapport Financier - Social Boost Horizon", 14, 20);
    doc.setFontSize(10);
    doc.setTextColor(100);
    doc.text(`Généré le ${new Date().toLocaleString('fr-FR')}`, 14, 28);

    doc.setFontSize(14);
    doc.text("Statistiques globales", 14, 40);
    doc.autoTable({
      body: [
        ['Total utilisateurs', statsData.totalUsers],
        ['Total commandes', statsData.totalOrders],
      ],
      startY: 45, theme: 'plain', styles: { fontSize: 10 },
    });

    doc.text("Bénéfices par période", 14, doc.lastAutoTable.finalY + 12);
    doc.autoTable({
      head: [['Période', 'Revenu', 'Bénéfice']],
      body: [
        ['Aujourd\'hui', `${statsData.today.revenue} FCFA`, `${statsData.today.profit} FCFA`],
        ['7 jours', `${statsData.week.revenue} FCFA`, `${statsData.week.profit} FCFA`],
        ['30 jours', `${statsData.month.revenue} FCFA`, `${statsData.month.profit} FCFA`],
        ['365 jours', `${statsData.year.revenue} FCFA`, `${statsData.year.profit} FCFA`],
      ],
      startY: doc.lastAutoTable.finalY + 16, theme: 'striped',
      headStyles: { fillColor: [8, 14, 26], textColor: [212, 175, 55] }, styles: { fontSize: 10 },
    });

    const buffer = doc.output('arraybuffer');
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename="Profits_SBH.pdf"');
    res.send(Buffer.from(buffer));
  } catch (error) {
    console.error('Erreur export PDF profits:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// PDF Commandes
router.get('/export/orders-pdf', async (req, res) => {
  try {
    const { jsPDF } = require('jspdf');
    require('jspdf-autotable');

    // Utilisation de la fonction interne
    const ordersData = await getOrdersData();

    const doc = new jsPDF();
    doc.setFontSize(18);
    doc.setTextColor(8, 14, 26);
    doc.text("Rapport des Commandes - Social Boost Horizon", 14, 20);
    doc.setFontSize(10);
    doc.setTextColor(100);
    doc.text(`Généré le ${new Date().toLocaleString('fr-FR')}`, 14, 28);

    const body = ordersData.orders.slice(0, 50).map(o => [
      o.source, o.orderId || o.id, o.serviceName.substring(0, 20),
      `${o.price} FCFA`, `+${o.profit} FCFA`, `${o.profitMargin}%`,
    ]);

    doc.autoTable({
      head: [['Source', 'ID', 'Service', 'Montant', 'Bénéfice', 'Marge']],
      body, startY: 35, theme: 'striped',
      headStyles: { fillColor: [8, 14, 26], textColor: [212, 175, 55] }, styles: { fontSize: 8 },
    });

    doc.text(`Total commandes: ${ordersData.stats.total} | Revenu: ${ordersData.stats.revenue} FCFA | Bénéfice: ${ordersData.stats.profit} FCFA`, 14, doc.lastAutoTable.finalY + 10);

    const buffer = doc.output('arraybuffer');
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename="Commandes_SBH.pdf"');
    res.send(Buffer.from(buffer));
  } catch (error) {
    console.error('Erreur export PDF commandes:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

module.exports = router;