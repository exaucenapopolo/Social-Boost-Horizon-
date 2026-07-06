import { db, auth } from '../_utils/firebase.js';

export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ success: false, error: 'Méthode non autorisée' });
    }

    try {
        // 1. Vérification du token Firebase envoyé par le frontend
        const authHeader = req.headers.authorization;
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return res.status(401).json({ success: false, error: 'Non authentifié' });
        }
        const token = authHeader.split('Bearer ')[1];
        const decodedToken = await auth.verifyIdToken(token);
        const uid = decodedToken.uid;

        // 2. Récupération des données de la commande
        const { serviceId, link, quantity, comments } = req.body;
        if (!serviceId || !link) {
            return res.status(400).json({ success: false, error: 'Données de commande incomplètes' });
        }

        // 3. Récupération du prix exact depuis MTP pour éviter la fraude
        const MTP_API_KEY = process.env.MORETHANPANEL_API_KEY;
        const MTP_API_URL = 'https://morethanpanel.com/api/v2';
        const RATE_USD_TO_XAF = parseFloat(process.env.RATE_USD_TO_XAF || '650');
        const MARGIN_MULTIPLIER = parseFloat(process.env.MARGIN_MULTIPLIER || '2.0');

        const servicesRes = await fetch(`${MTP_API_URL}?key=${MTP_API_KEY}&action=services`);
        const servicesData = await servicesRes.json();
        const serviceInfo = servicesData.find(s => parseInt(s.service) === parseInt(serviceId));

        if (!serviceInfo) {
            return res.status(404).json({ success: false, error: 'Service introuvable chez le fournisseur' });
        }

        // 4. Calcul du prix total
        const finalUnitPriceXAF = parseFloat(serviceInfo.rate) * RATE_USD_TO_XAF * MARGIN_MULTIPLIER;
        let finalQuantity = quantity;
        
        // Si c'est des commentaires personnalisés, la quantité est le nombre de lignes
        if (comments) {
            const lines = comments.split('\n').filter(l => l.trim() !== '');
            finalQuantity = lines.length;
        }

        // La plupart des SMM facturent pour 1000. Si le service est un "package", c'est facturé à l'unité.
        const isPackage = serviceInfo.type === 'package';
        const totalCostXAF = isPackage ? finalUnitPriceXAF * finalQuantity : (finalUnitPriceXAF / 1000) * finalQuantity;
        const totalCostRounded = Math.round(totalCostXAF);

        // 5. Débit du compte utilisateur via une Transaction sécurisée
        const userRef = db.collection('users').doc(uid);
        let newBalance = 0;

        await db.runTransaction(async (transaction) => {
            const userDoc = await transaction.get(userRef);
            if (!userDoc.exists) {
                throw new Error("Utilisateur introuvable dans la base de données");
            }

            const currentBalance = userDoc.data().balance || 0;
            if (currentBalance < totalCostRounded) {
                throw new Error(`Solde insuffisant. Requis: ${totalCostRounded} FCFA, Actuel: ${currentBalance} FCFA`);
            }

            newBalance = currentBalance - totalCostRounded;
            transaction.update(userRef, { balance: newBalance });
        });

        // 6. Envoi de la commande à MoreThanPanel
        const mtpParams = new URLSearchParams();
        mtpParams.append('key', MTP_API_KEY);
        mtpParams.append('action', 'add');
        mtpParams.append('service', serviceId);
        mtpParams.append('link', link);
        
        if (comments) {
            mtpParams.append('comments', comments);
        } else {
            mtpParams.append('quantity', finalQuantity);
        }

        const orderRes = await fetch(MTP_API_URL, {
            method: 'POST',
            body: mtpParams
        });
        const orderData = await orderRes.json();

        if (orderData.error) {
            // Si MTP refuse la commande, on recrédite l'utilisateur (Rollback)
            await db.collection('users').doc(uid).update({ balance: newBalance + totalCostRounded });
            throw new Error(`Erreur fournisseur: ${orderData.error}`);
        }

        // 7. Succès : on retourne le nouveau solde et l'ID de la commande
        res.status(200).json({
            success: true,
            orderId: orderData.order,
            newBalance: newBalance
        });

    } catch (error) {
        console.error('Erreur traitement commande MTP:', error);
        res.status(500).json({ success: false, error: error.message });
    }
}
