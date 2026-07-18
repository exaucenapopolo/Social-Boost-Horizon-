// admin.js – Routeur administrateur unique pour Social Boost Horizon
// Sécurité, cache, statistiques, services, utilisateurs, commandes, profits, exports

const express = require('express');
const admin = require('firebase-admin');
const crypto = require('crypto');

const router = express.Router();

// ── VÉRIFICATION DE L'ENVIRONNEMENT ─────────────────────────────
if (!admin.apps.length) {
  try {
    const privateKey = process.env.FIREBASE_PRIVATE_KEY
      ? process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n')
      : undefined;

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

// ── MOT DE PASSE ADMIN (unique) ──────────────────────────────────
const ADMIN_PASSWORD = '209644209644';

// ── MIDDLEWARE DE SÉCURITÉ ──────────────────────────────────────
function checkAdminPassword(req, res, next) {
  const pass = req.headers['x-admin-password'];
  if (!pass || pass !== ADMIN_PASSWORD) {
    return res.status(403).json({ success: false, error: 'Accès refusé. Clé invalide.' });
  }
  next();
}

// ── CACHE MÉMOIRE AVEC TTL ──────────────────────────────────────
// Réduit drastiquement les lectures Firestore
const CACHE_TTL = 15 * 60 * 1000; // 15 minutes
let cache = {
  stats: null,
  services: null,
  users: null,
  orders: null,
  profits: null,
  lastFetch: {
    stats: 0,
    services: 0,
    users: 0,
    orders: 0,
    profits: 0,
  },
};

function isCacheValid(key) {
  return cache[key] && (Date.now() - cache.lastFetch[key] < CACHE_TTL);
}

// ── CONFIGURATION FINANCIÈRE (reprise de index.js) ──────────────
const MTP_USD_TO_XAF = 620;
const MTP_MULTIPLIER = 3;
const EXO_USD_TO_XAF = 650;
const EXO_MULTIPLIER = 2.5;

// ── FONCTIONS D'APPEL AUX PARTENAIRES (MTP, EXO) ────────────────
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

// ── ROUTES ADMIN ──────────────────────────────────────────────────

// Toutes les routes sont protégées par le middleware
router.use(checkAdminPassword);

// ================================================================
// 1. STATISTIQUES GLOBALES & PAR PÉRIODE
// ================================================================
router.get('/stats', async (req, res) => {
  try {
    if (isCacheValid('stats')) {
      return res.json({ success: true, cached: true, data: cache.stats });
    }

    // Périodes : aujourd'hui, semaine, mois, année
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const weekAgo = new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000);
    const monthAgo = new Date(today.getTime() - 30 * 24 * 60 * 60 * 1000);
    const yearAgo = new Date(today.getTime() - 365 * 24 * 60 * 60 * 1000);

    // Compteurs rapides (count() = 1 lecture par collection)
    const [usersCount, mtpOrdersCount, exoOrdersCount] = await Promise.all([
      db.collection('users').count().get(),
      db.collection('autoOrders').count().get(),
      db.collection('commandes').count().get(),
    ]);
    const totalOrders = mtpOrdersCount.data().count + exoOrdersCount.data().count;

    // Fonction pour calculer les revenus et coûts sur une période donnée
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
        cost += price / MTP_MULTIPLIER; // coût fournisseur estimé
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

    res.json({ success: true, data: stats });
  } catch (error) {
    console.error('Erreur stats:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ================================================================
// 2. SERVICES AVEC ANALYSE DES PRIX, MARGE, BÉNÉFICE
// ================================================================
router.get('/services', async (req, res) => {
  try {
    if (isCacheValid('services')) {
      return res.json({ success: true, cached: true, data: cache.services });
    }

    let allServices = [];

    // Récupération MTP
    if (process.env.MORETHANPANEL_API_KEY) {
      const mtpData = await callMTP({ action: 'services' });
      if (Array.isArray(mtpData)) {
        mtpData.forEach(s => {
          const rate = parseFloat(s.rate) || 0;
          const providerCost = Math.round(rate * MTP_USD_TO_XAF);
          const finalPrice = Math.round(providerCost * MTP_MULTIPLIER);
          const profit = finalPrice - providerCost;
          allServices.push({
            id: s.service,
            provider: 'MTP',
            name: s.name,
            category: s.category || '',
            providerCost,
            finalPrice,
            profit,
            profitMargin: Math.round((profit / finalPrice) * 100) || 0,
            min: parseInt(s.min) || 0,
            max: parseInt(s.max) || 0,
          });
        });
      }
    }

    // Récupération EXO
    if (process.env.EXO_API_KEY) {
      const exoData = await callExo({ action: 'services' });
      if (Array.isArray(exoData)) {
        exoData.forEach(s => {
          const rate = parseFloat(s.rate) || 0;
          const providerCost = Math.round(rate * EXO_USD_TO_XAF);
          const finalPrice = Math.round(providerCost * EXO_MULTIPLIER);
          const profit = finalPrice - providerCost;
          allServices.push({
            id: s.service,
            provider: 'EXO',
            name: s.name,
            category: s.category || '',
            providerCost,
            finalPrice,
            profit,
            profitMargin: Math.round((profit / finalPrice) * 100) || 0,
            min: parseInt(s.min) || 0,
            max: parseInt(s.max) || 0,
          });
        });
      }
    }

    // Statistiques sur les prix
    const prices = allServices.map(s => s.finalPrice);
    const minPrice = prices.length ? Math.min(...prices) : 0;
    const maxPrice = prices.length ? Math.max(...prices) : 0;
    const avgPrice = prices.length ? Math.round(prices.reduce((a, b) => a + b, 0) / prices.length) : 0;

    // Regroupement par partenaire
    const byProvider = {};
    allServices.forEach(s => {
      if (!byProvider[s.provider]) byProvider[s.provider] = [];
      byProvider[s.provider].push(s);
    });

    const result = {
      services: allServices,
      stats: {
        total: allServices.length,
        minPrice,
        maxPrice,
        avgPrice,
        byProvider: Object.keys(byProvider).map(p => ({
          provider: p,
          count: byProvider[p].length,
          min: Math.min(...byProvider[p].map(s => s.finalPrice)),
          max: Math.max(...byProvider[p].map(s => s.finalPrice)),
          avg: Math.round(byProvider[p].reduce((sum, s) => sum + s.finalPrice, 0) / byProvider[p].length),
        })),
      },
    };

    cache.services = result;
    cache.lastFetch.services = Date.now();

    res.json({ success: true, data: result });
  } catch (error) {
    console.error('Erreur services:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ================================================================
// 3. UTILISATEURS (liste, top clients, etc.)
// ================================================================
router.get('/users', async (req, res) => {
  try {
    if (isCacheValid('users')) {
      return res.json({ success: true, cached: true, data: cache.users });
    }

    // On récupère tous les utilisateurs (limité à 500 pour éviter surcharge)
    const snapshot = await db.collection('users')
      .select('displayName', 'username', 'email', 'phone', 'balance', 'totalOrders', 'createdAt')
      .orderBy('createdAt', 'desc')
      .limit(500)
      .get();

    const users = snapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data(),
    }));

    // Top clients par solde ou commandes
    const topByBalance = [...users].sort((a, b) => (b.balance || 0) - (a.balance || 0)).slice(0, 10);
    const topByOrders = [...users].sort((a, b) => (b.totalOrders || 0) - (a.totalOrders || 0)).slice(0, 10);

    const result = {
      users,
      topByBalance,
      topByOrders,
      total: users.length,
    };

    cache.users = result;
    cache.lastFetch.users = Date.now();

    res.json({ success: true, data: result });
  } catch (error) {
    console.error('Erreur users:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ================================================================
// 4. COMMANDES (MTP, EXO, Fapshi) avec bénéfice par commande
// ================================================================
router.get('/orders', async (req, res) => {
  try {
    if (isCacheValid('orders')) {
      return res.json({ success: true, cached: true, data: cache.orders });
    }

    // Commandes MTP
    const mtpSnap = await db.collection('autoOrders')
      .orderBy('createdAt', 'desc')
      .limit(200)
      .get();

    const mtpOrders = mtpSnap.docs.map(doc => {
      const data = doc.data();
      const price = data.priceXAF || 0;
      const cost = price / MTP_MULTIPLIER;
      return {
        id: doc.id,
        source: 'MTP',
        orderId: data.orderId,
        userId: data.userId,
        serviceName: data.serviceName || 'Service MTP',
        quantity: data.quantity || 0,
        price,
        cost,
        profit: price - cost,
        profitMargin: price ? Math.round(((price - cost) / price) * 100) : 0,
        status: data.status || 'Inconnu',
        createdAt: data.createdAt,
      };
    });

    // Commandes EXO
    const exoSnap = await db.collection('commandes')
      .orderBy('createdAt', 'desc')
      .limit(200)
      .get();

    const exoOrders = exoSnap.docs.map(doc => {
      const data = doc.data();
      const price = data.totalCost || data.finalCost || data.cost || 0;
      const cost = price / EXO_MULTIPLIER;
      return {
        id: doc.id,
        source: 'EXO',
        orderId: data.orderId || data.id,
        userId: data.userId,
        serviceName: data.serviceName || 'Service EXO',
        quantity: data.quantity || 0,
        price,
        cost,
        profit: price - cost,
        profitMargin: price ? Math.round(((price - cost) / price) * 100) : 0,
        status: data.status || 'Inconnu',
        createdAt: data.createdAt,
      };
    });

    // Commandes Fapshi (transactions) – on peut les récupérer aussi
    const fapshiSnap = await db.collection('fapshiTransactions')
      .where('status', '==', 'CONFIRMED')
      .orderBy('dateConfirmed', 'desc')
      .limit(100)
      .get();

    const fapshiOrders = fapshiSnap.docs.map(doc => {
      const data = doc.data();
      const amount = data.amount || 0;
      // On considère que le coût est un pourcentage (ex: 80% du montant)
      const cost = Math.round(amount * 0.8);
      return {
        id: doc.id,
        source: 'Fapshi',
        orderId: doc.id,
        userId: data.userId,
        serviceName: 'Recharge Fapshi',
        quantity: 1,
        price: amount,
        cost,
        profit: amount - cost,
        profitMargin: amount ? Math.round(((amount - cost) / amount) * 100) : 0,
        status: 'Confirmé',
        createdAt: data.dateConfirmed || data.dateInitiated,
      };
    });

    const allOrders = [...mtpOrders, ...exoOrders, ...fapshiOrders];
    // Trier par date décroissante
    allOrders.sort((a, b) => {
      const da = a.createdAt ? a.createdAt.toDate() : new Date(0);
      const db = b.createdAt ? b.createdAt.toDate() : new Date(0);
      return db - da;
    });

    // Statistiques sur les commandes
    const totalOrders = allOrders.length;
    const totalRevenue = allOrders.reduce((sum, o) => sum + o.price, 0);
    const totalCost = allOrders.reduce((sum, o) => sum + o.cost, 0);
    const totalProfit = totalRevenue - totalCost;
    const avgMargin = totalRevenue ? Math.round((totalProfit / totalRevenue) * 100) : 0;

    const result = {
      orders: allOrders.slice(0, 200), // on limite l'affichage
      stats: {
        total: totalOrders,
        revenue: totalRevenue,
        cost: totalCost,
        profit: totalProfit,
        avgMargin,
      },
    };

    cache.orders = result;
    cache.lastFetch.orders = Date.now();

    res.json({ success: true, data: result });
  } catch (error) {
    console.error('Erreur orders:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ================================================================
// 5. EXPORT CONTACTS VCF (TOUS LES UTILISATEURS)
// ================================================================
router.get('/export/contacts', async (req, res) => {
  try {
    const snapshot = await db.collection('users')
      .select('displayName', 'username', 'phone')
      .get();

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

// ================================================================
// 6. EXPORT SERVICES (PDF)
// ================================================================
router.get('/export/services-pdf', async (req, res) => {
  try {
    // On réutilise le cache ou on appelle l'API services
    let servicesData;
    if (isCacheValid('services')) {
      servicesData = cache.services;
    } else {
      const resp = await fetch(`http://localhost:${process.env.PORT || 3000}/api/admin/services`, {
        headers: { 'x-admin-password': ADMIN_PASSWORD },
      });
      servicesData = (await resp.json()).data;
    }

    // Génération du PDF avec jsPDF (on va utiliser un package ou on renvoie un HTML stylisé)
    // Ici, on va générer un PDF côté serveur avec pdf-lib ou autre, mais pour simplifier,
    // on peut renvoyer un rapport HTML que le front convertira en PDF.
    // Comme l'utilisateur veut un PDF, je propose de retourner un PDF généré avec pdfmake ou jsPDF côté serveur.
    // Mais pour ne pas alourdir, on va utiliser une approche : envoyer les données et le front génère le PDF.
    // Toutefois, l'utilisateur a demandé un export PDF depuis le backend.
    // Je vais utiliser 'pdf-lib' ou 'pdfmake', mais je vais plutôt créer une route qui renvoie un PDF pré-généré.
    // Pour rester simple, je vais générer un PDF avec pdfmake (installation nécessaire).
    // Mais je ne veux pas ajouter de dépendance lourde. Je vais plutôt utiliser une approche : le front génère le PDF à partir des données JSON.
    // Je vais donc renvoyer les données et le front fera le PDF (comme dans mc.html).
    // Cependant, l'utilisateur veut un export côté serveur. Je vais utiliser 'pdfmake' installé en dépendance.
    // Je vais supposer que pdfmake est installé.
    const PdfPrinter = require('pdfmake');
    const fonts = {
      Roboto: { normal: 'Helvetica', bold: 'Helvetica-Bold', italics: 'Helvetica-Oblique' }
    };
    const printer = new PdfPrinter(fonts);

    const docDefinition = {
      content: [
        { text: 'Rapport des Services - Social Boost Horizon', style: 'header' },
        { text: `Généré le ${new Date().toLocaleString('fr-FR')}`, style: 'subheader' },
        {
          table: {
            headerRows: 1,
            widths: ['*', '*', '*', '*', '*', '*'],
            body: [
              ['ID', 'Partenaire', 'Nom', 'Coût', 'Prix final', 'Bénéfice'],
              ...servicesData.services.map(s => [
                s.id,
                s.provider,
                s.name.substring(0, 30),
                `${s.providerCost} FCFA`,
                `${s.finalPrice} FCFA`,
                `${s.profit} FCFA (${s.profitMargin}%)`,
              ]),
            ],
          },
        },
        { text: `Total services: ${servicesData.stats.total}`, style: 'footer' },
        { text: `Prix min: ${servicesData.stats.minPrice} FCFA, max: ${servicesData.stats.maxPrice} FCFA, moyenne: ${servicesData.stats.avgPrice} FCFA`, style: 'footer' },
      ],
      styles: {
        header: { fontSize: 18, bold: true, alignment: 'center', margin: [0, 0, 0, 10] },
        subheader: { fontSize: 12, alignment: 'center', margin: [0, 0, 0, 20] },
        footer: { fontSize: 10, alignment: 'center', margin: [0, 20, 0, 0] },
      },
    };

    const pdfDoc = printer.createPdfKitDocument(docDefinition);
    let chunks = [];
    pdfDoc.on('data', chunk => chunks.push(chunk));
    pdfDoc.end();

    await new Promise((resolve) => pdfDoc.on('end', resolve));
    const buffer = Buffer.concat(chunks);

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename="Services_SBH.pdf"');
    res.send(buffer);
  } catch (error) {
    console.error('Erreur export PDF services:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ================================================================
// 7. EXPORT PROFITS (PDF)
// ================================================================
router.get('/export/profits-pdf', async (req, res) => {
  try {
    // Récupérer les stats
    let statsData;
    if (isCacheValid('stats')) {
      statsData = cache.stats;
    } else {
      const resp = await fetch(`http://localhost:${process.env.PORT || 3000}/api/admin/stats`, {
        headers: { 'x-admin-password': ADMIN_PASSWORD },
      });
      statsData = (await resp.json()).data;
    }

    const PdfPrinter = require('pdfmake');
    const fonts = {
      Roboto: { normal: 'Helvetica', bold: 'Helvetica-Bold', italics: 'Helvetica-Oblique' }
    };
    const printer = new PdfPrinter(fonts);

    const docDefinition = {
      content: [
        { text: 'Rapport Financier - Social Boost Horizon', style: 'header' },
        { text: `Généré le ${new Date().toLocaleString('fr-FR')}`, style: 'subheader' },
        { text: 'Statistiques globales', style: 'sectionHeader' },
        {
          table: {
            widths: ['*', '*'],
            body: [
              ['Total utilisateurs', statsData.totalUsers],
              ['Total commandes', statsData.totalOrders],
            ],
          },
        },
        { text: 'Bénéfices par période', style: 'sectionHeader' },
        {
          table: {
            widths: ['*', '*', '*'],
            body: [
              ['Période', 'Revenu', 'Bénéfice'],
              ['Aujourd\'hui', `${statsData.today.revenue} FCFA`, `${statsData.today.profit} FCFA`],
              ['7 jours', `${statsData.week.revenue} FCFA`, `${statsData.week.profit} FCFA`],
              ['30 jours', `${statsData.month.revenue} FCFA`, `${statsData.month.profit} FCFA`],
              ['365 jours', `${statsData.year.revenue} FCFA`, `${statsData.year.profit} FCFA`],
            ],
          },
        },
        { text: 'Détail des bénéfices', style: 'sectionHeader' },
        {
          table: {
            widths: ['*', '*', '*', '*'],
            body: [
              ['Période', 'Revenu total', 'Coût total', 'Bénéfice'],
              ['Aujourd\'hui', `${statsData.today.revenue} FCFA`, `${statsData.today.cost} FCFA`, `${statsData.today.profit} FCFA`],
              ['7 jours', `${statsData.week.revenue} FCFA`, `${statsData.week.cost} FCFA`, `${statsData.week.profit} FCFA`],
              ['30 jours', `${statsData.month.revenue} FCFA`, `${statsData.month.cost} FCFA`, `${statsData.month.profit} FCFA`],
              ['365 jours', `${statsData.year.revenue} FCFA`, `${statsData.year.cost} FCFA`, `${statsData.year.profit} FCFA`],
            ],
          },
        },
      ],
      styles: {
        header: { fontSize: 18, bold: true, alignment: 'center', margin: [0, 0, 0, 10] },
        subheader: { fontSize: 12, alignment: 'center', margin: [0, 0, 0, 20] },
        sectionHeader: { fontSize: 14, bold: true, margin: [0, 15, 0, 5] },
      },
    };

    const pdfDoc = printer.createPdfKitDocument(docDefinition);
    let chunks = [];
    pdfDoc.on('data', chunk => chunks.push(chunk));
    pdfDoc.end();

    await new Promise((resolve) => pdfDoc.on('end', resolve));
    const buffer = Buffer.concat(chunks);

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename="Profits_SBH.pdf"');
    res.send(buffer);
  } catch (error) {
    console.error('Erreur export PDF profits:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ================================================================
// 8. EXPORT COMMANDES (PDF)
// ================================================================
router.get('/export/orders-pdf', async (req, res) => {
  try {
    let ordersData;
    if (isCacheValid('orders')) {
      ordersData = cache.orders;
    } else {
      const resp = await fetch(`http://localhost:${process.env.PORT || 3000}/api/admin/orders`, {
        headers: { 'x-admin-password': ADMIN_PASSWORD },
      });
      ordersData = (await resp.json()).data;
    }

    const PdfPrinter = require('pdfmake');
    const fonts = {
      Roboto: { normal: 'Helvetica', bold: 'Helvetica-Bold', italics: 'Helvetica-Oblique' }
    };
    const printer = new PdfPrinter(fonts);

    const body = ordersData.orders.slice(0, 50).map(o => [
      o.source,
      o.orderId,
      o.serviceName.substring(0, 20),
      `${o.price} FCFA`,
      `${o.profit} FCFA`,
      o.profitMargin + '%',
    ]);

    const docDefinition = {
      content: [
        { text: 'Rapport des Commandes - Social Boost Horizon', style: 'header' },
        { text: `Généré le ${new Date().toLocaleString('fr-FR')}`, style: 'subheader' },
        {
          table: {
            headerRows: 1,
            widths: ['*', '*', '*', '*', '*', '*'],
            body: [
              ['Source', 'ID', 'Service', 'Montant', 'Bénéfice', 'Marge'],
              ...body,
            ],
          },
        },
        { text: `Total commandes: ${ordersData.stats.total} | Revenu: ${ordersData.stats.revenue} FCFA | Bénéfice: ${ordersData.stats.profit} FCFA`, style: 'footer' },
      ],
      styles: {
        header: { fontSize: 18, bold: true, alignment: 'center', margin: [0, 0, 0, 10] },
        subheader: { fontSize: 12, alignment: 'center', margin: [0, 0, 0, 20] },
        footer: { fontSize: 10, alignment: 'center', margin: [0, 20, 0, 0] },
      },
    };

    const pdfDoc = printer.createPdfKitDocument(docDefinition);
    let chunks = [];
    pdfDoc.on('data', chunk => chunks.push(chunk));
    pdfDoc.end();

    await new Promise((resolve) => pdfDoc.on('end', resolve));
    const buffer = Buffer.concat(chunks);

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename="Commandes_SBH.pdf"');
    res.send(buffer);
  } catch (error) {
    console.error('Erreur export PDF commandes:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

module.exports = router;