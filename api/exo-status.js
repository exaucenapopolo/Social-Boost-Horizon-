// api/exo-status.js

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
    // On accepte uniquement les requêtes POST pour envoyer l'ID de la commande
    if (req.method !== 'POST') {
        return res.status(405).json({ success: false, error: 'Méthode non autorisée' });
    }

    try {
        // 2. Vérification de la sécurité : l'utilisateur est-il bien connecté ?
        const authHeader = req.headers.authorization;
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return res.status(401).json({ success: false, error: 'Vous devez être connecté.' });
        }
        
        const token = authHeader.split('Bearer ')[1];
        const decodedToken = await admin.auth().verifyIdToken(token);
        const uid = decodedToken.uid;

        // 3. Récupération de l'ID du document de la commande depuis le frontend
        const { orderId } = req.body;
        if (!orderId) {
            return res.status(400).json({ success: false, error: 'ID de commande manquant.' });
        }

        // 4. On récupère la commande dans la base de données
        const orderRef = db.collection('commandes').doc(orderId);
        const orderDoc = await orderRef.get();

        if (!orderDoc.exists) {
            return res.status(404).json({ success: false, error: 'Commande introuvable dans la base de données.' });
        }

        const orderData = orderDoc.data();

        // Sécurité : on vérifie que la commande appartient bien à l'utilisateur qui fait la requête
        if (orderData.userId !== uid) {
            return res.status(403).json({ success: false, error: 'Accès refusé à cette commande.' });
        }

        // 5. On vérifie que c'est bien une commande envoyée au fournisseur
        if (!orderData.exoOrderId) {
            return res.status(400).json({ success: false, error: 'Cette commande ne possède pas d\'ID fournisseur.' });
        }

        // 6. On interroge l'API d'Exo Supplier pour avoir le statut en temps réel
        const url = 'https://exosupplier.com/api/v2';
        const formData = new URLSearchParams();
        formData.append('key', process.env.EXO_API_KEY);
        formData.append('action', 'status');
        formData.append('order', orderData.exoOrderId);

        const exoRes = await fetch(url, { method: 'POST', body: formData });
        const exoData = await exoRes.json();

        // Gestion d'erreur venant du fournisseur
        if (exoData.error) {
            return res.status(400).json({ success: false, error: 'Erreur fournisseur: ' + exoData.error });
        }

        // 7. Traduction du statut du fournisseur (souvent en anglais) vers le français
        let nouveauStatut = exoData.status; // ex: Pending, Processing, Completed...
        
        switch(exoData.status.toLowerCase()) {
            case 'pending': nouveauStatut = 'En attente'; break;
            case 'processing': 
            case 'in progress': nouveauStatut = 'En cours'; break;
            case 'completed': nouveauStatut = 'Succès'; break;
            case 'partial': nouveauStatut = 'Partiel'; break;
            case 'canceled': nouveauStatut = 'Annulée'; break;
        }

        // 8. Mise à jour de la commande dans Firebase avec les nouvelles données
        await orderRef.update({
            status: nouveauStatut,
            exoRemains: exoData.remains !== undefined ? exoData.remains : (orderData.exoRemains || 0),
            startCount: exoData.start_count !== undefined ? exoData.start_count : (orderData.startCount || 0),
            updatedAt: admin.firestore.FieldValue.serverTimestamp() // Optionnel : garde une trace de l'heure de mise à jour
        });

        // 9. On renvoie une réponse positive au frontend avec le nouveau statut
        return res.status(200).json({ 
            success: true, 
            status: nouveauStatut, 
            remains: exoData.remains 
        });

    } catch (error) {
        console.error("Erreur lors de la vérification du statut:", error);
        return res.status(500).json({ success: false, error: 'Erreur technique serveur.' });
    }
}
