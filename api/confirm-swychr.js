const { db, admin } = require('./_firebase');

module.exports = async function handler(req, res) {
  // Autoriser la page web à appeler ce code
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const { transactionId } = req.query;

  if (!transactionId) {
    return res.status(400).json({ error: 'ID de transaction manquant' });
  }

  try {
    const statusSucces = ["success", "completed", "terminé", "succès", "reussi", "1", "successful", "paid"];
    const statusEchec = ["failed", "echec", "annulé", "cancelled", "rejected", "rejeté", "-1", "error"];

    const txRef = db.collection('transactions').doc(transactionId);
    
    // SÉCURITÉ ABSOLUE : Verrouillage de la transaction avec runTransaction
    const result = await db.runTransaction(async (transaction) => {
      const txDoc = await transaction.get(txRef);

      if (!txDoc.exists) {
        return { finalStatus: 'error', message: "Transaction introuvable" };
      }

      const txData = txDoc.data();
      
      // VÉRIFICATION ANTI-DOUBLE PAIEMENT
      if (txData.status === 'completed') {
        return { finalStatus: 'success', message: 'Déjà crédité' };
      }

      const rawStatus = txData.status ? txData.status.toString().toLowerCase() : "pending";
      let interpretedStatus = "pending"; 
      
      if (statusSucces.includes(rawStatus)) {
        interpretedStatus = "success";
      } else if (statusEchec.includes(rawStatus)) {
        interpretedStatus = "failed";
      }

      // Si le statut interprété est un VRAI succès non crédité, ON CRÉDITE ICI
      if (interpretedStatus === 'success') {
        const userRef = db.collection('users').doc(txData.userId);
        
        transaction.update(userRef, {
          balance: admin.firestore.FieldValue.increment(txData.amountXAF)
        });
        
        transaction.update(txRef, {
          status: 'completed',
          verifiedBy: 'manual_button',
          paidAt: new Date().toISOString()
        });

        return { finalStatus: 'success', message: 'Solde mis à jour avec succès' };
      }

      // Sinon, on renvoie l'état actuel sans toucher à l'argent
      return { finalStatus: interpretedStatus, message: 'Vérification terminée, toujours en attente.' };
    });

    return res.status(200).json(result);

  } catch (error) {
    console.error('Erreur lors de la vérification manuelle:', error);
    return res.status(500).json({ error: error.message, finalStatus: 'error' });
  }
};
