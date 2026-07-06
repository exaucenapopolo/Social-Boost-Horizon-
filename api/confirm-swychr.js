const { db, admin } = require('./_firebase');

module.exports = async function handler(req, res) {
  // Autoriser la page web à appeler ce code
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
    // 1. DICTIONNAIRES MULTI-LANGUES DE STATUTS
    // Peu importe comment le partenaire écrit le statut, on le reconnaitra !
    const statusSucces = ["success", "completed", "terminé", "succès", "reussi", "1", "successful", "paid"];
    const statusEchec = ["failed", "echec", "annulé", "cancelled", "rejected", "rejeté", "-1", "error"];
    const statusEnCours = ["pending", "en cours", "attente", "processing", "0"];

    // 2. RÉCUPÉRATION DU STATUT (Simulation ou appel réel)
    // Idéalement, ici on ferait un fetch vers l'API du partenaire (ex: AccountPe).
    // Comme on n'a pas leur URL exacte, on lit l'état actuel enregistré dans notre base.
    // Si tu as leur URL, tu pourras l'insérer ici à l'avenir.
    
    // Pour l'instant, on lit la transaction dans NOTRE base :
    const txRef = db.collection('transactions').doc(transactionId);
    
    // 3. SÉCURITÉ ABSOLUE : Verrouillage de la transaction avec runTransaction
    // runTransaction assure que si 10 personnes cliquent en même temps, le code s'exécute 1 par 1.
    const result = await db.runTransaction(async (transaction) => {
      const txDoc = await transaction.get(txRef);

      if (!txDoc.exists) {
        throw new Error("Transaction introuvable");
      }

      const txData = txDoc.data();
      const rawStatus = txData.status ? txData.status.toString().toLowerCase() : "pending";

      // Analyse du statut avec nos dictionnaires
      let interpretedStatus = "pending"; 
      
      if (statusSucces.includes(rawStatus)) {
        interpretedStatus = "success";
      } else if (statusEchec.includes(rawStatus)) {
        interpretedStatus = "failed";
      }

      // VÉRIFICATION ANTI-DOUBLE PAIEMENT
      // Si c'est déjà marqué 'completed' dans notre DB, on ne touche plus à l'argent !
      if (txData.status === 'completed') {
        return { finalStatus: 'success', message: 'Déjà crédité' };
      }

      // Si le statut interprété est un VRAI succès non crédité, ON CRÉDITE ICI
      if (interpretedStatus === 'success') {
        const userRef = db.collection('users').doc(txData.userId);
        
        // On met à jour l'utilisateur
        transaction.update(userRef, {
          balance: admin.firestore.FieldValue.increment(txData.amountXAF)
        });
        
        // On verrouille la transaction pour l'avenir
        transaction.update(txRef, {
          status: 'completed',
          verifiedBy: 'manual_button',
          paidAt: new Date().toISOString()
        });

        return { finalStatus: 'success', message: 'Solde mis à jour avec succès' };
      }

      // Sinon, on renvoie l'état actuel sans toucher à l'argent
      return { finalStatus: interpretedStatus, message: 'Vérification terminée' };
    });

    // On renvoie le résultat au front-end
    return res.status(200).json(result);

  } catch (error) {
    console.error('Erreur lors de la vérification manuelle:', error);
    return res.status(500).json({ error: error.message, finalStatus: 'error' });
  }
};
      
