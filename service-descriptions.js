function getServiceDescription(serviceName, platform, serviceType) {
  const name = (serviceName || '').toLowerCase();
  const plat = (platform || '').toLowerCase();

  const qualityInfo = detectQuality(name);
  const typeInfo = detectType(name, serviceType);
  const platformName = getPlatformDisplayName(plat);

  let desc = '';
  desc += `<div class="svc-desc-block">`;
  desc += `<div class="svc-desc-title"><i class="fas fa-info-circle"></i> A propos de ce service</div>`;
  desc += `<div class="svc-desc-what"><i class="fas fa-check-circle"></i> <strong>${typeInfo.title}</strong></div>`;
  desc += `<p class="svc-desc-text">${typeInfo.description(platformName)}</p>`;

  if (qualityInfo.badges.length > 0) {
    desc += `<div class="svc-desc-quality">`;
    desc += `<i class="fas fa-shield-alt"></i> <strong>Qualite :</strong> `;
    desc += qualityInfo.badges.join(' | ');
    desc += `</div>`;
  }

  if (qualityInfo.details) {
    desc += `<p class="svc-desc-quality-detail">${qualityInfo.details}</p>`;
  }

  desc += `<div class="svc-desc-advantages">`;
  desc += `<i class="fas fa-star"></i> <strong>Avantages :</strong>`;
  desc += `<ul>`;
  typeInfo.advantages.forEach(a => {
    desc += `<li>${a}</li>`;
  });
  desc += `</ul>`;
  desc += `</div>`;

  desc += `<div class="svc-desc-how">`;
  desc += `<i class="fas fa-cogs"></i> <strong>Comment ca marche :</strong>`;
  desc += `<p>${typeInfo.howItWorks}</p>`;
  desc += `</div>`;

  desc += `</div>`;

  return desc;
}

function detectQuality(name) {
  const badges = [];
  let details = '';

  if (name.includes('no drop') || name.includes('no-drop') || name.includes('nodrop')) {
    badges.push('<span class="q-badge q-nodrop"><i class="fas fa-shield-alt"></i> Sans baisse</span>');
    details += 'Ce service est garanti sans baisse. Les resultats resteront stables dans le temps. ';
  }
  if (name.includes('lifetime') || name.includes('a vie') || name.includes('à vie')) {
    badges.push('<span class="q-badge q-lifetime"><i class="fas fa-infinity"></i> Garanti a vie</span>');
    details += 'Garantie a vie : en cas de baisse, un rechargement automatique est effectue. ';
  }
  if (name.includes('guaranteed') || name.includes('garanti')) {
    badges.push('<span class="q-badge q-guaranteed"><i class="fas fa-certificate"></i> Garanti</span>');
  }
  if (name.includes('refill') || name.includes('recharge') || name.includes('r30') || name.includes('r60') || name.includes('r90') || name.includes('r365')) {
    let refillDays = '';
    if (name.includes('r30') || name.includes('30 day') || name.includes('30 jour') || name.includes('30d')) refillDays = '30 jours';
    else if (name.includes('r60') || name.includes('60 day') || name.includes('60 jour') || name.includes('60d')) refillDays = '60 jours';
    else if (name.includes('r90') || name.includes('90 day') || name.includes('90 jour') || name.includes('90d')) refillDays = '90 jours';
    else if (name.includes('r180') || name.includes('180 day') || name.includes('180 jour')) refillDays = '180 jours';
    else if (name.includes('r365') || name.includes('365 day') || name.includes('1 year') || name.includes('1 an')) refillDays = '1 an';
    const refillText = refillDays ? `Recharge ${refillDays}` : 'Avec recharge';
    badges.push(`<span class="q-badge q-refill"><i class="fas fa-sync-alt"></i> ${refillText}</span>`);
    details += refillDays ? `En cas de baisse dans les ${refillDays}, un rechargement gratuit sera effectue automatiquement. ` : 'En cas de baisse, un rechargement gratuit est disponible. ';
  }
  if (name.includes('hq') || name.includes('high quality') || name.includes('haute qualite') || name.includes('haute qualité')) {
    badges.push('<span class="q-badge q-hq"><i class="fas fa-gem"></i> Haute Qualite</span>');
    details += 'Comptes de haute qualite avec photos de profil et activite reelle. ';
  }
  if (name.includes('premium')) {
    badges.push('<span class="q-badge q-premium"><i class="fas fa-crown"></i> Premium</span>');
    details += 'Service premium avec des comptes verifies et actifs pour des resultats optimaux. ';
  }
  if (name.includes('real') || name.includes('reel') || name.includes('réel')) {
    badges.push('<span class="q-badge q-real"><i class="fas fa-user-check"></i> Comptes reels</span>');
    details += 'Provenant de comptes reels et actifs pour un engagement authentique. ';
  }
  if (name.includes('active') || name.includes('actif')) {
    badges.push('<span class="q-badge q-active"><i class="fas fa-bolt"></i> Comptes actifs</span>');
  }
  if (name.includes('instant') || name.includes('instantane') || name.includes('instantané')) {
    badges.push('<span class="q-badge q-instant"><i class="fas fa-zap"></i> Instantane</span>');
    details += 'Livraison instantanee : les resultats commencent a apparaitre immediatement. ';
  }
  if (name.includes('fast') || name.includes('rapide')) {
    badges.push('<span class="q-badge q-fast"><i class="fas fa-rocket"></i> Rapide</span>');
  }
  if (name.includes('slow') || name.includes('lent') || name.includes('gradual') || name.includes('progressif') || name.includes('drip feed') || name.includes('drip-feed')) {
    badges.push('<span class="q-badge q-slow"><i class="fas fa-hourglass-half"></i> Progressif</span>');
    details += 'Livraison progressive et naturelle pour un rendu plus organique. ';
  }

  return { badges, details: details.trim() };
}

function detectType(name, serviceType) {
  if (name.includes('follower') || name.includes('abonne') || name.includes('abonné') || (serviceType && serviceType.toLowerCase().includes('abonné'))) {
    return {
      title: 'Service d\'Abonnes / Followers',
      description: (platform) => `Ce service vous permet d'augmenter le nombre d'abonnes sur votre compte ${platform}. Les nouveaux abonnes apparaitront directement sur votre profil, renforçant votre credibilite et votre visibilite aupres de votre audience cible.`,
      advantages: [
        'Augmente votre credibilite sociale et votre image de marque',
        'Attire naturellement plus d\'abonnes organiques (effet boule de neige)',
        'Ameliore votre positionnement dans les suggestions de la plateforme',
        'Renforce la confiance des visiteurs et potentiels partenaires'
      ],
      howItWorks: 'Apres validation de votre commande, les abonnes commencent a arriver progressivement sur votre profil. La vitesse de livraison depend du service choisi. Votre compte doit etre public pendant toute la duree de la livraison.'
    };
  }

  if (name.includes('like') || name.includes('j\'aime') || name.includes('jaime') || name.includes('heart') || name.includes('coeur') || (serviceType && serviceType.toLowerCase().includes('j\'aime'))) {
    return {
      title: 'Service de Likes / J\'aime',
      description: (platform) => `Ce service ajoute des likes (j'aime) sur vos publications ${platform}. Les likes sont un signal fort d'engagement qui indique a l'algorithme que votre contenu est apprecie, ce qui augmente sa portee et sa visibilite.`,
      advantages: [
        'Booste la visibilite de vos publications dans le fil d\'actualite',
        'Ameliore le taux d\'engagement de votre compte',
        'Signal positif pour l\'algorithme qui recommande davantage votre contenu',
        'Incite les autres utilisateurs a interagir avec votre publication'
      ],
      howItWorks: 'Collez le lien de la publication que vous souhaitez booster. Les likes seront ajoutes progressivement. Assurez-vous que la publication est publique et accessible.'
    };
  }

  if (name.includes('view') || name.includes('vue') || name.includes('watch') || name.includes('visionnage') || (serviceType && serviceType.toLowerCase().includes('vue'))) {
    const isStory = name.includes('story') || name.includes('stories');
    const isReel = name.includes('reel');
    const isLive = name.includes('live');
    const isVideo = name.includes('video') || name.includes('vidéo');

    let contentType = 'publications';
    if (isStory) contentType = 'stories';
    else if (isReel) contentType = 'reels';
    else if (isLive) contentType = 'lives';
    else if (isVideo) contentType = 'videos';

    return {
      title: `Service de Vues${isStory ? ' Stories' : isReel ? ' Reels' : isLive ? ' Live' : isVideo ? ' Video' : ''}`,
      description: (platform) => `Ce service augmente le nombre de vues sur vos ${contentType} ${platform}. Un nombre eleve de vues signale a l'algorithme que votre contenu est populaire, ce qui entraine une diffusion plus large et davantage de visibilite organique.`,
      advantages: [
        `Augmente la portee de vos ${contentType} dans l'algorithme`,
        'Renforce la perception de popularite de votre contenu',
        'Favorise l\'apparition dans les sections "Tendances" et "Explorer"',
        'Attire plus de vues organiques grace a l\'effet de preuve sociale'
      ],
      howItWorks: `Collez le lien de votre ${contentType === 'publications' ? 'publication' : contentType.slice(0, -1)} ${platform}. Les vues seront ajoutees progressivement pour un rendu naturel. Le contenu doit etre public.`
    };
  }

  if (name.includes('comment') || name.includes('commentaire') || (serviceType && serviceType.toLowerCase().includes('commentaire'))) {
    const isCustom = name.includes('custom') || name.includes('personnalise') || name.includes('personnalisé') || name.includes('your comment') || name.includes('vos commentaire');
    const isRandom = name.includes('random') || name.includes('aleatoire') || name.includes('aléatoire');

    return {
      title: `Service de Commentaires${isCustom ? ' Personnalises' : isRandom ? ' Aleatoires' : ''}`,
      description: (platform) => isCustom
        ? `Ce service ajoute vos propres commentaires personnalises sur votre publication ${platform}. Vous choisissez exactement le contenu de chaque commentaire, ideal pour creer des discussions ciblees et pertinentes.`
        : `Ce service ajoute des commentaires ${isRandom ? 'aleatoires positifs' : ''} sur votre publication ${platform}. Les commentaires generent de l'interaction visible et encouragent d'autres utilisateurs a participer a la conversation.`,
      advantages: [
        'Cree un engagement visible et authentique sur vos publications',
        'Signal fort pour l\'algorithme (les commentaires pesent plus que les likes)',
        'Encourage d\'autres utilisateurs a commenter naturellement',
        isCustom ? 'Controle total sur le contenu des commentaires' : 'Commentaires positifs et pertinents'
      ],
      howItWorks: isCustom
        ? 'Collez le lien de la publication, puis entrez vos commentaires personnalises (un par ligne). Chaque ligne correspond a un commentaire qui sera poste par un compte different.'
        : 'Collez le lien de la publication et indiquez le nombre de commentaires souhaites. Les commentaires seront ajoutes progressivement par differents comptes.'
    };
  }

  if (name.includes('share') || name.includes('partage') || name.includes('repost') || (serviceType && serviceType.toLowerCase().includes('partage'))) {
    return {
      title: 'Service de Partages / Reposts',
      description: (platform) => `Ce service augmente le nombre de partages de votre publication ${platform}. Les partages sont l'un des signaux d'engagement les plus puissants car ils exposent votre contenu a de nouvelles audiences.`,
      advantages: [
        'Expose votre contenu a de nouvelles audiences de maniere virale',
        'Signal d\'engagement extremement fort pour l\'algorithme',
        'Augmente considerablement la portee organique',
        'Renforce la credibilite de votre contenu'
      ],
      howItWorks: 'Collez le lien de la publication a partager. Les partages seront effectues par differents comptes, augmentant la diffusion de votre contenu.'
    };
  }

  if (name.includes('save') || name.includes('sauvegarde') || name.includes('bookmark') || (serviceType && serviceType.toLowerCase().includes('sauvegarde'))) {
    return {
      title: 'Service de Sauvegardes / Saves',
      description: (platform) => `Ce service augmente le nombre de sauvegardes sur votre publication ${platform}. Les sauvegardes sont un indicateur tres valorise par les algorithmes car elles montrent que votre contenu est suffisamment utile pour etre consulte a nouveau.`,
      advantages: [
        'Signal d\'engagement tres puissant (plus que les likes)',
        'Indique a l\'algorithme que votre contenu a une valeur durable',
        'Favorise le positionnement dans la section Explorer/Decouvrir',
        'Augmente la duree de vie de vos publications dans le flux'
      ],
      howItWorks: 'Collez le lien de la publication. Les sauvegardes seront ajoutees progressivement. La publication doit etre publique.'
    };
  }

  if (name.includes('reaction') || name.includes('réaction') || (serviceType && serviceType.toLowerCase().includes('reaction'))) {
    return {
      title: 'Service de Reactions',
      description: (platform) => `Ce service ajoute des reactions sur vos publications ${platform}. Les reactions (love, haha, wow, etc.) diversifient l'engagement et montrent que votre contenu suscite differentes emotions.`,
      advantages: [
        'Diversifie les types d\'engagement sur vos publications',
        'Montre que votre contenu provoque des emotions variees',
        'Ameliore le taux d\'engagement global',
        'Plus impactant qu\'un simple like pour l\'algorithme'
      ],
      howItWorks: 'Collez le lien de la publication. Les reactions seront ajoutees par differents comptes. Certains services permettent de choisir le type de reaction.'
    };
  }

  if (name.includes('retweet') || name.includes('repost') || (serviceType && serviceType.toLowerCase().includes('retweet'))) {
    return {
      title: 'Service de Retweets / Reposts',
      description: (platform) => `Ce service augmente le nombre de retweets/reposts sur votre tweet ${platform}. Les retweets propagent votre message a l'audience de chaque personne qui retweete, multipliant exponentiellement votre portee.`,
      advantages: [
        'Multiplie la portee de votre message de maniere exponentielle',
        'Expose votre contenu a des audiences completement nouvelles',
        'Signal de viralite fort pour l\'algorithme de recommandation',
        'Augmente les chances d\'apparaitre dans les tendances'
      ],
      howItWorks: 'Collez le lien du tweet. Les retweets seront effectues progressivement par differents comptes actifs.'
    };
  }

  if (name.includes('subscriber') || name.includes('abonne') || name.includes('abonné') || (serviceType && serviceType.toLowerCase().includes('abonné'))) {
    return {
      title: 'Service d\'Abonnes / Subscribers',
      description: (platform) => `Ce service augmente le nombre d'abonnes sur votre chaine ou compte ${platform}. Plus d'abonnes signifie plus de credibilite, une meilleure monetisation et un meilleur classement dans les resultats de recherche.`,
      advantages: [
        'Accelere l\'atteinte des seuils de monetisation',
        'Ameliore le classement dans les resultats de recherche',
        'Renforce la credibilite de votre chaine/compte',
        'Attire plus d\'abonnes organiques par effet de preuve sociale'
      ],
      howItWorks: 'Collez le lien de votre chaine ou profil. Les abonnes seront ajoutes progressivement. Le profil/la chaine doit etre publique.'
    };
  }

  if (name.includes('member') || name.includes('membre') || (serviceType && serviceType.toLowerCase().includes('membre'))) {
    return {
      title: 'Service de Membres',
      description: (platform) => `Ce service ajoute des membres a votre groupe ou communaute ${platform}. Un nombre eleve de membres renforce l'autorite de votre groupe et attire naturellement de nouveaux membres interessees.`,
      advantages: [
        'Donne une image d\'une communaute active et populaire',
        'Attire de nouveaux membres par effet de preuve sociale',
        'Ameliore la visibilite de votre groupe dans les suggestions',
        'Renforce votre position de leader dans votre niche'
      ],
      howItWorks: 'Collez le lien de votre groupe ou communaute. Les membres seront ajoutes progressivement. Le groupe doit etre public ou le lien d\'invitation doit etre actif.'
    };
  }

  if (name.includes('impression') || (serviceType && serviceType.toLowerCase().includes('impression'))) {
    return {
      title: 'Service d\'Impressions',
      description: (platform) => `Ce service augmente le nombre d'impressions sur vos publications ${platform}. Les impressions representent le nombre de fois ou votre contenu est affiche, meme sans interaction, augmentant ainsi votre visibilite globale.`,
      advantages: [
        'Augmente la visibilite brute de votre contenu',
        'Ameliore les statistiques de performance de vos publications',
        'Signal positif pour les partenariats et collaborations',
        'Contribue a l\'amelioration de votre portee organique'
      ],
      howItWorks: 'Collez le lien de la publication. Les impressions seront generees progressivement pour un rendu naturel dans vos statistiques.'
    };
  }

  if (name.includes('profile visit') || name.includes('visite') || name.includes('visit') || (serviceType && serviceType.toLowerCase().includes('visite'))) {
    return {
      title: 'Service de Visites de Profil',
      description: (platform) => `Ce service genere des visites sur votre profil ${platform}. Plus de visites indique a l'algorithme que votre profil suscite de l'interet, ameliorant ainsi votre visibilite dans les suggestions.`,
      advantages: [
        'Augmente la visibilite de votre profil dans les suggestions',
        'Signal d\'interet pour l\'algorithme de recommandation',
        'Peut generer des abonnes et de l\'engagement supplementaire',
        'Ameliore vos statistiques de profil'
      ],
      howItWorks: 'Collez le lien de votre profil. Les visites seront generees par differents comptes de maniere progressive.'
    };
  }

  if (name.includes('engagement') || (serviceType && serviceType.toLowerCase().includes('engagement'))) {
    return {
      title: 'Service d\'Engagement',
      description: (platform) => `Ce service combine plusieurs types d'interactions (likes, commentaires, partages, sauvegardes) sur vos publications ${platform}. Un engagement diversifie est le signal le plus fort pour les algorithmes de recommandation.`,
      advantages: [
        'Combine plusieurs types d\'interactions pour un impact maximal',
        'Signal le plus puissant pour les algorithmes de recommandation',
        'Simule un engagement organique naturel et diversifie',
        'Ameliore tous vos indicateurs de performance en une seule commande'
      ],
      howItWorks: 'Collez le lien de la publication. Differents types d\'interactions seront ajoutes pour simuler un engagement naturel et diversifie.'
    };
  }

  if (name.includes('traffic') || name.includes('trafic') || name.includes('seo') || name.includes('web') || (serviceType && serviceType.toLowerCase().includes('trafic'))) {
    return {
      title: 'Service de Trafic Web / SEO',
      description: (platform) => `Ce service genere du trafic vers votre site web ou page. Les visites proviennent de sources variees et contribuent a ameliorer vos statistiques de frequentation et potentiellement votre referencement.`,
      advantages: [
        'Augmente les statistiques de frequentation de votre site',
        'Peut contribuer a ameliorer votre positionnement SEO',
        'Diversifie les sources de trafic de votre site',
        'Ideal pour lancer un nouveau site ou une nouvelle page'
      ],
      howItWorks: 'Collez l\'URL de votre site web ou page. Le trafic sera genere progressivement a partir de differentes sources geographiques.'
    };
  }

  if (name.includes('play') || name.includes('stream') || name.includes('listen') || name.includes('ecoute') || name.includes('écoute')) {
    return {
      title: 'Service de Streams / Ecoutes',
      description: (platform) => `Ce service augmente le nombre d'ecoutes ou de streams sur votre musique ${platform}. Plus de streams augmentent vos chances d'apparaitre dans les playlists algorithmiques et ameliorent vos revenus.`,
      advantages: [
        'Augmente vos revenus par stream',
        'Ameliore vos chances d\'apparaitre dans les playlists algorithmiques',
        'Renforce votre credibilite aupres des labels et promoteurs',
        'Genere un effet boule de neige avec plus de decouvertes organiques'
      ],
      howItWorks: 'Collez le lien de votre morceau ou album. Les ecoutes seront generees progressivement pour un rendu naturel dans vos statistiques.'
    };
  }

  return {
    title: 'Service de Boost',
    description: (platform) => `Ce service ameliore vos metriques sur ${platform || 'les reseaux sociaux'}. Il est conçu pour renforcer votre presence en ligne et augmenter votre visibilite aupres de votre audience cible.`,
    advantages: [
      'Ameliore votre presence en ligne',
      'Renforce votre credibilite sociale',
      'Augmente votre visibilite organique',
      'Resultat professionnel et progressif'
    ],
    howItWorks: 'Collez le lien de votre publication ou profil. Le service sera livre progressivement. Assurez-vous que votre contenu est public.'
  };
}

function getPlatformDisplayName(platform) {
  const names = {
    'instagram': 'Instagram',
    'facebook': 'Facebook',
    'tiktok': 'TikTok',
    'youtube': 'YouTube',
    'twitter': 'X (Twitter)',
    'telegram': 'Telegram',
    'whatsapp': 'WhatsApp',
    'linkedin': 'LinkedIn',
    'spotify': 'Spotify',
    'twitch': 'Twitch',
    'discord': 'Discord',
    'snapchat': 'Snapchat',
    'pinterest': 'Pinterest',
    'soundcloud': 'SoundCloud',
    'threads': 'Threads',
    'website': 'Web',
    'other': 'la plateforme'
  };
  return names[platform] || 'la plateforme';
}

function getDropNotice(serviceType) {
  const type = (serviceType || '').toLowerCase();

  let specificNote = '';
  if (type.includes('abonné') || type.includes('follower') || type.includes('abonne')) {
    specificNote = 'Les abonnes peuvent connaitre des baisses legeres dans les premiers jours. C\'est un comportement normal lie aux mecanismes de securite des plateformes.';
  } else if (type.includes('like') || type.includes('j\'aime') || type.includes('jaime')) {
    specificNote = 'Les likes peuvent fluctuer legerement apres la livraison. Cela fait partie du fonctionnement normal des reseaux sociaux.';
  } else if (type.includes('vue') || type.includes('view')) {
    specificNote = 'Les compteurs de vues peuvent prendre quelques heures pour se mettre a jour completement sur la plateforme.';
  } else {
    specificNote = 'Les metriques peuvent connaitre de legeres fluctuations apres la livraison. C\'est un phenomene naturel sur les reseaux sociaux.';
  }

  return `<div class="drop-notice">
    <div class="drop-notice-header">
      <i class="fas fa-exclamation-triangle"></i>
      <strong>Note importante sur les baisses</strong>
    </div>
    <p>${specificNote}</p>
    <p>Pour maximiser la retention de vos resultats et obtenir les meilleurs resultats possibles, nous vous recommandons de consulter notre guide complet.</p>
    <a href="strategie-de-boost.html" class="drop-notice-link">
      <i class="fas fa-lightbulb"></i> Consulter notre Strategie de Boost
      <i class="fas fa-arrow-right"></i>
    </a>
  </div>`;
}
