const admin = require('firebase-admin');

// ── INITIALISATION FIREBASE ─────────────────────────────────────
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
        console.log('✅ Firebase Admin initialisé dans admin.js');
    } catch (error) {
        console.error('❌ Erreur Firebase :', error.message);
    }
}

const db = admin.firestore();

// ── CONFIGURATION FINANCIÈRE ────────────────────────────────────
// Nous reprenons ta logique existante pour MTP et l'adaptons pour Exo
const MTP_USD_TO_XAF = 620;
const MTP_MULTIPLIER = 3; 
const EXO_USD_TO_XAF = 650; // Taux supposé pour Exo
const EXO_MULTIPLIER = 2.5; // Ta marge sur Exo

// ── SYSTÈME DE CACHE STRICT (Optimisation Firestore) ────────────
// Le cache garde les données en mémoire pendant 15 minutes. 
// Cela évite de relire la base de données à chaque rafraîchissement !
let adminCache = {
    stats: null,
    services: null,
    lastFetchStats: 0,
    lastFetchServices: 0
};
const CACHE_DURATION = 15 * 60 * 1000; // 15 minutes

export default async function handler(req, res) {
    // 1. SÉCURITÉ : Verrouillage strict
    const adminPass = req.headers['x-admin-password'];
    if (adminPass !== '209644209644') {
        return res.status(403).json({ success: false, error: 'Accès refusé. Clé de sécurité invalide.' });
    }

    const action = req.query.action;
    const now = Date.now();

    try {
        switch (action) {

            // ==========================================
            // ACTION 1 : STATISTIQUES GLOBALES & PROFITS
            // ==========================================
            case 'stats':
                if (adminCache.stats && (now - adminCache.lastFetchStats < CACHE_DURATION)) {
                    return res.status(200).json({ success: true, cached: true, data: adminCache.stats });
                }

                // OPTIMISATION : count() ne coûte qu'UNE SEULE lecture par collection !
                const [usersCount, ordersCount, exoOrdersCount] = await Promise.all([
                    db.collection('users').count().get(),
                    db.collection('autoOrders').count().get(), // Commandes MTP
                    db.collection('commandes').count().get()   // Commandes Exo/Manuelles
                ]);

                const totalOrders = ordersCount.data().count + exoOrdersCount.data().count;

                // Calcul des profits sur les 30 derniers jours (pour limiter les lectures)
                const thirtyDaysAgo = admin.firestore.Timestamp.fromDate(new Date(now - 30 * 24 * 60 * 60 * 1000));
                const recentOrdersSnap = await db.collection('autoOrders')
                    .where('createdAt', '>=', thirtyDaysAgo)
                    .where('status', 'in', ['Terminé', 'En cours', 'Completed'])
                    .get();

                let totalRevenue30d = 0;
                let totalCost30d = 0;

                recentOrdersSnap.forEach(doc => {
                    const order = doc.data();
                    const priceXAF = order.priceXAF || 0; // Prix de vente
                    // Le coût fournisseur est le prix de vente divisé par le multiplicateur
                    const costXAF = priceXAF / MTP_MULTIPLIER; 
                    
                    totalRevenue30d += priceXAF;
                    totalCost30d += costXAF;
                });

                const dashboardData = {
                    totalUsers: usersCount.data().count,
                    totalOrders: totalOrders,
                    revenue30d: Math.round(totalRevenue30d),
                    profit30d: Math.round(totalRevenue30d - totalCost30d),
                    lastUpdated: new Date().toISOString()
                };

                adminCache.stats = dashboardData;
                adminCache.lastFetchStats = now;

                return res.status(200).json({ success: true, data: dashboardData });

            // ==========================================
            // ACTION 2 : ANALYSE DES SERVICES & PRIX
            // ==========================================
            case 'services':
                if (adminCache.services && (now - adminCache.lastFetchServices < CACHE_DURATION)) {
                    return res.status(200).json({ success: true, cached: true, data: adminCache.services });
                }

                let allServices = [];

                // 1. Récupération MTP
                if (process.env.MORETHANPANEL_API_KEY) {
                    const mtpRes = await fetch('https://morethanpanel.com/api/v2', {
                        method: 'POST',
                        body: new URLSearchParams({ key: process.env.MORETHANPANEL_API_KEY, action: 'services' }),
                        headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
                    });
                    const mtpData = await mtpRes.json();
                    
                    if (Array.isArray(mtpData)) {
                        mtpData.forEach(s => {
                            const rateUsd = parseFloat(s.rate) || 0;
                            const providerCostXAF = Math.round(rateUsd * MTP_USD_TO_XAF);
                            const finalPriceXAF = Math.round(providerCostXAF * MTP_MULTIPLIER);
                            const profitXAF = finalPriceXAF - providerCostXAF;

                            allServices.push({
                                id: s.service, provider: 'MTP', name: s.name, category: s.category,
                                providerCost: providerCostXAF, finalPrice: finalPriceXAF, profit: profitXAF,
                                profitMargin: Math.round((profitXAF / finalPriceXAF) * 100) || 0
                            });
                        });
                    }
                }

                // 2. Récupération Exo Supplier
                if (process.env.EXO_API_KEY) {
                    const exoRes = await fetch('https://exosupplier.com/api/v2', {
                        method: 'POST',
                        body: new URLSearchParams({ key: process.env.EXO_API_KEY, action: 'services' }),
                        headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
                    });
                    const exoData = await exoRes.json();

                    if (Array.isArray(exoData)) {
                        exoData.forEach(s => {
                            const rateUsd = parseFloat(s.rate) || 0;
                            const providerCostXAF = Math.round(rateUsd * EXO_USD_TO_XAF);
                            const finalPriceXAF = Math.round(providerCostXAF * EXO_MULTIPLIER);
                            
                            allServices.push({
                                id: s.service, provider: 'EXO', name: s.name, category: s.category,
                                providerCost: providerCostXAF, finalPrice: finalPriceXAF, profit: finalPriceXAF - providerCostXAF,
                                profitMargin: Math.round(((finalPriceXAF - providerCostXAF) / finalPriceXAF) * 100) || 0
                            });
                        });
                    }
                }

                adminCache.services = allServices;
                adminCache.lastFetchServices = now;

                return res.status(200).json({ success: true, data: allServices });

            // ==========================================
            // ACTION 3 : EXPORT DES CONTACTS (FORMAT VCF)
            // ==========================================
            case 'export_vcf':
                // Requête optimisée : on ne sélectionne QUE le nom et le téléphone
                const usersSnap = await db.collection('users').select('username', 'displayName', 'phone').get();
                
                let vcfContent = "";
                
                usersSnap.forEach(doc => {
                    const user = doc.data();
                    if (user.phone) {
                        const name = user.displayName || user.username || "Client";
                        // Construction du format professionnel VCard 3.0
                        vcfContent += `BEGIN:VCARD\nVERSION:3.0\nFN:SBH - ${name}\nTEL;TYPE=CELL:${user.phone}\nEND:VCARD\n`;
                    }
                });

                // On renvoie le texte brut au client, qui le transformera en fichier téléchargeable
                return res.status(200).send(vcfContent);

            default:
                return res.status(400).json({ success: false, error: "Action inconnue." });
        }

    } catch (error) {
        console.error(`Erreur Admin [${action}]:`, error);
        return res.status(500).json({ success: false, error: error.message });
    }
}
