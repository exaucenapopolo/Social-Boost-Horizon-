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


// Variable globale pour le cache (Vercel garde parfois les variables en mémoire entre deux requêtes rapides)
let statsCache = {
    data: null,
    lastFetch: 0
};
const CACHE_DURATION = 15 * 60 * 1000; // 15 minutes en millisecondes

export default async function handler(req, res) {
    // 1. SÉCURITÉ : Vérification du mot de passe pour toutes les actions
    const adminPass = req.headers['x-admin-password'];
    if (adminPass !== '209644209644') {
        return res.status(403).json({ success: false, error: 'Accès administrateur refusé. Mot de passe incorrect.' });
    }

    // 2. ROUTAGE : Récupération de l'action demandée dans l'URL (ex: ?action=stats)
    const action = req.query.action;

    try {
        // Selon l'action demandée, on exécute un bloc de code différent
        switch (action) {

            // ==========================================
            // ACTION 1 : Statistiques globales du tableau de bord
            // ==========================================
            case 'stats':
                const now = Date.now();
                // Vérification du cache pour économiser tes lectures Firestore
                if (statsCache.data && (now - statsCache.lastFetch < CACHE_DURATION)) {
                    return res.status(200).json({ success: true, cached: true, data: statsCache.data });
                }

                // Requêtes optimisées avec count() (1 seule lecture par collection)
                const usersCountSnap = await db.collection('users').count().get();
                const ordersCountSnap = await db.collection('transactions').count().get();

                const dashboardData = {
                    totalUsers: usersCountSnap.data().count,
                    totalOrders: ordersCountSnap.data().count,
                    lastUpdated: new Date().toISOString()
                };

                // Mise à jour du cache
                statsCache.data = dashboardData;
                statsCache.lastFetch = now;

                return res.status(200).json({ success: true, cached: false, data: dashboardData });

            // ==========================================
            // ACTION 2 : Exportation des contacts
            // ==========================================
            case 'export':
                // Lecture des utilisateurs pour récupérer leurs numéros
                const usersSnap = await db.collection('users').select('username', 'phone').get();
                
                let contactsData = [];
                usersSnap.forEach(doc => {
                    const user = doc.data();
                    if (user.phone) {
                        contactsData.push({
                            name: `SBH - ${user.username || 'Client'}`,
                            phone: user.phone
                        });
                    }
                });

                return res.status(200).json({ success: true, contacts: contactsData });

            // ==========================================
            // ACTION 3 : Analyse des prix de l'API Exo
            // ==========================================
            case 'exo':
                const url = 'https://exosupplier.com/api/v2';
                const formData = new URLSearchParams();
                formData.append('key', process.env.EXO_API_KEY || 'TA_CLE_API_EXO_ICI'); // Assure-toi que la clé est dans tes variables d'environnement Vercel
                formData.append('action', 'services');

                const response = await fetch(url, {
                    method: 'POST',
                    body: formData,
                    headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
                });

                const services = await response.json();
                
                return res.status(200).json({ 
                    success: true, 
                    totalServices: services.length 
                    // Tu peux ajouter la logique la moins chère/plus chère ici si tu le souhaites
                });

            // ==========================================
            // SI AUCUNE ACTION CORRESPONDANTE N'EST TROUVÉE
            // ==========================================
            default:
                return res.status(400).json({ success: false, error: "Action non reconnue. Utilisez ?action=stats, export ou exo." });
        }

    } catch (error) {
        console.error(`Erreur Admin [${action}]:`, error);
        return res.status(500).json({ success: false, error: 'Erreur interne du serveur lors de l\'exécution de l\'action.' });
    }
}
