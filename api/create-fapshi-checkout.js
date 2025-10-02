// netlify/functions/create-fapshi-checkout.js
// Node 18+ (Netlify) - serverless function
// Combines robust Fapshi payload + timeout + Firestore transaction logging + Firebase token verification

const fetch = globalThis.fetch || ((...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args)));
const admin = require('firebase-admin');

let firebaseInitialized = false;

function initFirebaseAdminFromServiceAccountBase64(base64) {
  try {
    const svcJson = JSON.parse(Buffer.from(base64, 'base64').toString('utf8'));
    if (!admin.apps.length) {
      admin.initializeApp({
        credential: admin.credential.cert(svcJson)
      });
    }
    firebaseInitialized = true;
    console.log('✅ Firebase admin initialized from BASE64.');
  } catch (err) {
    console.error('❌ Failed to init Firebase from BASE64:', err.message);
    throw err;
  }
}

function initFirebaseAdminFromEnvVars() {
  try {
    // FIREBASE_PRIVATE_KEY often contains \n sequences; convert them
    const projectId = process.env.FIREBASE_PROJECT_ID;
    const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
    let privateKey = process.env.FIREBASE_PRIVATE_KEY;

    if (!projectId || !clientEmail || !privateKey) {
      throw new Error('Missing FIREBASE_PROJECT_ID or FIREBASE_CLIENT_EMAIL or FIREBASE_PRIVATE_KEY');
    }

    // If key was pasted with escaped newlines, fix them
    privateKey = privateKey.includes('\\n') ? privateKey.replace(/\\n/g, '\n') : privateKey;

    if (!admin.apps.length) {
      admin.initializeApp({
        credential: admin.credential.cert({
          projectId,
          clientEmail,
          privateKey
        })
      });
    }
    firebaseInitialized = true;
    console.log('✅ Firebase admin initialized from ENV VARS.');
  } catch (err) {
    console.error('❌ Failed to init Firebase from ENV VARS:', err.message);
    throw err;
  }
}

function ensureFirebaseInitialized() {
  if (firebaseInitialized) return;

  const base64 = process.env.FIREBASE_SERVICE_ACCOUNT_BASE64;
  if (base64) {
    initFirebaseAdminFromServiceAccountBase64(base64);
    return;
  }

  // Try env var form
  if (process.env.FIREBASE_PROJECT_ID && process.env.FIREBASE_CLIENT_EMAIL && process.env.FIREBASE_PRIVATE_KEY) {
    initFirebaseAdminFromEnvVars();
    return;
  }

  // No Firebase credentials — we won't init admin; some flows may still work but token verification will be skipped.
  console.warn('⚠️ Firebase admin not initialized: no service account provided (BASE64 or ENV VARS). Token verification will be skipped.');
  firebaseInitialized = false; // explicit
}

// Helper: safe JSON parse
function tryParseJson(text) {
  try { return JSON.parse(text); } catch (e) { return null; }
}

exports.handler = async (event, context) => {
  try {
    if (event.httpMethod !== 'POST') {
      return { statusCode: 405, body: JSON.stringify({ error: 'Method Not Allowed. Use POST only' }) };
    }

    // parse body (Netlify sometimes passes body as string)
    let body;
    try {
      body = typeof event.body === 'string' ? JSON.parse(event.body) : event.body;
    } catch (err) {
      console.error('Invalid JSON body:', err.message);
      return { statusCode: 400, body: JSON.stringify({ error: 'Invalid JSON body' }) };
    }

    // Basic validation
    const { amount, currency = 'XAF', description, redirectUrl, externalId } = body || {};
    if (!amount || !redirectUrl || !externalId) {
      console.error('Missing parameters:', { amount, redirectUrl, externalId });
      return { statusCode: 400, body: JSON.stringify({ error: 'Paramètres manquants: amount, redirectUrl ou externalId' }) };
    }

    // Init Firebase admin if possible (for token verification + Firestore writes)
    try {
      ensureFirebaseInitialized();
    } catch (initErr) {
      console.error('Firebase init error (continuing without admin):', initErr.message);
    }

    // If auth token provided in header and admin initialized, verify it
    const authHeader = (event.headers && (event.headers.authorization || event.headers.Authorization)) || '';
    let uidFromToken = null;
    if (authHeader && authHeader.startsWith('Bearer ') && admin.apps.length) {
      const idToken = authHeader.split(' ')[1];
      try {
        const decoded = await admin.auth().verifyIdToken(idToken);
        uidFromToken = decoded.uid;
        console.log('Token verified, uid =', uidFromToken);
      } catch (err) {
        console.warn('Invalid Firebase token:', err.message);
        return { statusCode: 401, body: JSON.stringify({ error: 'Token Firebase invalide' }) };
      }
    }

    // Validate env vars for Fapshi (support multiple names)
    const API_USER = process.env.FAPSHI_API_USER || process.env.FAPSHI_APIUSER || process.env.FAPSHI_API;
    const SECRET_KEY = process.env.FAPSHI_API_KEY || process.env.FAPSHI_SECRET_KEY || process.env.FAPSHI_SECRET;
    const WEBHOOK_URL = process.env.FAPSHI_WEBHOOK_URL || process.env.FAPSHI_WEBHOOK;
    const ENV = (process.env.FAPSHI_ENV || process.env.NODE_ENV || '').toLowerCase();

    if (!API_USER || !SECRET_KEY) {
      console.error('Fapshi env vars missing', { hasApiUser: !!API_USER, hasSecret: !!SECRET_KEY, hasWebhook: !!WEBHOOK_URL });
      return { statusCode: 500, body: JSON.stringify({ error: 'Configuration serveur Fapshi incomplète' }) };
    }

    // Build payload according to the other project's structure
    const payload = {
      amount: Math.round(amount),
      currency,
      description: description || 'Paiement MADIL',
      redirect_url: redirectUrl,
      webhook_url: WEBHOOK_URL || undefined,
      metadata: { userId: externalId, uidFromToken } // useful for webhook reconciliation
    };

    // Fapshi endpoint selection (adjust if your provider docs differ)
    const fapshiUrl = (ENV === 'production' || process.env.FAPSHI_LIVE === 'true')
      ? 'https://live.fapshi.com/initiate-pay'
      : (process.env.FAPSHI_SANDBOX_URL || 'https://sandbox.fapshi.com/initiate-pay');

    console.log('Calling Fapshi', { fapshiUrl, amount: payload.amount, currency: payload.currency, externalId });

    const controller = new AbortController();
    const timeoutMs = parseInt(process.env.FAPSHI_TIMEOUT_MS || '10000', 10); // default 10s
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const fapshiResp = await fetch(fapshiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apiuser': API_USER,
          'apikey': SECRET_KEY
        },
        body: JSON.stringify(payload),
        signal: controller.signal
      });

      const rawText = await fapshiResp.text();
      const respJson = tryParseJson(rawText);

      console.log('Fapshi response status:', fapshiResp.status);
      // don't log secrets - rawText can be ok for debugging but avoid logging API keys
      console.log('Fapshi response body (truncated):', (typeof rawText === 'string' && rawText.length > 1000) ? rawText.slice(0,1000) + '... (truncated)' : rawText);

      if (!fapshiResp.ok) {
        // return the provider response to client for debugging (status + body)
        return {
          statusCode: fapshiResp.status === 200 ? 500 : fapshiResp.status,
          body: JSON.stringify({
            error: 'Erreur Fapshi',
            fapshiStatus: fapshiResp.status,
            fapshiBody: respJson || rawText
          })
        };
      }

      // Extract checkout URL from various possible shapes
      const checkoutUrl = respJson?.data?.url || respJson?.link || respJson?.checkoutUrl || respJson?.url;
      const fapshiTransId = respJson?.transId || respJson?.transactionId || respJson?.data?.transId || null;

      if (!checkoutUrl) {
        console.error('Fapshi returned success but no checkout URL', respJson || rawText);
        return {
          statusCode: 502,
          body: JSON.stringify({ error: 'Réponse du processeur incomplète: URL de paiement manquante', details: respJson || rawText })
        };
      }

      // Record transaction in Firestore if admin initialized
      try {
        if (admin.apps.length) {
          const db = admin.firestore();
          const transactionsRef = db.collection('fapshiTransactions');
          const transactionDocId = fapshiTransId || (Math.random().toString(36).slice(2, 12) + Math.random().toString(36).slice(2, 12));

          await transactionsRef.doc(transactionDocId).set({
            fapshiTransId: fapshiTransId,
            userId: externalId,
            uidFromToken: uidFromToken || null,
            amount: payload.amount,
            currency: payload.currency,
            status: 'PENDING',
            dateInitiated: admin.firestore.FieldValue.serverTimestamp(),
            checkoutUrl
          });

          console.log(`✅ Transaction recorded: ${transactionDocId}`);
        } else {
          console.warn('Firestore not initialized — skipping transaction record');
        }
      } catch (dbErr) {
        console.error('Failed to write transaction to Firestore:', dbErr.message);
        // continue: we still return checkoutUrl even if DB write failed
      }

      return {
        statusCode: 200,
        body: JSON.stringify({
          checkoutUrl,
          transId: fapshiTransId || null,
          raw: respJson || rawText
        })
      };

    } catch (err) {
      if (err.name === 'AbortError') {
        console.error('Fapshi API timeout');
        return { statusCode: 504, body: JSON.stringify({ error: 'Timeout lors de la connexion à Fapshi' }) };
      }
      console.error('Error while calling Fapshi:', err.stack || err.message);
      return { statusCode: 500, body: JSON.stringify({ error: 'Erreur interne lors de la communication avec Fapshi' }) };
    } finally {
      clearTimeout(timeout);
    }

  } catch (err) {
    console.error('Unhandled error in create-fapshi-checkout:', err.stack || err.message);
    return { statusCode: 500, body: JSON.stringify({ error: 'Erreur serveur interne' }) };
  }
};
