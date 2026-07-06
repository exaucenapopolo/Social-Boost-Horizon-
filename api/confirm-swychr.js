const { db } = require('./_firebase');

module.exports = async function handler(req, res) {
  // AJOUT : En-têtes CORS pour autoriser ton site à faire des requêtes
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  // Gestion de la requête préliminaire (preflight) de CORS
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const { transactionId } = req.query;

  if (!transactionId) {
    return res.status(400).json({ error: 'ID manquant' });
  }

  try {
    const txDoc = await db.collection('transactions').doc(transactionId).get();
    
    if (txDoc.exists && txDoc.data().status === 'completed') {
      return res.status(200).json({ isPaid: true });
    }
    
    // Si la transaction n'existe pas ou n'est pas encore 'completed'
    return res.status(200).json({ isPaid: false });
    
  } catch (error) {
    console.error('Erreur lors de la vérification:', error);
    return res.status(500).json({ error: error.message });
  }
};
