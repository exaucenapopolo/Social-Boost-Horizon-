// api/exo-status.js

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

        const { orderId } = req.body;
        if (!orderId) {
            return res.status(400).json({ success: false, error: 'ID de commande manquant.' });
        }

        const orderRef = db.collection('commandes').doc(orderId);
        const orderDoc = await orderRef.get();

        if (!orderDoc.exists) {
            return res.status(404).json({ success: false, error: 'Commande introuvable dans la base de données.' });
        }

        const orderData = orderDoc.data();

        if (orderData.userId !== uid) {
            return res.status(403).json({ success: false, error: 'Accès refusé à cette commande.' });
        }

        if (!orderData.exoOrderId) {
            return res.status(400).json({ success: false, error: 'Cette commande ne possède pas d\'ID fournisseur.' });
        }

        // 1. Interrogation du fournisseur en dehors de la transaction
        const url = 'https://exosupplier.com/api/v2';
        const formData = new URLSearchParams();
        formData.append('key', process.env.EXO_API_KEY);
        formData.append('action', 'status');
        formData.append('order', orderData.exoOrderId);

        const exoRes = await fetch(url, { method: 'POST', body: formData });
        const exoData = await exoRes.json();

        if (exoData.error) {
            return res.status(400).json({ success: false, error: 'Erreur fournisseur: ' + exoData.error });
        }

        let nouveauStatut = exoData.status; 
        const exoStatusLower = exoData.status.toLowerCase();
        
        switch(exoStatusLower) {
            case 'pending': nouveauStatut = 'En attente'; break;
            case 'processing': 
            case 'in progress': nouveauStatut = 'En cours'; break;
            case 'completed': nouveauStatut = 'Succès'; break;
            case 'partial': nouveauStatut = 'Partiel'; break;
            case 'canceled': nouveauStatut = 'Annulée'; break;
        }

        let refundAmount = 0;
        let isRefundProcessed = false;

        // 2. Transaction sécurisée pour mettre à jour la BDD et gérer les remboursements
        await db.runTransaction(async (transaction) => {
            const currentOrderDoc = await transaction.get(orderRef);
            const currentOrderData = currentOrderDoc.data();
            
            const userRef = db.collection('users').doc(uid);
            const userDoc = await transaction.get(userRef);
            const userBalance = userDoc.exists ? (userDoc.data().balance || 0) : 0;

            const updatePayload = {
                status: nouveauStatut,
                exoRemains: exoData.remains !== undefined ? exoData.remains : (currentOrderData.exoRemains || 0),
                startCount: exoData.start_count !== undefined ? exoData.start_count : (currentOrderData.startCount || 0),
                updatedAt: admin.firestore.FieldValue.serverTimestamp()
            };

            // Gestion des annulations et partiels sécurisée
            if ((exoStatusLower === 'canceled' || exoStatusLower === 'partial') && !currentOrderData.isRefunded) {
                const totalCost = currentOrderData.cost || 0;
                
                if (exoStatusLower === 'canceled') {
                    // Remboursement total
                    refundAmount = totalCost;
                } else if (exoStatusLower === 'partial') {
                    // Remboursement partiel basé sur le prix unitaire
                    const remains = parseInt(exoData.remains) || 0;
                    const unitPrice = currentOrderData.unitPrice || (totalCost / currentOrderData.quantity);
                    refundAmount = Math.round(unitPrice * remains);
                }

                if (refundAmount > 0) {
                    transaction.update(userRef, { balance: userBalance + refundAmount });
                    updatePayload.isRefunded = true;
                    updatePayload.refundAmount = refundAmount;
                    isRefundProcessed = true;
                }
            }

            transaction.update(orderRef, updatePayload);
        });

        return res.status(200).json({ 
            success: true, 
            status: nouveauStatut, 
            remains: exoData.remains,
            refunded: isRefundProcessed,
            refundAmount: refundAmount
        });

    } catch (error) {
        console.error("Erreur lors de la vérification du statut:", error);
        return res.status(500).json({ success: false, error: 'Erreur technique serveur.' });
    }
}