// api/order-exo.js

import admin from 'firebase-admin';

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
    
    return 'Autre'; 
}

export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ success: false, error: 'Méthode non autorisée' });
    }

    try {
        const authHeader = req.headers.authorization;
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return res.status(401).json({ success: false, error: 'Vous devez être connecté.' });
        }
        const token = authHeader.split('Bearer ')[1];
        const decodedToken = await admin.auth().verifyIdToken(token);
        const uid = decodedToken.uid;

        const { exoServiceId, link, quantity, comments, contactType, contact } = req.body;

        const userRef = db.collection('users').doc(uid);
        const userDoc = await userRef.get();

        if (!userDoc.exists) {
            return res.status(404).json({ success: false, error: 'Compte utilisateur introuvable.' });
        }

        const userData = userDoc.data();
        let currentBalance = userData.balance || 0;

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

        const EXCHANGE_RATE_USD_TO_XAF = 620;
        const PROFIT_MULTIPLIER = 1.5;
        const priceXAFPer1000 = parseFloat(service.rate) * EXCHANGE_RATE_USD_TO_XAF * PROFIT_MULTIPLIER;
        
        let finalQuantity = service.type === 'Custom Comments' ? comments.length : quantity;
        let cost = (priceXAFPer1000 / 1000) * finalQuantity;
        let unitPrice = cost / finalQuantity; // NOUVEAU : Sauvegarde du prix unitaire

        if (currentBalance < cost) {
            return res.status(400).json({ success: false, error: 'Solde insuffisant pour cette commande.' });
        }

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

        let finalFormattedOrderId; 
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

            let nextOrderId = 1; 
            if (counterDoc.exists && counterDoc.data().lastId) {
                nextOrderId = counterDoc.data().lastId + 1;
            }

            finalFormattedOrderId = `SBH-${nextOrderId}`;
            newBalance = balanceInTransaction - cost;

            const detectedPlatform = detectPlatform(service.name, link);

            transaction.set(counterRef, { lastId: nextOrderId }, { merge: true });
            transaction.update(currentUserRef, { balance: newBalance });

            const newOrderRef = db.collection('commandes').doc(); 
            transaction.set(newOrderRef, {
                orderId: finalFormattedOrderId, 
                platform: detectedPlatform, 
                userId: uid,
                exoOrderId: orderResult.order, 
                serviceId: exoServiceId,
                serviceName: service.name,
                link: link,
                quantity: finalQuantity,
                cost: cost,
                unitPrice: unitPrice, // NOUVEAU : Très important pour les remboursements partiels
                status: 'En attente',
                isRefunded: false, // NOUVEAU : Sécurité anti-double remboursement
                date: admin.firestore.FieldValue.serverTimestamp(),
                contactInfo: contact || 'Aucun contact'
            });
        });

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