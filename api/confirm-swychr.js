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
      console.error('❌ ERREUR AUTHENTIFICATION:', authData);
      throw new Error("Impossible de s'authentifier chez Swychr");
    }

    // 3. APPEL API VERS SWYCHR
    console.log(`🔍 Interrogation de AccountPe pour le statut...`);
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

    // 🛡️ SÉCURITÉ : On lit la réponse en texte brut d'abord au cas où Swychr renvoie une page d'erreur
    const textResponse = await statusRes.text();
    console.log(`📦 RÉPONSE BRUTE DE SWYCHR :`, textResponse);

    let statusData;
    try {
      statusData = JSON.parse(textResponse);
    } catch (e) {
      console.error("❌ SWYCHR N'A PAS RENVOYÉ DU JSON !");
      throw new Error("Format de réponse invalide");
    }

    // 4. ANALYSE DU STATUT
    const partnerStatus = statusData?.data?.status ?? statusData?.status;
    const rawStatus = String(partnerStatus).toLowerCase();
    
    console.log(`📊 Statut extrait du JSON : "${rawStatus}"`);

    const statusSucces = ["1", "success", "completed", "terminé", "succès", "reussi", "successful", "paid"];
    const statusEchec = ["-1", "2", "failed", "echec", "annulé", "cancelled", "rejected", "error", "undefined", "null"];
    
    let interpretedStatus = "pending";
    if (statusSucces.includes(rawStatus)) {
      interpretedStatus = "success";
    } else if (statusEchec.includes(rawStatus)) {
      interpretedStatus = "failed";
    }

    console.log(`🎯 Statut interprété par notre code : "${interpretedStatus}"`);

    // 5. MISE À JOUR FIREBASE
    const txRef = db.collection('transactions').doc(transactionId);
    
    const result = await db.runTransaction(async (transaction) => {
      const txDoc = await transaction.get(txRef);

      if (!txDoc.exists) {
        console.error("❌ Transaction introuvable dans Firebase");
        throw new Error("Transaction introuvable");
      }

      const txData = txDoc.data();

      // Anti-double paiement
      if (txData.status === 'completed') {
        console.log("✅ Transaction déjà complétée auparavant.");
        return { finalStatus: 'success', message: 'Déjà crédité' };
      }

      if (interpretedStatus === 'success') {
        const userRef = db.collection('users').doc(txData.userId);
        transaction.update(userRef, {
          balance: admin.firestore.FieldValue.increment(txData.amountXAF)
        });
        transaction.update(txRef, {
          status: 'completed',
          verifiedBy: 'api_direct_check',
          paidAt: new Date().toISOString()
        });
        console.log("💰 Solde mis à jour avec succès dans Firebase !");
        return { finalStatus: 'success', message: 'Solde mis à jour avec succès' };
      } 
      
      if (interpretedStatus === 'failed') {
        transaction.update(txRef, {
          status: 'failed',
          verifiedBy: 'api_direct_check'
        });
        console.log("❌ Paiement marqué comme échoué dans Firebase.");
        return { finalStatus: 'failed', message: 'Paiement échoué ou annulé' };
      }

      console.log("⏳ La transaction est toujours marquée 'en cours'.");
      // On inclut les détails de Swychr pour le voir côté Frontend au besoin
      return { finalStatus: 'pending', message: 'Toujours en attente', swychrResponse: statusData };
    });

    console.log(`=== FIN VÉRIFICATION ===\n`);
    return res.status(200).json(result);

  } catch (error) {
    console.error('💥 ERREUR CRITIQUE confirm-swychr:', error);
    return res.status(500).json({ error: error.message, finalStatus: 'pending' });
  }
};
                         
