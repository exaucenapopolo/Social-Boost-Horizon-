// api/exo-services.js

export default async function handler(req, res) {
  // On n'accepte que les requêtes GET
  if (req.method !== 'GET') {
    return res.status(405).json({ success: false, error: 'Méthode non autorisée' });
  }

  try {
    // 1. Préparation de la requête vers Exo Supplier
    const url = 'https://exosupplier.com/api/v2';
    const formData = new URLSearchParams();

    const apiKey = process.env.EXO_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ success: false, error: 'EXO_API_KEY manquante' });
    }

    formData.append('key', apiKey);
    formData.append('action', 'services');

    // 2. Appel à l'API d'Exo
    const response = await fetch(url, {
      method: 'POST',
      body: formData,
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
    });

    if (!response.ok) {
      return res.status(500).json({
        success: false,
        error: `Erreur API Exo: HTTP ${response.status}`
      });
    }

    const rawData = await response.json();

    // L'API peut renvoyer soit un tableau direct, soit un objet contenant services
    const services = Array.isArray(rawData)
      ? rawData
      : Array.isArray(rawData?.services)
        ? rawData.services
        : [];

    if (!Array.isArray(services) || services.length === 0) {
      return res.status(500).json({
        success: false,
        error: 'Réponse Exo invalide ou vide'
      });
    }

    // 3. Préparation de la structure attendue par ton frontend
    const platforms = {
      tiktok: [],
      instagram: [],
      facebook: [],
      youtube: [],
      telegram: [],
      twitter: [],
      whatsapp: [],
      spotify: [],
      linkedin: [],
      threads: [],
      snapchat: [],
      pinterest: [],
      discord: [],
      twitch: [],
      soundcloud: [],
      other: []
    };

    // Réglages financiers
    // Si service.rate est déjà en FCFA, la détection automatique évite de le reconvertir.
    const EXCHANGE_RATE_USD_TO_XAF = Number(process.env.EXO_USD_TO_XAF) || 650;

    // 2.51 = environ +151% de marge sur le coût fournisseur
    // Exemple: 39 FCFA -> 98 FCFA
    const PROFIT_MULTIPLIER = Number(process.env.EXO_PROFIT_MULTIPLIER) || 2.51;

    function detectPlatformName(name = '', category = '') {
      const n = String(name).toLowerCase();
      const c = String(category).toLowerCase();

      if (n.includes('tiktok') || c.includes('tiktok')) return 'tiktok';
      if (n.includes('instagram') || c.includes('instagram') || n.includes('ig ')) return 'instagram';
      if (n.includes('facebook') || c.includes('facebook') || n.includes('fb ')) return 'facebook';
      if (n.includes('youtube') || c.includes('youtube') || n.includes('yt ')) return 'youtube';
      if (n.includes('telegram') || c.includes('telegram')) return 'telegram';
      if (n.includes('twitter') || c.includes('twitter') || n.includes(' x ')) return 'twitter';
      if (n.includes('whatsapp') || c.includes('whatsapp')) return 'whatsapp';
      if (n.includes('spotify') || c.includes('spotify')) return 'spotify';
      if (n.includes('linkedin') || c.includes('linkedin')) return 'linkedin';
      if (n.includes('threads') || c.includes('threads')) return 'threads';
      if (n.includes('snapchat') || c.includes('snapchat')) return 'snapchat';
      if (n.includes('pinterest') || c.includes('pinterest')) return 'pinterest';
      if (n.includes('discord') || c.includes('discord')) return 'discord';
      if (n.includes('twitch') || c.includes('twitch')) return 'twitch';
      if (n.includes('soundcloud') || c.includes('soundcloud')) return 'soundcloud';

      return 'other';
    }

    function getBaseCostXAF(rate) {
      const numericRate = Number(rate) || 0;

      // Si le rate est petit, on suppose qu'il est en USD et on le convertit.
      // Si le rate est déjà un prix crédible en FCFA (ex: 39, 56, 120), on le garde tel quel.
      if (numericRate > 0 && numericRate < 10) {
        return numericRate * EXCHANGE_RATE_USD_TO_XAF;
      }

      return numericRate;
    }

    // 4. Tri des services et conversion des prix
    services.forEach((service) => {
      const name = String(service?.name || '');
      const category = String(service?.category || '');
      const type = String(service?.type || '').toLowerCase();

      const platformName = detectPlatformName(name, category);

      const rawRate = Number(service?.rate) || 0;
      const basePriceXAF = Math.round(getBaseCostXAF(rawRate));
      const finalPriceXAF = Math.round(basePriceXAF * PROFIT_MULTIPLIER);
      const profitXAF = finalPriceXAF - basePriceXAF;
      const profitMargin = finalPriceXAF > 0
        ? Math.round((profitXAF / finalPriceXAF) * 100)
        : 0;

      platforms[platformName].push({
        id: service?.service ? String(service.service) : '',
        name,
        priceXAF: finalPriceXAF,
        providerCostXAF: basePriceXAF,
        profitXAF,
        profitMargin,
        min: parseInt(service?.min, 10) || 1,
        max: parseInt(service?.max, 10) || 1000000,
        isPackage: type.includes('package'),
        isPerOne: type.includes('per 1') || type.includes('per one') || type.includes('per unit'),
        isCustomComments: type.includes('custom comments'),
        averageTime: 'Rapide'
      });
    });

    // 5. Envoi des données formatées à ton site
    return res.status(200).json({
      success: true,
      platforms
    });

  } catch (error) {
    console.error('Erreur lors du chargement des services:', error);
    return res.status(500).json({
      success: false,
      error: 'Erreur serveur lors du chargement des services'
    });
  }
        }
