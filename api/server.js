const express = require('express');
const cors = require('cors');
const { v4: uuidv4 } = require('uuid'); // Pour générer des clés API uniques

const app = express();
const PORT = 3000;

// Middleware pour comprendre le JSON et autoriser les requêtes du navigateur
app.use(express.json());
app.use(cors());

// ==========================================
// 1. BASE DE DONNÉES SIMULÉE (Mock Database)
// ==========================================

// Simule les comptes utilisateurs et leurs clés API
let users = {
    'votre_cle_api_ici': { id: 1, name: 'Admin', balance: 15000, currency: 'XAF' }
};

// Simule le catalogue de services
const services = [
    { service_id: 1, name: "Instagram Followers", category: "Instagram", type: "default", price_per_1000: 5000, min: 100, max: 10000, refill: true, cancel: false, description: "Followers Instagram haute qualite", catalog: "standard" },
    { service_id: 2, name: "Instagram Likes", category: "Instagram", type: "default", price_per_1000: 2000, min: 50, max: 5000, refill: false, cancel: true, description: "Likes rapides", catalog: "premium" }
];

// Simule l'historique des commandes
let orders = [];

// ==========================================
// 2. MIDDLEWARE D'AUTHENTIFICATION
// ==========================================

// Cette fonction s'exécute avant chaque route de l'API pour vérifier la clé
const authenticateApiKey = (req, res, next) => {
    // On récupère la clé depuis le header X-Api-Key défini dans la documentation
    const apiKey = req.header('X-Api-Key'); 
    
    // Si la clé est manquante ou invalide, on renvoie une erreur 401
    if (!apiKey || !users[apiKey]) {
        return res.status(401).json({ 
            success: false, 
            error: "Cle API manquante ou invalide" 
        });
    }
    
    // On attache les données de l'utilisateur à la requête pour la suite
    req.user = users[apiKey];
    req.userKey = apiKey;
    next();
};

// ==========================================
// 3. ROUTES POUR LA GESTION DU PROFIL (Générer/Révoquer)
// ==========================================
// Ces routes seront appelées par ton fichier profil.html

// Générer une nouvelle clé API
app.post('/api/v1/profile/generate-key', (req, res) => {
    // Note : Dans un vrai système, l'utilisateur serait authentifié par session/mot de passe ici
    const newApiKey = `sbh_${uuidv4().replace(/-/g, '')}`; // Crée une clé sécurisée
    
    // On ajoute le nouvel utilisateur (simulation)
    users[newApiKey] = { id: Date.now(), name: 'Nouvel Utilisateur', balance: 0, currency: 'XAF' };
    
    res.json({ success: true, api_key: newApiKey });
});

// ==========================================
// 4. ENDPOINTS DE L'API PUBLIQUE
// ==========================================

// Toutes les routes sous /api/v1 nécessitent la validation de la clé API
app.use('/api/v1', authenticateApiKey);

// Endpoint : Vérifier le solde
app.get('/api/v1/balance', (req, res) => {
    res.status(200).json({
        success: true,
        balance: req.user.balance,
        currency: req.user.currency
    });
});

// Endpoint : Lister les services
app.get('/api/v1/services', (req, res) => {
    const { catalog } = req.query; // Récupère le paramètre optionnel 'catalog'
    
    let filteredServices = services;
    if (catalog) {
        filteredServices = services.filter(s => s.catalog === catalog);
    }

    res.status(200).json({
        success: true,
        services: filteredServices,
        total: filteredServices.length,
        catalogs: ["standard", "premium", "gold"]
    });
});

// Endpoint : Passer une commande
app.post('/api/v1/order', (req, res) => {
    const { service_id, link, quantity, catalog = "standard" } = req.body;

    // Vérification des champs requis pour éviter les bugs (Erreur 400)
    if (!service_id || !link || !quantity) {
        return res.status(400).json({ success: false, error: "Parametres manquants ou invalides" });
    }

    // Vérifier si le service existe
    const service = services.find(s => s.service_id === service_id);
    if (!service) {
        return res.status(400).json({ success: false, error: "Service introuvable" });
    }

    // Calcul du prix (Règle de 3 pour le prix pour 1000)
    const price = (service.price_per_1000 / 1000) * quantity;

    // Vérification du solde de l'utilisateur
    if (req.user.balance < price) {
        return res.status(400).json({ success: false, error: "Solde insuffisant" });
    }

    // Déduction du solde
    req.user.balance -= price;

    // Création de la commande
    const newOrder = {
        order_id: `ORD-${Date.now()}`,
        user_key: req.userKey, // Pour lier la commande à l'utilisateur
        catalog: catalog,
        service: service.name,
        link: link,
        quantity: quantity,
        price: price,
        currency: req.user.currency,
        status: "pending",
        start_count: 0,
        remains: quantity,
        created_at: new Date().toISOString()
    };

    orders.push(newOrder);

    // Réponse de succès
    res.status(200).json({
        success: true,
        order_id: newOrder.order_id,
        catalog: newOrder.catalog,
        service: newOrder.service,
        quantity: newOrder.quantity,
        price: newOrder.price,
        currency: newOrder.currency,
        balance: req.user.balance,
        status: newOrder.status
    });
});

// Endpoint : Statut d'une commande
app.get('/api/v1/order/:orderId', (req, res) => {
    const { orderId } = req.params;
    
    // On cherche la commande appartenant à cet utilisateur
    const order = orders.find(o => o.order_id === orderId && o.user_key === req.userKey);

    if (!order) {
        return res.status(404).json({ success: false, error: "Commande non trouvee" });
    }

    // On retire la clé utilisateur de la réponse pour la sécurité
    const { user_key, ...orderData } = order; 

    res.status(200).json({
        success: true,
        order: orderData
    });
});

// Endpoint : Historique des commandes
app.get('/api/v1/orders', (req, res) => {
    const limit = parseInt(req.query.limit) || 50;
    
    // Filtrer les commandes pour ne garder que celles de l'utilisateur
    const userOrders = orders
        .filter(o => o.user_key === req.userKey)
        .slice(0, limit)
        .map(o => {
            // Formater la réponse pour correspondre à la documentation
            return {
                order_id: o.order_id,
                service: o.service,
                quantity: o.quantity,
                price: o.price,
                status: o.status,
                created_at: o.created_at
            };
        });

    res.status(200).json({
        success: true,
        orders: userOrders,
        total: userOrders.length
    });
});

// ==========================================
// 5. GESTION GLOBALE DES ERREURS SERVEUR
// ==========================================
app.use((err, req, res, next) => {
    console.error(err.stack);
    res.status(500).json({ success: false, error: "Erreur serveur" });
});

// Lancement du serveur
app.listen(PORT, () => {
    console.log(`Le serveur API Social Boost Horizon est démarré sur http://localhost:${PORT}`);
});