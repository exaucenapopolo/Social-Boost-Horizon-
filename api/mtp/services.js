export default async function handler(req, res) {
    // On n'accepte que les requêtes GET pour cette route
    if (req.method !== 'GET') {
        return res.status(405).json({ success: false, error: 'Méthode non autorisée' });
    }

    try {
        const MTP_API_KEY = process.env.MORETHANPANEL_API_KEY;
        const MTP_API_URL = 'https://morethanpanel.com/api/v2';
        
        // Taux de conversion et marge (ajustables via Vercel ou directement ici)
        const RATE_USD_TO_XAF = parseFloat(process.env.RATE_USD_TO_XAF || '650');
        const MARGIN_MULTIPLIER = parseFloat(process.env.MARGIN_MULTIPLIER || '2.0'); // 2.0 = 100% de bénéfice

        // Récupération des services depuis MoreThanPanel
        const response = await fetch(`${MTP_API_URL}?key=${MTP_API_KEY}&action=services`);
        const data = await response.json();

        if (!Array.isArray(data)) {
            throw new Error('Réponse invalide du fournisseur MTP');
        }

        // Formatage des services pour ton frontend
        const formattedServices = data.map(service => {
            const originalPrice = parseFloat(service.rate);
            const finalPriceXAF = Math.round(originalPrice * RATE_USD_TO_XAF * MARGIN_MULTIPLIER);

            return {
                id: parseInt(service.service),
                name: service.name,
                category: service.category,
                priceXAF: finalPriceXAF,
                min: parseInt(service.min),
                max: parseInt(service.max),
                refill: service.refill === true || service.refill === '1',
                type: service.type,
                desc: service.description || ''
            };
        });

        res.status(200).json({ success: true, services: formattedServices });

    } catch (error) {
        console.error('Erreur fetch MTP services:', error);
        res.status(500).json({ success: false, error: 'Erreur lors de la récupération des services' });
    }
}
