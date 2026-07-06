const { db } = require('./_firebase');

module.exports = async function handler(req, res) {
  // Récupération de l'ID via l'URL (ex: ?transactionId=123)
  const { transactionId } = req.query;

  if (!transactionId) {
    return res.status(400).json({ error: 'ID manquant' });
  }

  try {
    const txDoc = await db.collection('transactions').doc(transactionId).get();
    // On vérifie si la transaction existe et si le statut est validé
    if (txDoc.exists && txDoc.data().status === 'completed') {
      return res.status(200).json({ isPaid: true });
    }
    // Si ce n'est pas encore complété, on renvoie false
    return res.status(200).json({ isPaid: false });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
};
