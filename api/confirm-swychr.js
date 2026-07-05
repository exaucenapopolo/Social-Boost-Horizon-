// Fichier : api/confirm-swychr.js
const { db } = require('./_firebase');

export default async function handler(req, res) {
  const { transactionId } = req.query;

  if (!transactionId) {
    return res.status(400).json({ error: 'ID de transaction manquant' });
  }

  try {
    const txDoc = await db.collection('transactions').doc(transactionId).get();
    
    if (txDoc.exists && txDoc.data().status === 'completed') {
      return res.status(200).json({ isPaid: true });
    }
    
    return res.status(200).json({ isPaid: false });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}
