// api/exo/cancel.js

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
            return res.status(404).json({ success: false, error: 'Commande introuvable.' });
        }

        const orderData = orderDoc.data();

        if (orderData.userId !== uid) {
            return res.status(403).json({ success: false, error: 'Accès refusé.' });
        }

        if (orderData.isRefunded) {
            return res.status(400).json({ success: false, error: 'Cette commande a déjà été remboursée.' });
        }

        // Envoyer la requête d'annulation au fournisseur
        const url = 'https://exosupplier.com/api/v2';
        const formData = new URLSearchParams();
        formData.append('key', process.env.EXO_API_KEY);
        // Note: Certains fournisseurs SMM utilisent 'cancel' ou 'refill' mais souvent on check le statut après
        formData.append('action', 'cancel'); 
        formData.append('order', orderData.exoOrderId);

        let exoRes = await fetch(url, { method: 'POST', body: formData });
        let exoData = await exoRes.json();

        // Si l'API du fournisseur ne supporte pas l'action directe "cancel", on vérifie son statut réel
        if (exoData.error && exoData.error.toLowerCase().includes('incorrect action')) {
            const statusData = new URLSearchParams();
            statusData.append('key', process.env.EXO_API_KEY);
            statusData.append('action', 'status');
            statusData.append('order', orderData.exoOrderId);
            exoRes = await fetch(url, { method: 'POST', body: statusData });
            exoData = await exoRes.json();
            
            if (exoData.status && exoData.status.toLowerCase() !== 'canceled') {
                return res.status(400).json({ success: false, error: "Le fournisseur n'autorise pas l'annulation de cette commande en cours." });
            }
        }

        let refundAmount = 0;

        await db.runTransaction(async (transaction) => {
            const currentOrderDoc = await transaction.get(orderRef);
            const currentOrderData = currentOrderDoc.data();

            if (currentOrderData.isRefunded) {
                throw new Error("Commande déjà remboursée en arrière-plan.");
            }

            const userRef = db.collection('users').doc(uid);
            const userDoc = await transaction.get(userRef);
            const userBalance = userDoc.exists ? (userDoc.data().balance || 0) : 0;

            refundAmount = currentOrderData.cost || 0;

            transaction.update(userRef, { balance: userBalance + refundAmount });
            transaction.update(orderRef, {
                status: 'Annulée',
                isRefunded: true,
                refundAmount: refundAmount,
                updatedAt: admin.firestore.FieldValue.serverTimestamp()
            });
        });

        return res.status(200).json({ 
            success: true, 
            refundAmount: refundAmount,
            message: "Commande annulée et remboursée avec succès."
        });

    } catch (error) {
        console.error("Erreur annulation:", error);
        return res.status(500).json({ success: false, error: error.message || 'Erreur technique serveur.' });
    }
}
