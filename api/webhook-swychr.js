const { db, admin } = require('./_firebase');

module.exports = async function handler(req, res) {
  // En-têtes CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).send('Méthode non autorisée');
  }

  try {
    const payload = req.body;
    
    console.log('--- NOUVEAU WEBHOOK REÇU ---');
    console.log(JSON.stringify(payload, null, 2));

    const attributes = payload?.data?.data?.attributes || payload?.data?.attributes || payload;
    
    if (!attributes) {
      console.error('Payload invalide ou vide');
      return res.status(400).send('Payload invalide');
    }

    const { status, transaction_id } = attributes;
    
    console.log(`Transaction ID traitée: ${transaction_id}, Status: ${status}`);

    // Vérifie si le statut est "succès" (1) selon l'API Swychr/AccountPe
    if (status === 1 || status === "success" || status === "COMPLETED") { 
      const txRef = db.collection('transactions').doc(transaction_id);

      // CORRECTION : Utilisation de runTransaction pour sécuriser à 100% contre le double-crédit
      await db.runTransaction(async (transaction) => {
        const txDoc = await transaction.get(txRef);

        if (!txDoc.exists) {
          console.error(`Document de transaction introuvable pour l'ID: ${transaction_id}`);
          return; // Sort de la transaction
        }

        const txData = txDoc.data();

        // Si la transaction n'est plus en attente, c'est qu'elle a déjà été créditée
        if (txData.status !== 'pending') {
          console.log(`La transaction ${transaction_id} a déjà été traitée (Statut actuel: ${txData.status}).`);
          return; 
        }

        const { userId, amountXAF } = txData;
        const userRef = db.collection('users').doc(userId);
        
        console.log(`Mise à jour du solde pour l'utilisateur ${userId} (+${amountXAF} XAF)`);

        // 1. Met à jour le solde utilisateur
        transaction.update(userRef, {
          balance: admin.firestore.FieldValue.increment(amountXAF)
        });

        // 2. Marque la transaction comme complétée de manière synchrone
        transaction.update(txRef, {
          status: 'completed',
          paidAt: new Date().toISOString(),
          verifiedBy: 'webhook'
        });
        
        console.log(`Transaction ${transaction_id} terminée avec succès par le webhook.`);
      });

    } else {
      console.log(`Statut non pris en compte pour la recharge: ${status}`);
    }
    
    // On répond toujours 200 pour dire au fournisseur de paiement qu'on a bien reçu le message
    return res.status(200).send('Webhook reçu et traité');
    
  } catch (error) {
    console.error('Erreur Critique Webhook:', error);
    return res.status(500).send('Erreur interne');
  }
};
            
