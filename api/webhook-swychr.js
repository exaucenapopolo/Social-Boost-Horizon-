// Fichier : api/webhook-swychr.js
const { db, admin } = require('./_firebase');

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).send('Méthode non autorisée');
  }

  try {
    const payload = req.body;
    
    // Extraction des données selon la documentation Swychr
    const attributes = payload?.data?.data?.attributes;
    if (!attributes) {
      return res.status(400).send('Payload invalide');
    }

    const { status, transaction_id } = attributes;

    // Statut 1 = Succès chez Swychr
    if (status === 1) {
      // Vérifier la transaction dans notre base de données
      const txRef = db.collection('transactions').doc(transaction_id);
      const txDoc = await txRef.get();

      if (txDoc.exists && txDoc.data().status === 'pending') {
        const { userId, amountXAF } = txDoc.data();

        // Créditer le solde de l'utilisateur
        await db.collection('users').doc(userId).update({
          balance: admin.firestore.FieldValue.increment(amountXAF)
        });

        // Marquer la transaction comme terminée
        await txRef.update({
          status: 'completed',
          paidAt: new Date().toISOString()
        });

        console.log(`Succès: Solde de ${userId} crédité de ${amountXAF} FCFA`);
      }
    }

    // Toujours répondre 200 à Swychr pour dire qu'on a bien reçu le message
    return res.status(200).send('Webhook reçu');
  } catch (error) {
    console.error('Erreur Webhook:', error);
    return res.status(500).send('Erreur interne');
  }
}
