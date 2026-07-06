import admin from 'firebase-admin';

if (!admin.apps.length) {
    try {
        admin.initializeApp({
            credential: admin.credential.cert({
                projectId: process.env.FIREBASE_PROJECT_ID,
                clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
                // On remplace les balises de saut de ligne pour que la clé privée soit bien lue par Vercel
                privateKey: process.env.FIREBASE_PRIVATE_KEY ? process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n') : undefined,
            })
        });
    } catch (error) {
        console.error('Erreur lors de l\'initialisation de Firebase Admin:', error);
    }
}

const db = admin.firestore();
const auth = admin.auth();

export { db, auth };
