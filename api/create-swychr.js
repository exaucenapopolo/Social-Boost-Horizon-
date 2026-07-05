// Fichier : api/create-swychr.js
const { db } = require('./_firebase');

export default async function handler(req, res) {
  // Autoriser uniquement les requêtes POST
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Méthode non autorisée' });
  }

  try {
    const { email, userId, username, country, phone, amount, amountXAF, currency } = req.body;

    // 1. Authentification Swychr Connect
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

    // 2. Préparation de la transaction
    const transactionId = `txn_${Date.now()}_${userId}`;
    const baseUrl = `https://${req.headers.host}`; // Récupère ton URL Vercel automatiquement

    // Sauvegarde en attente dans Firestore (très important pour le webhook)
    await db.collection('transactions').doc(transactionId).set({
      userId: userId,
      amountXAF: amountXAF,
      status: 'pending',
      createdAt: new Date().toISOString()
    });

    // 3. Création du lien de paiement Swychr
    const paymentRes = await fetch('https://api.accountpe.com/api/payin/create_payment_links', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${authData.token}`,
        'Idempotency-Key': transactionId // Empêche les doublons
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
        callback_url: `${baseUrl}/api/webhook-swychr` // Swychr enverra la confirmation ici
      })
    });

    const paymentData = await paymentRes.json();

    if (paymentData.status === 200 || paymentData.status === 201) {
      return res.status(200).json({
        success: true,
        checkoutUrl: paymentData.data.payment_link,
        transactionId: transactionId
      });
    } else {
      throw new Error(paymentData.message || 'Erreur lors de la création du lien');
    }

  } catch (error) {
    console.error('Erreur create-swychr:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
}
