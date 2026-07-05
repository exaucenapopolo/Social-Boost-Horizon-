const { db } = require('./_firebase');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Méthode non autorisée' });
  }

  try {
    const { email, userId, username, country, phone, amount, amountXAF, currency } = req.body;

    // 1. Authentification auprès de Swychr
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
      throw new Error('Échec de l\'authentification Swychr');
    }

    // 2. NOUVEAU SYSTÈME : Génération d'un ID de transaction unique et incrémenté
    // Nous ciblons le document 'transactions' dans la collection 'counters'
    const counterRef = db.collection('counters').doc('transactions');
    
    const transactionId = await db.runTransaction(async (transaction) => {
      // On récupère l'état actuel du compteur
      const counterDoc = await transaction.get(counterRef);
      let currentCount = 0;
      
      // Si le compteur existe déjà, on prend sa valeur
      if (counterDoc.exists) {
        currentCount = counterDoc.data().count || 0;
      }
      
      // On incrémente de +1
      const nextCount = currentCount + 1;
      
      // On sauvegarde la nouvelle valeur dans la base de données
      transaction.set(counterRef, { count: nextCount }, { merge: true });
      
      // On retourne le format désiré, par exemple : SBH-PAY-3988
      return `SBH-PAY-${nextCount}`;
    });

    const baseUrl = `https://${req.headers.host}`;

    // 3. Création de la transaction dans ta base de données avec le nouvel ID
    await db.collection('transactions').doc(transactionId).set({
      userId: userId,
      amountXAF: amountXAF,
      status: 'pending',
      createdAt: new Date().toISOString()
    });

    // 4. Initialisation du paiement avec le partenaire Swychr
    const paymentRes = await fetch('https://api.accountpe.com/api/payin/create_payment_links', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${authData.token}`,
        'Idempotency-Key': transactionId
      },
      body: JSON.stringify({
        country_code: country,
        name: username || 'Client',
        email: email,
        mobile: phone || '',
        amount: amount,
        currency: currency,
        transaction_id: transactionId,
        description: 'Recharge Solde Social Boost Horizon',
        pass_digital_charge: true,
        callback_url: `${baseUrl}/api/webhook-swychr`
      })
    });

    const paymentData = await paymentRes.json();

    // 5. Retour du lien de paiement au frontend
    if (paymentData.status === 200 || paymentData.status === 201) {
      return res.status(200).json({
        success: true,
        checkoutUrl: paymentData.data.payment_link,
        transactionId: transactionId
      });
    } else {
      throw new Error(paymentData.message || 'Erreur API Swychr');
    }
  } catch (error) {
    console.error('Erreur create-swychr:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
};
    
