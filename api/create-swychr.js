const { db } = require('./_firebase');

module.exports = async function handler(req, res) {
  // 1. === DÉBUT DES RÈGLES DE SÉCURITÉ CORS ===
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  // === FIN DES RÈGLES DE SÉCURITÉ ===

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Méthode non autorisée' });
  }

  try {
    // MODIFICATION ICI : Ajout de storeId pour l'extraction des données
    const { email, userId, username, country, phone, amount, amountXAF, currency, storeId } = req.body;

    // 3. Authentification auprès de Swychr
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

    // 4. Génération d'un ID de transaction unique et incrémenté
    const counterRef = db.collection('counters').doc('transactions');
    
    const transactionId = await db.runTransaction(async (transaction) => {
      const counterDoc = await transaction.get(counterRef);
      let currentCount = 0;
      
      if (counterDoc.exists) {
        currentCount = counterDoc.data().count || 0;
      }
      
      const nextCount = currentCount + 1;
      transaction.set(counterRef, { count: nextCount }, { merge: true });
      
      return `SBH-PAY-${nextCount}`;
    });

    const host = req.headers.host || 'socialboosthorizon.com';
    const baseUrl = `https://${host}`;

    // 5. Création de la transaction dans la base de données avec le storeId
    await db.collection('transactions').doc(transactionId).set({
      userId: userId,
      username: username || 'Client',
      email: email,
      phone: phone || '',
      country: country,
      amount: amount,
      amountXAF: amountXAF,
      currency: currency,
      storeId: storeId || null, // MODIFICATION ICI : On enregistre la boutique
      status: 'pending',
      type: 'Recharge',
      label: `Recharge Swychr (${currency})`,
      createdAt: new Date()
    });

    // 6. Initialisation du paiement avec le partenaire Swychr
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

    // 7. Retour du lien de paiement au frontend
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