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

export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ success: false, error: 'Méthode non autorisée' });
    }

    try {
        // 2. Vérification de la sécurité (Le client est-il bien connecté ?)
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

        // Refus immédiat si l'argent n'est pas suffisant avant même de contacter le fournisseur
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

        // 7. TRANSACTION FIREBASE : Mise à jour sécurisée du compteur, du solde et création de la commande
        let finalOrderId;
        let newBalance;

        await db.runTransaction(async (transaction) => {
            // Références des documents à lire/modifier
            const counterRef = db.collection('counters').doc('commandes');
            const currentUserRef = db.collection('users').doc(uid);
            
            // On lit les données actuelles dans la transaction
            const counterDoc = await transaction.get(counterRef);
            const currentUserDoc = await transaction.get(currentUserRef);

            // Vérification finale du solde (au cas où il a dépensé entre-temps)
            const balanceInTransaction = currentUserDoc.data().balance || 0;
            if (balanceInTransaction < cost) {
                throw new Error("Solde devenu insuffisant pendant le traitement.");
            }

            // Calcul du nouveau numéro de commande
            let nextOrderId = 1; // Si c'est la toute première commande du site
            if (counterDoc.exists && counterDoc.data().lastId) {
                nextOrderId = counterDoc.data().lastId + 1;
            }

            // Sauvegarde des variables pour les renvoyer au frontend
            finalOrderId = nextOrderId;
            newBalance = balanceInTransaction - cost;

            // A. On met à jour le compteur global
            transaction.set(counterRef, { lastId: nextOrderId }, { merge: true });

            // B. On déduit le solde de l'utilisateur
            transaction.update(currentUserRef, { balance: newBalance });

            // C. On crée la commande dans la collection 'commandes'
            // On utilise un ID automatique pour le document, mais on enregistre notre propre numéro dedans
            const newOrderRef = db.collection('commandes').doc(); 
            transaction.set(newOrderRef, {
                numeroCommande: finalOrderId, // Ton propre compteur !
                userId: uid,
                exoOrderId: orderResult.order, // On garde quand même l'ID du fournisseur au cas où on doit lui faire une réclamation
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

        // 8. On renvoie la validation finale au frontend avec notre propre numéro
        return res.status(200).json({ 
            success: true, 
            orderId: finalOrderId, // Retourne ton propre numéro au client
            newBalance: newBalance 
        });

    } catch (error) {
        console.error("Erreur de commande:", error);
        
        // Gestion de l'erreur si le solde a changé pendant la transaction
        if (error.message === "Solde devenu insuffisant pendant le traitement.") {
             return res.status(400).json({ success: false, error: error.message });
        }

        return res.status(500).json({ success: false, error: 'Une erreur technique est survenue. Réessayez plus tard.' });
    }
            }
    
