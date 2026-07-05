// api/order-exo.js

import admin from 'firebase-admin';

// 1. Initialisation sécurisée de Firebase Admin (pour lire/modifier les soldes)
if (!admin.apps.length) {
    admin.initializeApp({
        credential: admin.credential.cert({
            projectId: process.env.FIREBASE_PROJECT_ID,
            clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
            // Vercel nécessite de formater les retours à la ligne de la clé privée
            privateKey: process.env.FIREBASE_PRIVATE_KEY ? process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n') : '',
        })
    });
}

const db = admin.firestore();

export default async function handler(req, res) {
    // On n'accepte que les envois de données (POST)
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

        // 3. Récupération des données du formulaire envoyées par le frontend
        const { exoServiceId, link, quantity, comments, contactType, contact } = req.body;

        // 4. Vérification du solde utilisateur dans ta base Firebase
        const userRef = db.collection('users').doc(uid);
        const userDoc = await userRef.get();

        if (!userDoc.exists) {
            return res.status(404).json({ success: false, error: 'Compte utilisateur introuvable.' });
        }

        const userData = userDoc.data();
        let balance = userData.balance || 0;

        // 5. Récupération du vrai prix du service depuis Exo pour éviter la triche
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

        // Calcul exact du coût pour le client (doit correspondre au fichier exo-services.js)
        const EXCHANGE_RATE_USD_TO_XAF = 620;
        const PROFIT_MULTIPLIER = 1.5;
        const priceXAFPer1000 = parseFloat(service.rate) * EXCHANGE_RATE_USD_TO_XAF * PROFIT_MULTIPLIER;
        
        let cost = 0;
        if (service.type === 'Custom Comments') {
            cost = (priceXAFPer1000 / 1000) * comments.length;
        } else {
            cost = (priceXAFPer1000 / 1000) * quantity;
        }

        // 6. Refus si le client n'a pas assez d'argent
        if (balance < cost) {
            return res.status(400).json({ success: false, error: 'Solde insuffisant pour cette commande.' });
        }

        // 7. Passage de la commande chez Exo Supplier
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

        // 8. Gestion d'une erreur venant du fournisseur
        if (orderResult.error) {
            return res.status(400).json({ 
                success: false, 
                error: 'Erreur fournisseur: ' + orderResult.error,
                adminContact: '+237600000000' // Mets ton numéro WhatsApp ici
            });
        }

        // 9. Succès ! On déduit l'argent et on enregistre la commande
        const newBalance = balance - cost;
        await userRef.update({ balance: newBalance });

        // On sauvegarde l'historique dans Firebase
        await db.collection('orders').add({
            userId: uid,
            exoOrderId: orderResult.order, // L'ID donné par le fournisseur
            serviceId: exoServiceId,
            serviceName: service.name,
            link: link,
            quantity: service.type === 'Custom Comments' ? comments.length : quantity,
            cost: cost,
            status: 'En attente',
            date: admin.firestore.FieldValue.serverTimestamp(),
            contactInfo: contact || 'Aucun contact'
        });

        // On renvoie la validation au frontend
        return res.status(200).json({ success: true, orderId: orderResult.order, newBalance: newBalance });

    } catch (error) {
        console.error("Erreur de commande:", error);
        return res.status(500).json({ success: false, error: 'Une erreur technique est survenue. Réessayez plus tard.' });
    }
}