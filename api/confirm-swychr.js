const { db, admin } = require('./_firebase');

module.exports = async function handler(req, res) {
  // 1. CORS
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
    console.log(`\n=== DÉBUT VÉRIFICATION SWYCHR : ${transactionId} ===`);

    // 2. AUTHENTIFICATION
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
      console.error('❌ ERREUR AUTHENTIFICATION CONTRE LE PARTENAIRE');
      throw new Error("Impossible de s'authentifier chez Swychr");
    }

    // 3. APPEL API VERS SWYCHR
    const statusRes = await fetch('https://api.accountpe.com/api/payin/payment_link_status', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${authData.token}`
      },
      body: JSON.stringify({
        transaction_id: transactionId
      })
    });

    const textResponse = await statusRes.text();
    let statusData;
    try {
      statusData = JSON.parse(textResponse);
    } catch (e) {
      throw new Error("Format de réponse invalide (Pas du JSON)");
    }

    // 4. EXTRACTION DU VRAI STATUT IMBRIQUÉ
    const attributes = statusData?.data?.data?.attributes || statusData?.data?.attributes || {};
    const realPartnerStatus = attributes.status || "inconnu";
    
    const rawStatus = String(realPartnerStatus).toLowerCase().trim();
    console.log(`📊 VRAI statut extrait du paiement : "${rawStatus}"`);

    // Listes de correspondances de statuts
    const statusSucces = ["1", "success", "completed", "terminé", "succès", "reussi", "successful", "paid"];
    const statusEchec = ["-1", "2", "failed", "echec", "annulé", "cancelled", "rejected", "error"];
    
    let interpretedStatus = "pending";
    if (statusSucces.includes(rawStatus)) {
      interpretedStatus = "success";
    } else if (statusEchec.includes(rawStatus)) {
      interpretedStatus = "failed";
    }

    console.log(`🎯 Statut interprété par notre logique : "${interpretedStatus}"`);

    // 5. MISE À JOUR DE LA BASE DE DONNÉES FIREBASE
    const txRef = db.collection('transactions').doc(transactionId);
    
    const result = await db.runTransaction(async (transaction) => {
      const txDoc = await transaction.get(txRef);

      if (!txDoc.exists) {
        throw new Error("Transaction introuvable dans Firebase");
      }

      const txData = txDoc.get ? txDoc.data() : txDoc;

      // Sécurité anti-double rechargement
      if (txData.status === 'completed') {
        console.log("✅ Déjà crédité précédemment.");
        return { finalStatus: 'success', message: 'Déjà crédité' };
      }

      // Si c'est un succès, on valide l'argent !
      if (interpretedStatus === 'success') {
        const userRef = db.collection('users').doc(txData.userId);
        const userDoc = await transaction.get(userRef);
        
        let currentBalance = 0;
        if (userDoc.exists) {
          currentBalance = userDoc.data().balance || 0;
        }

        // CORRECTION SÉCURISÉE : Calcul manuel direct dans la transaction pour éviter le bug d'import 'admin'
        const newBalance = currentBalance + Number(txData.amountXAF);
        
        transaction.update(userRef, {
          balance: newBalance
        });
        
        // Clôture la transaction
        transaction.update(txRef, {
          status: 'completed',
          verifiedBy: 'api_direct_check_success',
          paidAt: new Date().toISOString()
        });
        
        console.log(`💰 SUCCÈS : Utilisateur ${txData.userId} crédité ! Nouveau solde: ${newBalance} XAF`);
        return { finalStatus: 'success', message: 'Solde mis à jour avec succès' };
      } 
      
      else if (interpretedStatus === 'failed') {
        transaction.update(txRef, {
          status: 'failed',
          verifiedBy: 'api_direct_check_failed'
        });
        return { finalStatus: 'failed', message: 'Paiement échoué ou annulé' };
      }

      return { finalStatus: 'pending', message: 'Toujours en attente chez l\'opérateur' };
    });

    console.log(`=== FIN VÉRIFICATION ===\n`);
    return res.status(200).json(result);

  } catch (error) {
    console.error('💥 ERREUR CRITIQUE:', error);
    return res.status(500).json({ error: error.message, finalStatus: 'pending' });
  }
};
        
