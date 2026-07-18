const { db, admin } = require('./_firebase');

module.exports = async function handler(req, res) {
  // En-têtes CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).send('Méthode non autorisée');
  }

  try {
    const payload = req.body;
    
    console.log('--- NOUVEAU WEBHOOK REÇU ---');
    console.log(JSON.stringify(payload, null, 2));

    const attributes = payload?.data?.data?.attributes || payload?.data?.attributes || payload;
    
    if (!attributes) {
      console.error('Payload invalide ou vide');
      return res.status(400).send('Payload invalide');
    }

    const { status, transaction_id } = attributes;
    
    // 1. ON NORMALISE LE STATUT REÇU (tout en minuscules, en chaîne de caractères)
    const rawStatus = status ? String(status).toLowerCase().trim() : "inconnu";
    console.log(`Transaction ID traitée: ${transaction_id}, Statut Brut reçu: ${rawStatus}`);

    // 2. DICTIONNAIRE DE SUCCÈS (On accepte toutes ces variations)
    const statusSucces = ["success", "completed", "terminé", "succès", "reussi", "1", "successful", "paid", "ok"];

    // 3. VÉRIFICATION
    if (statusSucces.includes(rawStatus)) { 
      const txRef = db.collection('transactions').doc(transaction_id);
      const txDoc = await txRef.get();

      if (txDoc.exists) {
        if (txDoc.data().status === 'pending') {
          const { userId, amountXAF } = txDoc.data();
          
          console.log(`Mise à jour du solde pour l'utilisateur ${userId} (+${amountXAF} XAF)`);

          // Met à jour le solde utilisateur
          await db.collection('users').doc(userId).update({
            balance: admin.firestore.FieldValue.increment(amountXAF)
          });

          // Marque la transaction comme complétée
          await txRef.update({
            status: 'completed',
            paidAt: new Date().toISOString()
          });
          
          console.log(`Transaction ${transaction_id} terminée avec succès.`);
        } else {
          console.log(`La transaction ${transaction_id} a déjà été traitée.`);
        }
      } else {
        console.error(`Document de transaction introuvable pour l'ID: ${transaction_id}`);
      }
    } else {
      console.log(`Statut ignoré par le webhook (pas un succès) : ${rawStatus}`);
    }
    
    return res.status(200).send('Webhook reçu et traité');
    
  } catch (error) {
    console.error('Erreur Critique Webhook:', error);
    return res.status(500).send('Erreur interne');
  }
};
            
