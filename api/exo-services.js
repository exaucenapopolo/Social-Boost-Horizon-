// api/exo-services.js

export default async function handler(req, res) {
    // On n'accepte que les requêtes de type GET pour lire les services
    if (req.method !== 'GET') {
        return res.status(405).json({ success: false, error: 'Méthode non autorisée' });
    }

    try {
        // 1. Préparation de la requête vers Exo Supplier
        const url = 'https://exosupplier.com/api/v2';
        const formData = new URLSearchParams();
        
        // Vercel lira ta clé API secrète (nous configurerons cela à l'étape 3)
        formData.append('key', process.env.EXO_API_KEY); 
        formData.append('action', 'services');

        // 2. Appel à l'API d'Exo
        const response = await fetch(url, {
            method: 'POST', // Exo demande un POST même pour lire les services
            body: formData,
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
        });

        const services = await response.json();

        // 3. Préparation de la structure attendue par ton frontend
        const platforms = {
            tiktok: [], instagram: [], facebook: [], youtube: [],
            telegram: [], twitter: [], whatsapp: [], spotify: [],
            linkedin: [], threads: [], snapchat: [], pinterest: [],
            discord: [], twitch: [], soundcloud: [], other: []
        };

        // Configuration financière (Modifie ces valeurs selon tes besoins)
        const EXCHANGE_RATE_USD_TO_XAF = 620; // Taux de change approximatif
        const PROFIT_MULTIPLIER = 1.5; // Marge bénéficiaire (1.5 = +50% de bénéfice)

        // 4. Tri des services et conversion des prix
        services.forEach(service => {
            const name = service.name.toLowerCase();
            const category = service.category.toLowerCase();
            let platformName = 'other';

            // Détection automatique de la plateforme selon le nom du service
            if (name.includes('tiktok') || category.includes('tiktok')) platformName = 'tiktok';
            else if (name.includes('instagram') || category.includes('instagram') || name.includes('ig ')) platformName = 'instagram';
            else if (name.includes('facebook') || category.includes('facebook') || name.includes('fb ')) platformName = 'facebook';
            else if (name.includes('youtube') || category.includes('youtube') || name.includes('yt ')) platformName = 'youtube';
            else if (name.includes('telegram') || category.includes('telegram')) platformName = 'telegram';
            else if (name.includes('twitter') || category.includes('twitter') || name.includes(' x ')) platformName = 'twitter';
            else if (name.includes('spotify') || category.includes('spotify')) platformName = 'spotify';

            // Calcul du prix final en FCFA
            const basePriceXAF = parseFloat(service.rate) * EXCHANGE_RATE_USD_TO_XAF;
            const finalPriceXAF = Math.round(basePriceXAF * PROFIT_MULTIPLIER);

            platforms[platformName].push({
                id: service.service,
                name: service.name,
                priceXAF: finalPriceXAF,
                min: parseInt(service.min),
                max: parseInt(service.max),
                isPackage: service.type === 'Package',
                isPerOne: false,
                isCustomComments: service.type === 'Custom Comments',
                averageTime: 'Rapide' 
            });
        });

        // 5. Envoi des données formatées à ton site
        return res.status(200).json({ success: true, platforms });

    } catch (error) {
        console.error("Erreur lors du chargement des services:", error);
        return res.status(500).json({ success: false, error: 'Erreur serveur lors du chargement des services' });
    }
}