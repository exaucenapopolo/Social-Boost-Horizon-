const { db, admin } = require('./_firebase');

module.exports = async function handler(req, res) {
  // 1. Autoriser la page web à appeler ce code (CORS)
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
    // 2. AUTHENTIFICATION AUPRÈS DU PARTENAIRE (Swychr / AccountPe)
    const authRes = await fetch('https://api.accountpe.com/api/payin/admin/auth', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: process.env.ACCOUNTPE_USERNAME,
        password: process.env.ACCOUNTPE_PASSWORD
      })
    });

    const authData = await authRes.json();
    if (!authData.token) {
      throw new Error('Échec de l\'authentification auprès du partenaire');
    }

    // 3. VÉRIFICATION EN DIRECT DU STATUT
    // On appelle le point de terminaison que tu as trouvé dans la documentation
    const statusRes = await fetch('https://api.accountpe.com/api/payin/payment_link_status', {
      method: 'POST', // Généralement POST pour envoyer un JSON
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${authData.token}`
      },
      body: JSON.stringify({
        transaction_id: transactionId
      })
    });

    const statusData = await statusRes.json();
    
    // On récupère le statut envoyé par l'API (selon la doc : statut = 1 est un succès)
    const partnerStatus = statusData?.data?.status || statusData?.status;
    const rawStatus = String(partnerStatus).toLowerCase();

    // Dictionnaires de statuts
    const statusSucces = ["1", "success", "completed", "terminé", "succès", "reussi", "successful", "paid"];
    const statusEchec = ["-1", "2", "failed", "echec", "annulé", "cancelled", "rejected", "error"];
    
    let interpretedStatus = "pending";
    if (statusSucces.includes(rawStatus)) {
      interpretedStatus = "success";
    } else if (statusEchec.includes(rawStatus)) {
      interpretedStatus = "failed";
    }

    // 4. SÉCURITÉ ET MISE À JOUR FIREBASE
    const txRef = db.collection('transactions').doc(transactionId);
    
    const result = await db.runTransaction(async (transaction) => {
      const txDoc = await transaction.get(txRef);

      if (!txDoc.exists) {
        throw new Error("Transaction introuvable dans la base de données");
      }

      const txData = txDoc.data();

      // Vérification anti-double paiement
      if (txData.status === 'completed') {
        return { finalStatus: 'success', message: 'Déjà crédité' };
      }

      // Si Swychr nous confirme que c'est un succès :
      if (interpretedStatus === 'success') {
        const userRef = db.collection('users').doc(txData.userId);
        
        // Crédite l'utilisateur
        transaction.update(userRef, {
          balance: admin.firestore.FieldValue.increment(txData.amountXAF)
        });
        
        // Sécurise la transaction
        transaction.update(txRef, {
          status: 'completed',
          verifiedBy: 'api_direct_check', // Pour savoir que ça vient de cette vérification
          paidAt: new Date().toISOString()
        });

        return { finalStatus: 'success', message: 'Solde mis à jour avec succès' };
      } 
      
      // Si Swychr nous confirme que c'est un échec
      else if (interpretedStatus === 'failed') {
        transaction.update(txRef, {
          status: 'failed',
          verifiedBy: 'api_direct_check'
        });
        return { finalStatus: 'failed', message: 'Paiement échoué ou annulé' };
      }

      // Si ce n'est ni un succès ni un échec, c'est que c'est toujours en cours
      return { finalStatus: 'pending', message: 'Toujours en attente chez l\'opérateur' };
    });

    return res.status(200).json(result);

  } catch (error) {
    console.error('Erreur lors de la vérification directe API:', error);
    // Si l'API partenaire a un problème temporaire, on renvoie une erreur sans planter l'interface
    return res.status(500).json({ error: error.message, finalStatus: 'pending' });
  }
};
      
