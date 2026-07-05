// api/order-exo.js

import admin from 'firebase-admin';

// 1. Initialisation sécurisée de Firebase Admin
if (!admin.apps.length) {
    admin.initializeApp({
        credential: admin.credential.cert({
            projectId: process.env.FIREBASE_PROJECT_ID,
            clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
            privateKey: process.env.FIREBASE_PRIVATE_KEY ? process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n') : '',
        })
    });
}

const db = admin.firestore();

// Nouvelle fonction : Détecter la plateforme en fonction du nom du service et du lien
// Cela va nous permettre de stocker une information claire dans la base de données
function detectPlatform(serviceName, link) {
    const nameLower = (serviceName || '').toLowerCase();
    const linkLower = (link || '').toLowerCase();
    
    if (nameLower.includes('facebook') || linkLower.includes('facebook.com') || linkLower.includes('fb.')) return 'Facebook';
    if (nameLower.includes('instagram') || linkLower.includes('instagram.com')) return 'Instagram';
    if (nameLower.includes('tiktok') || linkLower.includes('tiktok.com')) return 'TikTok';
    if (nameLower.includes('twitter') || nameLower.includes(' x ') || linkLower.includes('twitter.com') || linkLower.includes('x.com')) return 'X (Twitter)';
    if (nameLower.includes('youtube') || linkLower.includes('youtube.com') || linkLower.includes('youtu.be')) return 'YouTube';
    if (nameLower.includes('telegram') || linkLower.includes('t.me')) return 'Telegram';
    if (nameLower.includes('spotify') || linkLower.includes('spotify.com')) return 'Spotify';
    if (nameLower.includes('linkedin') || linkLower.includes('linkedin.com')) return 'LinkedIn';
    if (nameLower.includes('twitch') || linkLower.includes('twitch.tv')) return 'Twitch';
    
    // Si on ne trouve rien, on met 'Autre'
    return 'Autre'; 
}

export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ success: false, error: 'Méthode non autorisée' });
    }

    try {
        // 2. Vérification de la sécurité
        const authHeader = req.headers.authorization;
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return res.status(401).json({ success: false, error: 'Vous devez être connecté.' });
        }
        const token = authHeader.split('Bearer ')[1];
        const decodedToken = await admin.auth().verifyIdToken(token);
        const uid = decodedToken.uid;

        // 3. Récupération des données du formulaire
        const { exoServiceId, link, quantity, comments, contactType, contact } = req.body;

        // 4. Vérification préliminaire du solde utilisateur
        const userRef = db.collection('users').doc(uid);
        const userDoc = await userRef.get();

        if (!userDoc.exists) {
            return res.status(404).json({ success: false, error: 'Compte utilisateur introuvable.' });
        }

        const userData = userDoc.data();
        let currentBalance = userData.balance || 0;

        // 5. Récupération du prix depuis Exo pour le calcul
        const url = 'https://exosupplier.com/api/v2';
        const fetchServicesData = new URLSearchParams();
        fetchServicesData.append('key', process.env.EXO_API_KEY);
        fetchServicesData.append('action', 'services');

        const servicesRes = await fetch(url, { method: 'POST', body: fetchServicesData });
        const services = await servicesRes.json();
        const service = services.find(s => s.service == exoServiceId);

        if (!service) {
            return res.status(400).json({ success: false, error: 'Service invalide ou expiré.' });
        }

        // Calcul exact du coût
        const EXCHANGE_RATE_USD_TO_XAF = 620;
        const PROFIT_MULTIPLIER = 1.5;
        const priceXAFPer1000 = parseFloat(service.rate) * EXCHANGE_RATE_USD_TO_XAF * PROFIT_MULTIPLIER;
        
        let cost = 0;
        if (service.type === 'Custom Comments') {
            cost = (priceXAFPer1000 / 1000) * comments.length;
        } else {
            cost = (priceXAFPer1000 / 1000) * quantity;
        }

        // Refus immédiat si l'argent n'est pas suffisant
        if (currentBalance < cost) {
            return res.status(400).json({ success: false, error: 'Solde insuffisant pour cette commande.' });
        }

        // 6. Passage de la commande chez Exo Supplier
        const orderData = new URLSearchParams();
        orderData.append('key', process.env.EXO_API_KEY);
        orderData.append('action', 'add');
        orderData.append('service', exoServiceId);
        orderData.append('link', link);
        
        if (service.type === 'Custom Comments') {
            orderData.append('comments', comments.join('\n'));
        } else {
            orderData.append('quantity', quantity);
        }

        const orderRes = await fetch(url, { method: 'POST', body: orderData });
        const orderResult = await orderRes.json();

        if (orderResult.error) {
            return res.status(400).json({ 
                success: false, 
                error: 'Erreur fournisseur: ' + orderResult.error,
                adminContact: '+237600000000' 
            });
        }

        // 7. TRANSACTION FIREBASE : Mise à jour et formatage professionnel
        let finalFormattedOrderId; // Pour stocker le format "SBH-XXX"
        let newBalance;

        await db.runTransaction(async (transaction) => {
            const counterRef = db.collection('counters').doc('commandes');
            const currentUserRef = db.collection('users').doc(uid);
            
            const counterDoc = await transaction.get(counterRef);
            const currentUserDoc = await transaction.get(currentUserRef);

            const balanceInTransaction = currentUserDoc.data().balance || 0;
            if (balanceInTransaction < cost) {
                throw new Error("Solde devenu insuffisant pendant le traitement.");
            }

            // A. Gestion du compteur
            let nextOrderId = 1; 
            if (counterDoc.exists && counterDoc.data().lastId) {
                nextOrderId = counterDoc.data().lastId + 1;
            }

            // FORMATAGE DE L'ID DE COMMANDE ICI (Ex: SBH-15362)
            finalFormattedOrderId = `SBH-${nextOrderId}`;
            newBalance = balanceInTransaction - cost;

            // B. Détection de la plateforme (Facebook, Instagram, etc.)
            const detectedPlatform = detectPlatform(service.name, link);

            // C. Mise à jour du compteur et du solde
            transaction.set(counterRef, { lastId: nextOrderId }, { merge: true });
            transaction.update(currentUserRef, { balance: newBalance });

            // D. Enregistrement de la commande avec les nouvelles données
            const newOrderRef = db.collection('commandes').doc(); 
            transaction.set(newOrderRef, {
                orderId: finalFormattedOrderId, // On enregistre "SBH-XXX" au lieu d'un simple chiffre
                platform: detectedPlatform, // On enregistre le nom de la plateforme
                userId: uid,
                exoOrderId: orderResult.order, 
                serviceId: exoServiceId,
                serviceName: service.name,
                link: link,
                quantity: service.type === 'Custom Comments' ? comments.length : quantity,
                cost: cost,
                status: 'En attente',
                date: admin.firestore.FieldValue.serverTimestamp(),
                contactInfo: contact || 'Aucun contact'
            });
        });

        // 8. On renvoie la validation au frontend avec le bel ID
        return res.status(200).json({ 
            success: true, 
            orderId: finalFormattedOrderId, 
            newBalance: newBalance 
        });

    } catch (error) {
        console.error("Erreur de commande:", error);
        if (error.message === "Solde devenu insuffisant pendant le traitement.") {
             return res.status(400).json({ success: false, error: error.message });
        }
        return res.status(500).json({ success: false, error: 'Une erreur technique est survenue. Réessayez plus tard.' });
    }
    }
                                
