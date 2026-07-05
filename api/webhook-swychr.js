const { db, admin } = require('./_firebase');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).send('Méthode non autorisée');
  }

  try {
    const payload = req.body;
    const attributes = payload?.data?.data?.attributes || payload; // Ajustement au cas où la structure varie
    
    if (!attributes || !attributes.transaction_id) {
      return res.status(400).send('Payload invalide');
    }

    const { status, transaction_id } = attributes;

    // 💡 Ajout des statuts multilingues (FR, EN) et numériques
    const successStatuses = [
      1, '1', 'success', 'SUCCESS', 'completed', 'COMPLETED', 
      'réussi', 'REUSSI', 'payé', 'PAYE', 'successful'
    ];

    // On vérifie si le statut reçu fait partie de notre liste de succès
    const isSuccess = successStatuses.includes(status);

    if (isSuccess) {
      const txRef = db.collection('transactions').doc(transaction_id);
      const txDoc = await txRef.get();

      if (txDoc.exists && txDoc.data().status === 'pending') {
        const { userId, amountXAF } = txDoc.data();

        // Mise à jour du solde de l'utilisateur
        await db.collection('users').doc(userId).update({
          balance: admin.firestore.FieldValue.increment(amountXAF)
        });

        // Mise à jour de la transaction
        await txRef.update({
          status: 'completed',
          paidAt: new Date().toISOString()
        });
      }
    }
    return res.status(200).send('Webhook traité avec succès');
  } catch (error) {
    console.error('Erreur Webhook:', error);
    return res.status(500).send('Erreur interne');
  }
};
      
