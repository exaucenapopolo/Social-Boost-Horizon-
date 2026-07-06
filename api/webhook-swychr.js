const { db, admin } = require('./_firebase');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).send('Méthode non autorisée');
  }

  try {
    const payload = req.body;
    const attributes = payload?.data?.data?.attributes;
    
    if (!attributes) {
      return res.status(400).send('Payload invalide');
    }

    const { status, transaction_id } = attributes;

    // Le statut 1 signifie succès selon l'API
    if (status === 1) {
      const txRef = db.collection('transactions').doc(transaction_id);
      const txDoc = await txRef.get();

      // On s'assure que la transaction est toujours en attente pour éviter les doubles paiements
      if (txDoc.exists && txDoc.data().status === 'pending') {
        const { userId, amountXAF } = txDoc.data();

        // On incrémente le solde du client
        await db.collection('users').doc(userId).update({
          balance: admin.firestore.FieldValue.increment(amountXAF)
        });

        // On marque la transaction comme terminée
        await txRef.update({
          status: 'completed',
          paidAt: new Date().toISOString()
        });
      }
    }
    return res.status(200).send('Webhook reçu et traité');
  } catch (error) {
    console.error('Erreur Webhook:', error);
    return res.status(500).send('Erreur interne');
  }
};
      
