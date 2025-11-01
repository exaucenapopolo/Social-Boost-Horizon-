const admin = require('firebase-admin');
const crypto = require('crypto');

module.exports = async (req, res) => {
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

    console.log(">>> Firebase Private Key (Length):", firebasePrivateKey.length);
    console.log(">>> Firebase Private Key (Start):", firebasePrivateKey.substring(0, 50));
    console.log(">>> Firebase Private Key (End):", firebasePrivateKey.substring(firebasePrivateKey.length - 50));

    const isPemFormattedCheck = firebasePrivateKey.startsWith('-----BEGIN PRIVATE KEY-----') &&
                                firebasePrivateKey.endsWith('-----END PRIVATE KEY-----') &&
                                firebasePrivateKey.includes('\n');

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
        return res.status(500).json({ error: 'Échec de l\'initialisation de Firebase.', details: firebaseInitError.message });
    }
  } else {
    console.log("✅ Firebase already initialized.");
  }

  console.warn('⚠️ WARNING: Fapshi signature verification is DISABLED for testing purposes. Re-enable for production!');

  console.log('>>> Fapshi Webhook Body:', JSON.stringify(req.body, null, 2)); 

  const { status, amount, transId } = req.body;

  if (status !== 'SUCCESSFUL') {
    console.warn(`>>> Transaction status is "${status}". Ignoring non-successful transaction.`);
    return res.status(200).json({ message: 'Ignoring non-successful transaction.' });
  }

  if (!transId || isNaN(amount)) {
    console.error('❌ Invalid transaction ID or amount in webhook data. transId:', transId, 'Amount:', amount);
    return res.status(400).json({ error: 'Données de transaction webhook invalides (ID ou montant manquant/invalide).' });
  }

  const db = admin.firestore();
  const fapshiTransactionRef = db.collection('fapshiTransactions').doc(transId);

  let userIdentifier;
  try {
    const fapshiTransactionDoc = await fapshiTransactionRef.get();

    if (!fapshiTransactionDoc.exists) {
      console.error(`❌ Transaction Fapshi (${transId}) not found in our fapshiTransactions collection. Cannot link to user.`);
      return res.status(200).json({ message: 'Transaction Fapshi inconnue, ignorée.' });
    }

    const transactionData = fapshiTransactionDoc.data();
    userIdentifier = transactionData.userId;
    
    if (!userIdentifier) {
      console.error(`❌ userId missing in fapshiTransactions document for transId: ${transId}`);
      return res.status(500).json({ error: 'Impossible de trouver l\'ID utilisateur lié à cette transaction.' });
    }

    await fapshiTransactionRef.update({
      status: 'CONFIRMED',
      dateConfirmed: admin.firestore.FieldValue.serverTimestamp()
    });
    console.log(`✅ Status updated for fapshiTransaction ${transId} to CONFIRMED.`);

  } catch (lookupError) {
    console.error('❌ Error looking up fapshi transaction in Firestore:', lookupError.message);
    return res.status(500).json({ error: 'Erreur lors de la recherche de la transaction Fapshi.', details: lookupError.message });
  }

  const userRef = db.collection('users').doc(userIdentifier.toString()); 

  try {
    // ✅ ÉTAPE 1 : Mettre à jour le solde de l'utilisateur qui a payé
    await db.runTransaction(async (t) => {
      const userDoc = await t.get(userRef);

      if (!userDoc.exists) {
        console.warn(`>>> User ${userIdentifier} not found in Firestore (during balance update). Creating with initial balance.`);
        t.set(userRef, { balance: amount });
      } else {
        const currentBalance = userDoc.data().balance || 0;
        const newBalance = currentBalance + amount;
        t.update(userRef, { balance: newBalance });
        console.log(`>>> Updated balance for user ${userIdentifier}: ${currentBalance} -> ${newBalance}`);
      }
    });
    console.log(`✅ Transaction successful for user ${userIdentifier}. Balance updated by ${amount}.`);

    // ✅ ÉTAPE 2 : LOGIQUE DE BONUS PARRAINAGE (5%)
    console.log(`🎁 Checking for referral bonus for user ${userIdentifier}...`);
    
    const filleulDoc = await userRef.get();
    
    if (!filleulDoc.exists) {
      console.warn(`⚠️ User ${userIdentifier} document doesn't exist after balance update (unexpected).`);
      return res.status(200).json({ message: 'Webhook processed successfully (no referral check).' });
    }

    const filleulData = filleulDoc.data();
    const parrainUid = filleulData?.referredBy;

    if (parrainUid) {
      console.log(`🎯 User ${userIdentifier} has a referrer: ${parrainUid}`);
      
      // Calculer 5% du montant déposé
      const bonusParrain = Math.floor(amount * 0.05);
      
      console.log(`💰 Bonus calculation: ${amount} FCFA × 5% = ${bonusParrain} FCFA`);

      if (bonusParrain > 0) {
        const parrainRef = db.collection('users').doc(parrainUid);

        // Mettre à jour le referralBalance du parrain
        await parrainRef.set({
          referralBalance: admin.firestore.FieldValue.increment(bonusParrain)
        }, { merge: true });

        console.log(`✅ Added ${bonusParrain} FCFA to referralBalance of parrain ${parrainUid}`);

        // Enregistrer l'historique du bonus dans la sous-collection referrals du parrain
        await parrainRef.collection('referrals').add({
          refereeUid: userIdentifier,
          amount: amount,
          referrerShare: bonusParrain,
          type: 'deposit_bonus_fapshi',
          transactionId: transId,
          date: admin.firestore.FieldValue.serverTimestamp(),
          status: 'completed'
        });

        console.log(`📝 Referral bonus recorded in parrain's referrals collection`);

        // Optionnel : Incrémenter le compteur de filleuls si vous le souhaitez
        // await parrainRef.set({
        //   referralsCount: admin.firestore.FieldValue.increment(1)
        // }, { merge: true });

        console.log(`🎉 BONUS PARRAINAGE APPLIQUÉ: ${bonusParrain} FCFA → ${parrainUid}`);
      } else {
        console.log(`⚠️ Bonus amount is 0, skipping referral bonus.`);
      }
    } else {
      console.log(`ℹ️ User ${userIdentifier} has no referrer (referredBy is null or undefined).`);
    }

    return res.status(200).json({ 
      message: 'Webhook processed successfully.',
      bonusApplied: !!parrainUid && bonusParrain > 0
    });

  } catch (firestoreError) {
    console.error('❌ Firestore transaction failed:', firestoreError.message);
    console.error('Firestore error details:', firestoreError);
    return res.status(500).json({ error: 'Erreur lors de la mise à jour du solde Firebase.', details: firestoreError.message });
  }
};
