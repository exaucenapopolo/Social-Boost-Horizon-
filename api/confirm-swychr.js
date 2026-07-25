const { db, admin } = require('./_firebase');

module.exports = async function handler(req, res) {
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
    console.log(`\n=== ÉTAPE 1 : DÉBUT DE LA VÉRIFICATION POUR ${transactionId} ===`);

    // 1. AUTHENTIFICATION CHEZ LE PARTENAIRE
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
      throw new Error("Échec authentification Swychr : Token introuvable");
    }

    // 2. VÉRIFICATION DU STATUT DU PAIEMENT
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
      throw new Error("Réponse API Swychr invalide (non JSON)");
    }

    // 3. ANALYSE DU STATUT
    const attributes = statusData?.data?.data?.attributes || statusData?.data?.attributes || {};
    const realPartnerStatus = attributes.status || "inconnu";
    const rawStatus = String(realPartnerStatus).toLowerCase().trim();
    
    console.log(`📊 Statut brut opérateur : "${rawStatus}"`);

    const statusSucces = ["1", "success", "completed", "terminé", "succès", "reussi", "successful", "paid"];
    const statusEchec = ["-1", "2", "failed", "echec", "annulé", "cancelled", "rejected", "error"];
    
    let interpretedStatus = "pending";
    if (statusSucces.includes(rawStatus)) {
      interpretedStatus = "success";
    } else if (statusEchec.includes(rawStatus)) {
      interpretedStatus = "failed";
    }

    // 4. TRANSACTION FIREBASE
    const txRef = db.collection('transactions').doc(transactionId);
    
    const result = await db.runTransaction(async (transaction) => {
      // --- PHASE DE LECTURE (GET) ---
      const txDoc = await transaction.get(txRef);
      if (!txDoc.exists) {
        throw new Error(`Transaction ${transactionId} introuvable dans Firebase`);
      }
      
      const txData = txDoc.data();

      if (txData.status === 'completed') {
        return { finalStatus: 'success', message: 'Déjà crédité' };
      }

      let userRef = null;
      let currentBalance = 0;
      let storeCustomerRef = null;
      let currentStoreBalance = 0;

      if (interpretedStatus === 'success') {
        // Lecture de l'utilisateur global (s'il existe)
        if (txData.userId) {
          userRef = db.collection('users').doc(txData.userId);
          const userDoc = await transaction.get(userRef);
          if (userDoc.exists) {
            currentBalance = userDoc.data().balance || 0;
          }
        }

        // Lecture du client de la boutique
        if (txData.storeId && txData.email) {
          storeCustomerRef = db.collection('stores').doc(txData.storeId).collection('customers').doc(txData.email);
          const storeCustomerDoc = await transaction.get(storeCustomerRef);
          if (storeCustomerDoc.exists) {
            currentStoreBalance = storeCustomerDoc.data().balance || 0;
          }
        }
      }

      // --- PHASE D'ÉCRITURE (SET / UPDATE) ---
      if (interpretedStatus === 'success') {
        const amountToAdd = Number(txData.amountXAF) || 0;

        // A. Mise à jour ou création de l'utilisateur global (UTILISATION DE SET AVEC MERGE)
        if (userRef) {
          const newBalance = currentBalance + amountToAdd;
          transaction.set(userRef, { balance: newBalance }, { merge: true });
        }

        // B. Mise à jour ou création du client de la boutique (UTILISATION DE SET AVEC MERGE)
        if (storeCustomerRef) {
          const newStoreBalance = currentStoreBalance + amountToAdd;
          transaction.set(storeCustomerRef, { balance: newStoreBalance }, { merge: true });
        }
        
        // C. Mise à jour du statut de la transaction
        transaction.update(txRef, {
          status: 'completed',
          verifiedBy: 'api_direct_check_success',
          paidAt: new Date().toISOString()
        });
        
        console.log(`💰 SUCCÈS : Solde mis à jour avec succès !`);
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

    return res.status(200).json(result);

  } catch (error) {
    console.error('💥 ERREUR INTERCEPTEUR 500 :', error.message);
    return res.status(500).json({ error: error.message, finalStatus: 'error' });
  }
};
        
