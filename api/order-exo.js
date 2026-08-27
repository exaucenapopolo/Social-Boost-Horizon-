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
        const { exoServiceId, link, quantity, comments, contactType, contact, isGuest, storeId, customerEmail } = req.body;
        let uid;
        let orderedFromStore = null;
        let storeMargin = 0; 

        const authHeader = req.headers.authorization;

        // ==========================================
        // 1. LOGIQUE PRINCIPALE
        // ==========================================
        if (authHeader && authHeader.startsWith('Bearer ')) {
            const token = authHeader.split('Bearer ')[1];
            try {
                const decodedToken = await admin.auth().verifyIdToken(token);
                uid = decodedToken.uid;
            } catch (authError) {
                return res.status(401).json({ success: false, error: 'Token invalide ou expiré.' });
            }
        } 
        // ==========================================
        // 2. LOGIQUE SECONDAIRE : Invité Boutique
        // ==========================================
        else if (isGuest && storeId) {
            const storeDoc = await db.collection('stores').doc(storeId).get();
            if (!storeDoc.exists) {
                return res.status(404).json({ success: false, error: 'Boutique introuvable.' });
            }
            const storeData = storeDoc.data();
            uid = storeData.ownerId; 
            orderedFromStore = storeId;    
            storeMargin = storeData.margin || 0; 
            
            if (!uid) {
                return res.status(400).json({ success: false, error: 'Propriétaire de boutique introuvable.' });
            }
        } 
        // ==========================================
        // 3. REJET
        // ==========================================
        else {
            return res.status(401).json({ success: false, error: 'Vous devez être connecté.' });
        }

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

        // --- CORRECTION : Vérification du type (Custom Comments) insensible à la casse ---
        const isCustomComments = String(service.type || '').toLowerCase().includes('custom comments');

        // --- Calculs des prix ---
        const EXCHANGE_RATE_USD_TO_XAF = 650;
        const PROFIT_MULTIPLIER = 1.51;
        const priceXAFPer1000 = parseFloat(service.rate) * EXCHANGE_RATE_USD_TO_XAF * PROFIT_MULTIPLIER;
        
        let finalQuantity = isCustomComments ? (comments ? comments.length : 0) : quantity;
        
        let cost = (priceXAFPer1000 / 1000) * finalQuantity;
        let unitPrice = cost / finalQuantity; 
        
        let exactCustomerPrice = cost;
        let profitForReseller = 0;

        if (isGuest && storeId && customerEmail) {
            exactCustomerPrice = Math.round(cost * (1 + storeMargin / 100));
            profitForReseller = exactCustomerPrice - Math.round(cost);
            
            const customerRef = db.collection('stores').doc(storeId).collection('customers').doc(customerEmail);
            const customerDoc = await customerRef.get();
            const customerBal = customerDoc.exists ? (customerDoc.data().balance || 0) : 0;
            
            if (customerBal < exactCustomerPrice) {
                 return res.status(400).json({ success: false, error: 'Solde client insuffisant sur la boutique.' });
            }
        }

        if (currentBalance < cost) {
            return res.status(400).json({ success: false, error: 'Solde revendeur insuffisant pour traiter cette commande.' });
        }

        // --- Envoi de la commande au fournisseur ---
        const orderData = new URLSearchParams();
        orderData.append('key', process.env.EXO_API_KEY);
        orderData.append('action', 'add');
        orderData.append('service', exoServiceId);
        orderData.append('link', link);
        
        // --- CORRECTION : Utilisation de la nouvelle constante sécurisée ---
        if (isCustomComments) {
            orderData.append('comments', comments ? (Array.isArray(comments) ? comments.join('\n') : comments) : '');
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

        // --- MISE À JOUR SÉCURISÉE DE LA BASE DE DONNÉES ---
        await db.runTransaction(async (transaction) => {
            const counterRef = db.collection('counters').doc('commandes');
            const currentUserRef = db.collection('users').doc(uid);
            
            const counterDoc = await transaction.get(counterRef);
            const currentUserDoc = await transaction.get(currentUserRef);

            const balanceInTransaction = currentUserDoc.data().balance || 0;
            if (balanceInTransaction < cost) {
                throw new Error("Solde revendeur devenu insuffisant pendant le traitement.");
            }

            if (isGuest && storeId && customerEmail) {
                const customerRef = db.collection('stores').doc(storeId).collection('customers').doc(customerEmail);
                const customerDocSnapshot = await transaction.get(customerRef);
                const custBalTrans = customerDocSnapshot.exists ? (customerDocSnapshot.data().balance || 0) : 0;
                
                if (custBalTrans < exactCustomerPrice) {
                    throw new Error("Solde client devenu insuffisant pendant le traitement.");
                }

                transaction.set(customerRef, { balance: custBalTrans - exactCustomerPrice }, { merge: true });
                
                const currentSoldeBoutique = currentUserDoc.data().soldeBoutique || 0;
                transaction.update(currentUserRef, { soldeBoutique: currentSoldeBoutique + profitForReseller });
                
                const storeTransactionRef = db.collection('stores').doc(storeId).collection('transactions').doc();
                transaction.set(storeTransactionRef, {
                    serviceName: service.name,
                    quantity: finalQuantity,
                    totalPaid: exactCustomerPrice,
                    profit: profitForReseller,
                    customerEmail: customerEmail,
                    createdAt: admin.firestore.FieldValue.serverTimestamp()
                });
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
                unitPrice: unitPrice, 
                status: 'En attente',
                isRefunded: false, 
                date: admin.firestore.FieldValue.serverTimestamp(),
                contactInfo: contact || 'Aucun contact',
                orderedFromStore: orderedFromStore,
                customerEmail: isGuest ? customerEmail : null 
            });
        });

        return res.status(200).json({ 
            success: true, 
            orderId: finalFormattedOrderId, 
            newBalance: newBalance 
        });

    } catch (error) {
        console.error("Erreur de commande:", error);
        if (error.message.includes("Solde")) {
             return res.status(400).json({ success: false, error: error.message });
        }
        return res.status(500).json({ success: false, error: 'Une erreur technique est survenue. Réessayez plus tard.' });
    }
}