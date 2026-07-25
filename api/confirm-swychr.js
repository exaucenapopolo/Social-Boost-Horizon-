const { db, admin } = require('./_firebase');

module.exports = async function handler(req, res) {
  // === RÈGLES DE SÉCURITÉ CORS ===
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
      console.error('❌ ERREUR AUTHENTIFICATION CONTRE LE PARTENAIRE');
      throw new Error("Impossible de s'authentifier chez Swychr");
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
      throw new Error("Format de réponse invalide (Pas du JSON)");
    }

    // 3. ANALYSE DU STATUT
    const attributes = statusData?.data?.data?.attributes || statusData?.data?.attributes || {};
    const realPartnerStatus = attributes.status || "inconnu";
    
    const rawStatus = String(realPartnerStatus).toLowerCase().trim();
    console.log(`📊 VRAI statut extrait du paiement : "${rawStatus}"`);

    const statusSucces = ["1", "success", "completed", "terminé", "succès", "reussi", "successful", "paid"];
    const statusEchec = ["-1", "2", "failed", "echec", "annulé", "cancelled", "rejected", "error"];
    
    let interpretedStatus = "pending";
    if (statusSucces.includes(rawStatus)) {
      interpretedStatus = "success";
    } else if (statusEchec.includes(rawStatus)) {
      interpretedStatus = "failed";
    }

    console.log(`🎯 Statut interprété : "${interpretedStatus}"`);

    // 4. TRANSACTION FIREBASE CORRIGÉE (LECTURES D'ABORD, ÉCRITURES ENSUITE)
    const txRef = db.collection('transactions').doc(transactionId);
    
    const result = await db.runTransaction(async (transaction) => {
      // --- PHASE DE LECTURE (GET) ---
      
      // A. Lecture de la transaction
      const txDoc = await transaction.get(txRef);
      if (!txDoc.exists) {
        throw new Error("Transaction introuvable dans Firebase");
      }
      const txData = txDoc.get ? txDoc.data() : txDoc;

      if (txData.status === 'completed') {
        console.log("✅ Déjà crédité précédemment.");
        return { finalStatus: 'success', message: 'Déjà crédité' };
      }

      let userRef = null;
      let currentBalance = 0;
      let storeCustomerRef = null;
      let currentStoreBalance = 0;

      // Si le paiement est un succès, on prépare les lectures des utilisateurs
      if (interpretedStatus === 'success') {
        // B. Lecture de l'utilisateur principal
        userRef = db.collection('users').doc(txData.userId);
        const userDoc = await transaction.get(userRef);
        if (userDoc.exists) {
          currentBalance = userDoc.data().balance || 0;
        }

        // C. Lecture du client de la boutique (si applicable)
        if (txData.storeId && txData.email) {
          storeCustomerRef = db.collection('stores').doc(txData.storeId).collection('customers').doc(txData.email);
          const storeCustomerDoc = await transaction.get(storeCustomerRef);
          if (storeCustomerDoc.exists) {
            currentStoreBalance = storeCustomerDoc.data().balance || 0;
          }
        }
      }

      // --- PHASE D'ÉCRITURE (UPDATE / SET) ---
      
      if (interpretedStatus === 'success') {
        // A. Mise à jour de l'utilisateur principal
        const newBalance = currentBalance + Number(txData.amountXAF);
        transaction.update(userRef, { balance: newBalance });

        // B. Mise à jour du client de la boutique
        if (storeCustomerRef) {
          const newStoreBalance = currentStoreBalance + Number(txData.amountXAF);
          transaction.set(storeCustomerRef, { balance: newStoreBalance }, { merge: true });
        }
        
        // C. Mise à jour de la transaction
        transaction.update(txRef, {
          status: 'completed',
          verifiedBy: 'api_direct_check_success',
          paidAt: new Date().toISOString()
        });
        
        console.log(`💰 SUCCÈS : Utilisateur ${txData.userId} crédité !`);
        return { finalStatus: 'success', message: 'Solde mis à jour avec succès' };
      } 
      
      else if (interpretedStatus === 'failed') {
        // Écriture pour un paiement échoué
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
    // On renvoie l'erreur détaillée pour faciliter le débogage si besoin
    return res.status(500).json({ error: error.message, finalStatus: 'error' });
  }
};
        
