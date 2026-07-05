const { db, admin } = require('./_firebase');

module.exports = async function handler(req, res) {
  const { transactionId } = req.query;

  if (!transactionId) {
    return res.status(400).json({ error: 'ID manquant' });
  }

  try {
    const txRef = db.collection('transactions').doc(transactionId);
    const txDoc = await txRef.get();

    if (!txDoc.exists) {
      return res.status(404).json({ error: 'Transaction introuvable' });
    }

    const txData = txDoc.data();

    // 1. Si c'est déjà complété dans notre base, on répond OUI directement
    if (txData.status === 'completed') {
      return res.status(200).json({ isPaid: true, message: "Déjà validé en base" });
    }

    // 2. Si c'est en attente, on interroge DIRECTEMENT le partenaire (AccountPe/Swychr)
    if (txData.status === 'pending') {
      
      // On récupère d'abord un token d'authentification
      const authRes = await fetch('https://api.accountpe.com/api/payin/admin/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: process.env.ACCOUNTPE_USERNAME,
          password: process.env.ACCOUNTPE_PASSWORD
        })
      });
      const authData = await authRes.json();

      if (authData.token) {
        // Interrogation de l'API partenaire (⚠️ Ajuste l'URL selon leur documentation exacte)
        const statusRes = await fetch(`https://api.accountpe.com/api/payin/transaction/status/${transactionId}`, {
          method: 'GET',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${authData.token}`
          }
        });
        
        const statusData = await statusRes.json();
        const partnerStatus = statusData?.data?.status;

        // Liste de nos statuts valides
        const successStatuses = [1, '1', 'success', 'SUCCESS', 'completed', 'COMPLETED', 'réussi', 'payé'];

        if (successStatuses.includes(partnerStatus)) {
          // Le partenaire dit que c'est payé ! On met à jour manuellement.
          await db.collection('users').doc(txData.userId).update({
            balance: admin.firestore.FieldValue.increment(txData.amountXAF)
          });
          await txRef.update({
            status: 'completed',
            paidAt: new Date().toISOString()
          });

          return res.status(200).json({ isPaid: true, message: "Validé via le partenaire à l'instant" });
        }
      }
    }

    // Si on arrive ici, c'est que ce n'est vraiment pas encore payé
    return res.status(200).json({ isPaid: false });

  } catch (error) {
    console.error("Erreur de confirmation:", error);
    return res.status(500).json({ error: error.message });
  }
};
        
