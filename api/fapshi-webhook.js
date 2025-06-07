const admin = require('firebase-admin');
const crypto = require('crypto');

module.exports = async (req, res) => {
  // Log pour indiquer le début de la requête
  console.log('>>> Fapshi Webhook received.');
  console.log('>>> Request Method:', req.method);
  console.log('>>> Request Headers:', req.headers);

  if (req.method !== 'POST') {
    console.warn('>>> Method Not Allowed. Expected POST, got', req.method);
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  // Initialisation Firebase
  if (!admin.apps.length) {
    console.log(">>> Checking FIREBASE_PROJECT_ID:", process.env.FIREBASE_PROJECT_ID);
    console.log(">>> Checking FIREBASE_CLIENT_EMAIL:", process.env.FIREBASE_CLIENT_EMAIL);

    const firebasePrivateKey = process.env.FIREBASE_PRIVATE_KEY;

    if (!firebasePrivateKey) {
      console.error("❌ ERREUR: FIREBASE_PRIVATE_KEY n'est pas définie dans l'environnement.");
      return res.status(500).json({ error: 'Clé privée Firebase non configurée.' });
    }

    // Ajout de logs pour vérifier la clé PEM directement
    console.log(">>> Firebase Private Key (Length):", firebasePrivateKey.length);
    console.log(">>> Firebase Private Key (Start):", firebasePrivateKey.substring(0, 50));
    console.log(">>> Firebase Private Key (End):", firebasePrivateKey.substring(firebasePrivateKey.length - 50));

    // La vérification de fin de ligne est un peu tricky, mais c'est un bon indicateur
    const isPemFormattedCheck = firebasePrivateKey.startsWith('-----BEGIN PRIVATE KEY-----') &&
                                firebasePrivateKey.endsWith('-----END PRIVATE KEY-----') &&
                                firebasePrivateKey.includes('\n'); // Vérifie au moins un saut de ligne

    if (isPemFormattedCheck) {
        console.log(">>> Key APPEARS to be in correct PEM format.");
    } else {
        console.warn(">>> Key MIGHT NOT be in correct PEM format. Check headers/footers or missing newlines.");
    }

    try {
        admin.initializeApp({
            credential: admin.credential.cert({
                projectId: process.env.FIREBASE_PROJECT_ID,
                clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
                privateKey: firebasePrivateKey
            }),
        });
        console.log("✅ Firebase initialized successfully.");
    } catch (firebaseInitError) {
        console.error("❌ Firebase initialization failed:", firebaseInitError.message);
        console.error("Firebase error details:", firebaseInitError.errorInfo);
        // Retourne une erreur 500 pour indiquer que le webhook n'a pas pu traiter la requête
        return res.status(500).json({ error: 'Échec de l\'initialisation de Firebase.', details: firebaseInitError.message });
    }
  } else {
    console.log("✅ Firebase already initialized.");
  }

  // >>>>>>>>>>>>>>>>>>>>>>>>>>> ATTENTION : DÉSACTIVATION DE LA VÉRIFICATION DE SIGNATURE <<<<<<<<<<<<<<<<<<<<<<<<<
  // Cette section est commentée car Fapshi ne semble pas fournir de Webhook Secret dans ton interface.
  // Cela rend ton webhook VULNÉRABLE. N'UTILISE CECI QUE POUR LE DÉPANNAGE et réactive une protection ASAP.
  /*
  const fapshiSignature = req.headers['x-fapshi-signature'];
  console.log('>>> X-Fapshi-Signature Header:', fapshiSignature);

  if (!fapshiSignature) {
    console.warn('>>> Missing X-Fapshi-Signature header.');
    return res.status(400).json({ error: 'Signature Fapshi manquante.' });
  }

  let rawBody;
  try {
      rawBody = JSON.stringify(req.body);
      if (rawBody === '{}' && Object.keys(req.body).length === 0) {
          console.error('❌ Request body is empty, cannot verify signature.');
          return res.status(400).json({ error: 'Corps de requête vide.' });
      }
  } catch (jsonError) {
      console.error('❌ Error stringifying request body:', jsonError.message);
      return res.status(400).json({ error: 'Corps de requête JSON invalide.' });
  }

  try {
    // Note: FAPSHI_WEBHOOK_SECRET doit toujours être défini même si on ne l'utilise pas ici,
    // pour éviter des erreurs si la ligne hmac.createHmac n'était pas commentée.
    const hmac = crypto.createHmac('sha256', process.env.FAPSHI_WEBHOOK_SECRET);
    hmac.update(rawBody);
    const expectedSignature = hmac.digest('hex');

    console.log('>>> Raw Body (for signature check):', rawBody);
    console.log('>>> Expected Signature:', expectedSignature);

    if (expectedSignature !== fapshiSignature) {
      console.error('❌ Invalid Fapshi signature. Expected:', expectedSignature, 'Got:', fapshiSignature);
      return res.status(403).json({ error: 'Signature Fapshi invalide.' });
    }
    console.log('✅ Fapshi signature verified.');
  } catch (signatureError) {
    console.error('❌ Error verifying Fapshi signature:', signatureError.message);
    return res.status(500).json({ error: 'Erreur lors de la vérification de la signature Fapshi.', details: signatureError.message });
  }
  */
  // >>>>>>>>>>>>>>>>>>>>>>>>>>> FIN DE LA VÉRIFICATION DE SIGNATURE COMMENTÉE <<<<<<<<<<<<<<<<<<<<<<<<<

  console.warn('⚠️ WARNING: Fapshi signature verification is DISABLED for testing purposes. Re-enable for production!');

  // Traitement du webhook
  const { transaction } = req.body;
  if (!transaction || transaction.status !== 'successful') {
    console.warn('>>> Transaction not successful or missing transaction object.');
    return res.status(200).json({ message: 'Ignoring non-successful transaction.' });
  }

  const userId = transaction.customer_id; // Ou toute autre propriété pertinente de la transaction
  const amount = parseFloat(transaction.amount); // Convertir le montant en nombre

  if (!userId || isNaN(amount)) {
    console.error('❌ Invalid user ID or amount in transaction data.');
    return res.status(400).json({ error: 'Données de transaction invalides.' });
  }

  const db = admin.firestore();
  const userRef = db.collection('users').doc(userId);

  try {
    await db.runTransaction(async (t) => {
      const userDoc = await t.get(userRef);

      if (!userDoc.exists) {
        console.warn(`>>> User ${userId} not found in Firestore. Creating new user with initial balance.`);
        t.set(userRef, { balance: amount });
      } else {
        const currentBalance = userDoc.data().balance || 0;
        const newBalance = currentBalance + amount;
        t.update(userRef, { balance: newBalance });
        console.log(`>>> Updated balance for user ${userId}: ${currentBalance} -> ${newBalance}`);
      }
    });
    console.log(`✅ Transaction successful for user ${userId}. Balance updated by ${amount}.`);
    return res.status(200).json({ message: 'Webhook processed successfully.' });

  } catch (firestoreError) {
    console.error('❌ Firestore transaction failed:', firestoreError.message);
    console.error('Firestore error details:', firestoreError);
    return res.status(500).json({ error: 'Erreur lors de la mise à jour du solde Firebase.', details: firestoreError.message });
  }
};
