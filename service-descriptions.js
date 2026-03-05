function getServiceDescription(serviceName, platform, serviceType) {
  try {
    const name = (serviceName || '').toLowerCase();
    const originalName = serviceName || '';
    const plat = (platform || '').toLowerCase();
    const platformName = getPlatformDisplayName(plat);

    const context = analyzeServiceName(name, plat);
    const qualityInfo = detectQuality(name);

    let desc = '<div class="svc-desc-block">';
    desc += '<div class="svc-desc-title"><i class="fas fa-info-circle"></i> A propos de ce service</div>';
    desc += '<div class="svc-desc-what"><i class="fas fa-check-circle"></i> <strong>' + context.title + '</strong></div>';
    desc += '<p class="svc-desc-text">' + context.description + '</p>';

    if (context.targetInfo) {
      desc += '<div class="svc-desc-target"><i class="fas fa-crosshairs"></i> <strong>Ciblage :</strong> ' + context.targetInfo + '</div>';
    }

    if (context.linkType) {
      desc += '<div class="svc-desc-link-info"><i class="fas fa-link"></i> <strong>Lien requis :</strong> ' + context.linkType + '</div>';
    }

    if (qualityInfo.badges.length > 0) {
      desc += '<div class="svc-desc-quality"><i class="fas fa-shield-alt"></i> <strong>Qualite :</strong> ' + qualityInfo.badges.join(' ') + '</div>';
    }

    if (qualityInfo.details) {
      desc += '<p class="svc-desc-quality-detail">' + qualityInfo.details + '</p>';
    }

    desc += '<div class="svc-desc-advantages"><i class="fas fa-star"></i> <strong>Avantages :</strong><ul>';
    context.advantages.forEach(function(a) { desc += '<li>' + a + '</li>'; });
    desc += '</ul></div>';

    desc += '<div class="svc-desc-how"><i class="fas fa-cogs"></i> <strong>Comment ca marche :</strong>';
    desc += '<p>' + context.howItWorks + '</p></div>';

    if (context.warning) {
      desc += '<div class="svc-desc-warning"><i class="fas fa-exclamation-triangle"></i> <strong>Attention :</strong> ' + context.warning + '</div>';
    }

    desc += '</div>';
    return desc;
  } catch (e) {
    console.error('Erreur getServiceDescription:', e);
    return '';
  }
}

function analyzeServiceName(name, plat) {
  var platformName = getPlatformDisplayName(plat);

  var isLive = name.includes('live') || name.includes('en direct') || name.includes('livestream') || name.includes('live stream');
  var isStory = name.includes('story') || name.includes('stories');
  var isReel = name.includes('reel');
  var isShort = name.includes('short');
  var isVideo = name.includes('video') || name.includes('vidéo') || name.includes('clip');
  var isPost = name.includes('post') || name.includes('publication') || name.includes('photo');
  var isTweet = name.includes('tweet');
  var isPage = name.includes('page');
  var isGroup = name.includes('group') || name.includes('groupe');
  var isChannel = name.includes('channel') || name.includes('chaine') || name.includes('chaîne');
  var isProfile = name.includes('profile') || name.includes('profil');
  var isPlaylist = name.includes('playlist');

  var isTargeted = false;
  var targetDetails = [];
  var countries = [];
  var genderInfo = '';

  if (name.includes('usa') || name.includes('united states') || name.includes('american') || name.includes('etats-unis') || name.includes('états-unis')) { countries.push('Etats-Unis'); isTargeted = true; }
  if (name.includes('brazil') || name.includes('bresil') || name.includes('brésil') || name.includes('brazilian')) { countries.push('Bresil'); isTargeted = true; }
  if (name.includes('india') || name.includes('inde') || name.includes('indian')) { countries.push('Inde'); isTargeted = true; }
  if (name.includes('turkey') || name.includes('turquie') || name.includes('turkish') || name.includes('turk')) { countries.push('Turquie'); isTargeted = true; }
  if (name.includes('arab') || name.includes('middle east') || name.includes('moyen orient') || name.includes('mena')) { countries.push('Pays Arabes'); isTargeted = true; }
  if (name.includes('africa') || name.includes('afrique') || name.includes('african')) { countries.push('Afrique'); isTargeted = true; }
  if (name.includes('france') || name.includes('french') || name.includes('français') || name.includes('francais') || name.includes('francophone')) { countries.push('France / Francophone'); isTargeted = true; }
  if (name.includes('uk ') || name.includes('united kingdom') || name.includes('british') || name.includes('royaume-uni') || name.includes('royaume uni')) { countries.push('Royaume-Uni'); isTargeted = true; }
  if (name.includes('germany') || name.includes('german') || name.includes('allemagne') || name.includes('deutsch')) { countries.push('Allemagne'); isTargeted = true; }
  if (name.includes('spain') || name.includes('spanish') || name.includes('espagne') || name.includes('espagnol')) { countries.push('Espagne'); isTargeted = true; }
  if (name.includes('russia') || name.includes('russian') || name.includes('russie') || name.includes('russe')) { countries.push('Russie'); isTargeted = true; }
  if (name.includes('indonesia') || name.includes('indonesi') || name.includes('indonésie')) { countries.push('Indonesie'); isTargeted = true; }
  if (name.includes('nigeria') || name.includes('nigerian')) { countries.push('Nigeria'); isTargeted = true; }
  if (name.includes('global') || name.includes('worldwide') || name.includes('mondial') || name.includes('international')) { targetDetails.push('Audience mondiale / internationale'); }
  if (name.includes('mixed') || name.includes('mixte') || name.includes('mix')) { targetDetails.push('Audience mixte (differents pays)'); }

  if (name.includes('female') || name.includes('femme') || name.includes('feminine') || name.includes('féminin') || name.includes('feminin') || name.includes('women') || name.includes('girl') || name.includes('fille')) {
    genderInfo = 'Comptes feminins uniquement';
    isTargeted = true;
  }
  if (name.includes('male') || name.includes('homme') || name.includes('masculin') || name.includes('men') || name.includes('boy') || name.includes('garcon') || name.includes('garçon')) {
    if (!name.includes('female')) {
      genderInfo = 'Comptes masculins uniquement';
      isTargeted = true;
    }
  }

  if (countries.length > 0) targetDetails.push('Pays : ' + countries.join(', '));
  if (genderInfo) targetDetails.push('Genre : ' + genderInfo);

  var targetInfo = isTargeted && targetDetails.length > 0 ? targetDetails.join(' | ') : '';

  if (isLive && (name.includes('viewer') || name.includes('spectateur') || name.includes('telespectat') || name.includes('téléspectat') || name.includes('watching'))) {
    return buildLiveViewers(name, platformName, targetInfo);
  }
  if (isLive && name.includes('like')) {
    return buildLiveLikes(name, platformName, targetInfo);
  }
  if (isLive && name.includes('share')) {
    return buildLiveShares(name, platformName, targetInfo);
  }
  if (isLive && name.includes('comment')) {
    return buildLiveComments(name, platformName, targetInfo);
  }

  if (name.includes('follower') || name.includes('abonne') || name.includes('abonné')) {
    return buildFollowers(name, platformName, isPage, isProfile, targetInfo);
  }
  if (name.includes('subscriber') || name.includes('subscri')) {
    return buildSubscribers(name, platformName, isChannel, targetInfo);
  }

  if (name.includes('like') || name.includes("j'aime") || name.includes('jaime') || name.includes('heart') || name.includes('coeur') || name.includes('thumb')) {
    return buildLikes(name, platformName, isStory, isReel, isShort, isVideo, isPost, isTweet, isLive, targetInfo);
  }

  if (name.includes('view') || name.includes('vue') || name.includes('watch') || name.includes('visionnage') || name.includes('impression')) {
    return buildViews(name, platformName, isStory, isReel, isShort, isVideo, isPost, isTweet, isProfile, targetInfo);
  }

  if (name.includes('comment') || name.includes('commentaire')) {
    return buildComments(name, platformName, targetInfo);
  }

  if (name.includes('share') || name.includes('partage')) {
    return buildShares(name, platformName, isReel, isVideo, isPost, isTweet, targetInfo);
  }

  if (name.includes('save') || name.includes('sauvegarde') || name.includes('bookmark') || name.includes('favoris') || name.includes('favori')) {
    return buildSaves(name, platformName, isReel, isPost, targetInfo);
  }

  if (name.includes('retweet') || name.includes('repost') || name.includes('quote')) {
    return buildRetweets(name, platformName, targetInfo);
  }

  if (name.includes('reaction') || name.includes('réaction') || name.includes('emoji')) {
    return buildReactions(name, platformName, targetInfo);
  }

  if (name.includes('member') || name.includes('membre')) {
    return buildMembers(name, platformName, isGroup, isChannel, targetInfo);
  }

  if (name.includes('vote') || name.includes('poll')) {
    return buildVotes(name, platformName, targetInfo);
  }

  if (name.includes('traffic') || name.includes('trafic') || name.includes('visit') || name.includes('visite') || name.includes('click') || name.includes('clic') || name.includes('seo')) {
    return buildTraffic(name, platformName, targetInfo);
  }

  if (name.includes('play') || name.includes('stream') || name.includes('listen') || name.includes('ecoute') || name.includes('écoute')) {
    return buildStreams(name, platformName, isPlaylist, targetInfo);
  }

  if (name.includes('engagement')) {
    return buildEngagement(name, platformName, targetInfo);
  }

  if (name.includes('reach') || name.includes('portee') || name.includes('portée')) {
    return buildReach(name, platformName, targetInfo);
  }

  if (name.includes('mention') || name.includes('tag')) {
    return buildMentions(name, platformName, targetInfo);
  }

  return buildGeneric(name, platformName, targetInfo);
}

function buildLiveViewers(name, platform, targetInfo) {
  var duration = '';
  if (name.includes('30 min') || name.includes('30min')) duration = '30 minutes';
  else if (name.includes('60 min') || name.includes('1 hour') || name.includes('1h') || name.includes('60min')) duration = '60 minutes';
  else if (name.includes('90 min') || name.includes('90min')) duration = '90 minutes';
  else if (name.includes('120 min') || name.includes('2 hour') || name.includes('2h') || name.includes('120min')) duration = '2 heures';
  else if (name.includes('180 min') || name.includes('3 hour') || name.includes('3h')) duration = '3 heures';

  return {
    title: 'Telespectateurs en direct (Live Viewers) - ' + platform,
    description: 'Ce service envoie des telespectateurs reels sur votre diffusion en direct (live) ' + platform + '.' + (duration ? ' Les viewers resteront connectes pendant environ ' + duration + '.' : '') + ' Ces spectateurs augmentent le compteur de votre live en temps reel, ce qui booste la visibilite de votre stream dans les suggestions de la plateforme.',
    targetInfo: targetInfo,
    linkType: 'Lien de votre LIVE en cours de diffusion (pas une video deja publiee). Vous devez lancer votre live AVANT de passer la commande.',
    advantages: [
      'Augmente le nombre de spectateurs visibles sur votre live en temps reel',
      'Booste votre live dans les recommandations et la page Decouvrir',
      'Attire des spectateurs organiques qui voient un live populaire',
      'Renforce votre credibilite en tant que createur de contenu live'
    ],
    howItWorks: 'Lancez votre live ' + platform + ' PUIS collez le lien du live ici. Les telespectateurs rejoindront votre diffusion progressivement.' + (duration ? ' Ils resteront connectes pendant environ ' + duration + '.' : '') + ' Important : la commande ne fonctionne QUE sur un live en cours, pas sur une video deja publiee.',
    warning: 'Ce service fonctionne UNIQUEMENT pendant un live en cours. Si vous envoyez le lien d\'une video deja publiee, le service ne pourra pas etre livre. Assurez-vous que votre live est demarre avant de commander.'
  };
}

function buildLiveLikes(name, platform, targetInfo) {
  return {
    title: 'Likes sur Live (en direct) - ' + platform,
    description: 'Ce service ajoute des likes/coeurs en temps reel pendant votre diffusion en direct ' + platform + '. Les likes apparaissent comme des coeurs flottants visibles par tous les spectateurs, donnant une impression d\'engagement eleve sur votre live.',
    targetInfo: targetInfo,
    linkType: 'Lien de votre LIVE en cours de diffusion.',
    advantages: [
      'Les coeurs/likes flottants animent votre live visuellement',
      'Donne l\'impression d\'un live tres engage et populaire',
      'Motive les spectateurs organiques a interagir aussi',
      'Ameliore le classement de votre live dans les suggestions'
    ],
    howItWorks: 'Lancez votre live ' + platform + ', puis collez le lien ici. Les likes apparaitront comme des coeurs flottants en temps reel sur votre diffusion. Important : ne fonctionne QUE sur un live en cours.',
    warning: 'Ce service est reserve aux lives en cours de diffusion. Ne fonctionne pas sur des publications ou videos deja publiees.'
  };
}

function buildLiveShares(name, platform, targetInfo) {
  return {
    title: 'Partages de Live (en direct) - ' + platform,
    description: 'Ce service genere des partages de votre diffusion en direct ' + platform + '. Quand des personnes partagent votre live, il atteint de nouvelles audiences et augmente drastiquement le nombre de spectateurs.',
    targetInfo: targetInfo,
    linkType: 'Lien de votre LIVE en cours de diffusion.',
    advantages: [
      'Propage votre live a de nouvelles audiences en temps reel',
      'Chaque partage peut amener plusieurs nouveaux spectateurs',
      'Signal viral extremement puissant pour l\'algorithme',
      'Augmente la portee de votre live de maniere exponentielle'
    ],
    howItWorks: 'Lancez votre live puis collez le lien. Les partages seront effectues pendant votre diffusion, attirant de nouveaux spectateurs.',
    warning: 'Ce service fonctionne uniquement pendant un live en cours.'
  };
}

function buildLiveComments(name, platform, targetInfo) {
  return {
    title: 'Commentaires sur Live (en direct) - ' + platform,
    description: 'Ce service ajoute des commentaires en temps reel pendant votre diffusion en direct ' + platform + '. Les commentaires apparaissent dans le chat de votre live, creant une atmosphere animee et engagee.',
    targetInfo: targetInfo,
    linkType: 'Lien de votre LIVE en cours de diffusion.',
    advantages: [
      'Anime le chat de votre live avec des messages en temps reel',
      'Donne l\'impression d\'une communaute active et engagee',
      'Encourage les vrais spectateurs a participer au chat',
      'Ameliore le classement du live dans les recommandations'
    ],
    howItWorks: 'Lancez votre live puis collez le lien. Les commentaires seront postes dans le chat pendant votre diffusion.',
    warning: 'Fonctionne uniquement sur un live en cours de diffusion.'
  };
}

function buildFollowers(name, platform, isPage, isProfile, targetInfo) {
  var contentLabel = isPage ? 'votre page' : 'votre profil';
  var specifics = [];

  if (name.includes('bot') || name.includes('cheap') || name.includes('pas cher')) {
    specifics.push('Ces abonnes sont economiques mais peuvent ne pas avoir de photos de profil detaillees.');
  }

  return {
    title: 'Abonnes / Followers - ' + platform,
    description: 'Ce service ajoute de nouveaux abonnes sur ' + contentLabel + ' ' + platform + '. ' + (specifics.length > 0 ? specifics[0] : 'Les nouveaux abonnes renforceront votre credibilite et donneront une image plus etablie a votre compte, ce qui incite naturellement d\'autres personnes a vous suivre aussi.'),
    targetInfo: targetInfo,
    linkType: 'Lien de ' + contentLabel + ' ' + platform + '. Le profil doit etre PUBLIC pendant toute la livraison.',
    advantages: [
      'Renforce la credibilite de votre compte aupres des nouveaux visiteurs',
      'Effet boule de neige : plus d\'abonnes attirent plus d\'abonnes organiques',
      'Ameliore votre positionnement dans les suggestions de la plateforme',
      'Important pour les partenariats et les collaborations de marque'
    ],
    howItWorks: 'Collez le lien de ' + contentLabel + '. Les abonnes arriveront progressivement. Gardez votre compte PUBLIC pendant toute la duree de la livraison. Si votre compte est prive, les abonnes ne pourront pas vous suivre et la commande echouera.',
    warning: name.includes('private') || name.includes('prive') || name.includes('privé') ? null : null
  };
}

function buildSubscribers(name, platform, isChannel, targetInfo) {
  return {
    title: 'Abonnes / Subscribers - ' + platform,
    description: 'Ce service augmente le nombre d\'abonnes sur ' + (isChannel ? 'votre chaine' : 'votre compte') + ' ' + platform + '. Plus d\'abonnes signifie plus de credibilite, une meilleure visibilite dans les recommandations' + (platform === 'YouTube' ? ' et un rapprochement des seuils de monetisation' : '') + '.',
    targetInfo: targetInfo,
    linkType: 'Lien de ' + (isChannel ? 'votre chaine' : 'votre compte') + ' ' + platform + '.',
    advantages: [
      'Renforce l\'autorite et la credibilite de votre ' + (isChannel ? 'chaine' : 'compte'),
      'Ameliore le classement dans les resultats de recherche',
      plat === 'youtube' ? 'Rapproche des seuils de monetisation (1000 abonnes)' : 'Augmente la portee de vos futures publications',
      'Attire plus d\'abonnes organiques par preuve sociale'
    ],
    howItWorks: 'Collez le lien de ' + (isChannel ? 'votre chaine' : 'votre compte') + '. Les abonnes seront ajoutes progressivement.'
  };
}

function buildLikes(name, platform, isStory, isReel, isShort, isVideo, isPost, isTweet, isLive, targetInfo) {
  var contentType = 'votre publication';
  var specificDesc = '';

  if (isReel) { contentType = 'votre Reel'; specificDesc = 'Les likes sur un Reel boostent sa visibilite dans l\'onglet Reels et la page Explorer, augmentant sa portee virale.'; }
  else if (isShort) { contentType = 'votre Short'; specificDesc = 'Les likes sur un Short augmentent ses chances d\'etre recommande dans le flux Shorts, atteignant des millions d\'utilisateurs.'; }
  else if (isStory) { contentType = 'votre Story'; specificDesc = 'Les likes sur une Story montrent a l\'algorithme que vos stories sont appreciees, ce qui les met en avant dans le fil.'; }
  else if (isVideo) { contentType = 'votre video'; specificDesc = 'Les likes sur une video ameliorent son classement dans les recommandations et les resultats de recherche.'; }
  else if (isTweet) { contentType = 'votre tweet'; specificDesc = 'Les likes sur un tweet augmentent sa visibilite dans le fil d\'actualite et les suggestions.'; }
  else if (isPost) { contentType = 'votre publication'; specificDesc = 'Les likes boostent la visibilite de votre publication dans le fil d\'actualite de vos abonnes et au-dela.'; }
  else { specificDesc = 'Les likes sont un indicateur cle d\'engagement qui signale a l\'algorithme que votre contenu merite d\'etre montre a plus de personnes.'; }

  return {
    title: 'Likes / J\'aime sur ' + contentType + ' - ' + platform,
    description: 'Ce service ajoute des likes sur ' + contentType + ' ' + platform + '. ' + specificDesc,
    targetInfo: targetInfo,
    linkType: 'Lien direct de ' + contentType + ' ' + platform + '. La publication doit etre PUBLIQUE.',
    advantages: [
      'Booste la visibilite de ' + contentType + ' dans l\'algorithme',
      'Ameliore le taux d\'engagement global de votre compte',
      'Signal positif qui incite d\'autres utilisateurs a liker aussi',
      'Renforce la perception de qualite de votre contenu'
    ],
    howItWorks: 'Collez le lien de ' + contentType + '. Les likes seront ajoutes progressivement par differents comptes. Assurez-vous que ' + contentType + ' est publique et accessible.'
  };
}

function buildViews(name, platform, isStory, isReel, isShort, isVideo, isPost, isTweet, isProfile, targetInfo) {
  var contentType = 'votre contenu';
  var specificDesc = '';

  if (name.includes('profile visit') || name.includes('visite de profil') || isProfile) {
    return {
      title: 'Visites de profil - ' + platform,
      description: 'Ce service genere des visites sur votre profil ' + platform + '. Plus de visites de profil signale a l\'algorithme que votre compte suscite de l\'interet, ce qui ameliore votre visibilite dans les suggestions et les recommandations.',
      targetInfo: targetInfo,
      linkType: 'Lien de votre profil ' + platform + '.',
      advantages: [
        'Augmente la visibilite de votre profil dans les suggestions',
        'Signal d\'interet pour l\'algorithme de recommandation',
        'Peut generer des abonnes supplementaires',
        'Ameliore vos statistiques de performance'
      ],
      howItWorks: 'Collez le lien de votre profil. Les visites seront generees progressivement par differents comptes.'
    };
  }

  if (name.includes('impression')) {
    return {
      title: 'Impressions - ' + platform,
      description: 'Ce service augmente le nombre d\'impressions sur votre contenu ' + platform + '. Les impressions representent le nombre de fois ou votre contenu est affiche dans les fils, les recherches ou les suggestions, meme sans clic.',
      targetInfo: targetInfo,
      linkType: 'Lien de votre publication ' + platform + '.',
      advantages: [
        'Augmente la visibilite brute de votre contenu',
        'Ameliore vos statistiques de portee',
        'Signal positif pour les partenariats',
        'Contribue a la portee organique'
      ],
      howItWorks: 'Collez le lien de la publication. Les impressions apparaitront progressivement dans vos statistiques.'
    };
  }

  if (isStory) { contentType = 'votre Story'; specificDesc = 'Les vues de Story montrent a l\'algorithme que vos stories interessent votre audience, ce qui les positionne en premier dans le fil de stories de vos abonnes.'; }
  else if (isReel) { contentType = 'votre Reel'; specificDesc = 'Les vues de Reel sont essentielles pour la viralite : plus un Reel a de vues, plus il est recommande dans l\'onglet Reels et la page Explorer.'; }
  else if (isShort) { contentType = 'votre Short'; specificDesc = 'Les vues de Short augmentent ses chances d\'etre pousse par l\'algorithme dans le flux Shorts, ou des millions d\'utilisateurs decouvrent du contenu.'; }
  else if (isVideo) { contentType = 'votre video'; specificDesc = 'Les vues de video ameliorent le classement dans les resultats de recherche et les recommandations de la plateforme.'; }
  else if (isTweet) { contentType = 'votre tweet'; specificDesc = 'Les vues/impressions sur un tweet augmentent sa portee et son apparition dans les fils d\'actualite.'; }
  else { specificDesc = 'Les vues signalent a l\'algorithme que votre contenu est populaire, ce qui augmente sa distribution a de nouvelles audiences.'; }

  return {
    title: 'Vues sur ' + contentType + ' - ' + platform,
    description: 'Ce service augmente le nombre de vues sur ' + contentType + ' ' + platform + '. ' + specificDesc,
    targetInfo: targetInfo,
    linkType: 'Lien direct de ' + contentType + ' ' + platform + '. Le contenu doit etre PUBLIC.',
    advantages: [
      'Augmente la portee de ' + contentType + ' dans l\'algorithme',
      'Renforce la perception de popularite de votre contenu',
      'Favorise l\'apparition dans les sections Tendances/Explorer',
      'Attire des vues organiques par preuve sociale'
    ],
    howItWorks: 'Collez le lien de ' + contentType + '. Les vues seront ajoutees progressivement pour un rendu naturel. Le contenu doit etre public et accessible.'
  };
}

function buildComments(name, platform, targetInfo) {
  var isCustom = name.includes('custom') || name.includes('personnalise') || name.includes('personnalisé') || name.includes('your comment') || name.includes('vos commentaire');
  var isRandom = name.includes('random') || name.includes('aleatoire') || name.includes('aléatoire');
  var isEmoji = name.includes('emoji') || name.includes('emoticon');
  var isPositive = name.includes('positive') || name.includes('positif');

  var typeLabel = isCustom ? 'personnalises' : (isRandom ? 'aleatoires' : (isEmoji ? 'emoji' : (isPositive ? 'positifs' : '')));

  return {
    title: 'Commentaires ' + typeLabel + ' - ' + platform,
    description: isCustom
      ? 'Ce service permet de poster VOS propres commentaires sur votre publication ' + platform + '. Vous redigez le texte exact de chaque commentaire (un par ligne), et chacun sera poste par un compte different. Ideal pour creer des conversations pertinentes ou poser des questions strategiques.'
      : 'Ce service ajoute des commentaires ' + typeLabel + ' sur votre publication ' + platform + '. ' + (isEmoji ? 'Les commentaires avec emojis sont courts et visuels, donnant une impression d\'engagement spontane.' : 'Les commentaires diversifies creent de l\'interaction visible et encouragent les vrais utilisateurs a participer a la discussion.'),
    targetInfo: targetInfo,
    linkType: 'Lien direct de la publication ' + platform + '.',
    advantages: [
      'Les commentaires sont le signal d\'engagement le plus puissant pour l\'algorithme',
      isCustom ? 'Controle total sur le contenu de chaque commentaire' : 'Commentaires varies et naturels',
      'Encourage les autres utilisateurs a commenter aussi',
      'Booste la visibilite de la publication dans le fil d\'actualite'
    ],
    howItWorks: isCustom
      ? 'Collez le lien de la publication, puis ecrivez vos commentaires dans le champ texte (UN commentaire par ligne). Le nombre de lignes = le nombre de commentaires qui seront postes, chacun par un compte different.'
      : 'Collez le lien de la publication et indiquez la quantite souhaitee. Les commentaires seront postes progressivement par differents comptes.'
  };
}

function buildShares(name, platform, isReel, isVideo, isPost, isTweet, targetInfo) {
  var contentType = isReel ? 'votre Reel' : (isVideo ? 'votre video' : (isTweet ? 'votre tweet' : 'votre publication'));

  return {
    title: 'Partages de ' + contentType + ' - ' + platform,
    description: 'Ce service augmente le nombre de partages de ' + contentType + ' ' + platform + '. Chaque partage expose votre contenu a l\'audience entiere de la personne qui partage, multipliant votre portee de maniere exponentielle.',
    targetInfo: targetInfo,
    linkType: 'Lien direct de ' + contentType + ' ' + platform + '.',
    advantages: [
      'Expose votre contenu a de nouvelles audiences viralement',
      'Signal d\'engagement le plus puissant pour la viralite',
      'Chaque partage peut generer des dizaines de vues supplementaires',
      'Augmente la portee organique de maniere significative'
    ],
    howItWorks: 'Collez le lien de ' + contentType + '. Les partages seront effectues progressivement par differents comptes, augmentant la diffusion de votre contenu.'
  };
}

function buildSaves(name, platform, isReel, isPost, targetInfo) {
  var contentType = isReel ? 'votre Reel' : 'votre publication';

  return {
    title: 'Sauvegardes / Saves - ' + platform,
    description: 'Ce service ajoute des sauvegardes (saves/bookmarks) sur ' + contentType + ' ' + platform + '. Les sauvegardes indiquent a l\'algorithme que votre contenu a une valeur durable que les gens veulent revoir. C\'est l\'un des signaux les plus valorises, souvent plus que les likes.',
    targetInfo: targetInfo,
    linkType: 'Lien direct de ' + contentType + ' ' + platform + '.',
    advantages: [
      'Signal d\'engagement plus puissant que les likes pour l\'algorithme',
      'Indique que votre contenu merite d\'etre revu',
      'Favorise le positionnement dans la page Explorer/Decouvrir',
      'Augmente la duree de vie de votre contenu dans le flux'
    ],
    howItWorks: 'Collez le lien de ' + contentType + '. Les sauvegardes seront ajoutees progressivement. La publication doit etre publique.'
  };
}

function buildRetweets(name, platform, targetInfo) {
  var isQuote = name.includes('quote') || name.includes('citation');

  return {
    title: (isQuote ? 'Citations / Quote Retweets' : 'Retweets / Reposts') + ' - ' + platform,
    description: isQuote
      ? 'Ce service ajoute des citations (quote retweets) sur votre tweet ' + platform + '. Les citations incluent votre tweet original avec un commentaire supplementaire, creant plus d\'engagement et de visibilite qu\'un simple retweet.'
      : 'Ce service augmente le nombre de retweets/reposts sur votre tweet ' + platform + '. Chaque retweet propage votre message a l\'audience complete de la personne qui retweete, multipliant votre portee exponentiellement.',
    targetInfo: targetInfo,
    linkType: 'Lien direct du tweet ' + platform + '.',
    advantages: [
      'Propage votre message a des audiences completement nouvelles',
      'Signal de viralite tres fort pour l\'algorithme',
      'Augmente les chances d\'apparaitre dans les tendances',
      isQuote ? 'Les citations generent plus d\'engagement qu\'un simple retweet' : 'Chaque retweet multiplie exponentiellement votre portee'
    ],
    howItWorks: 'Collez le lien du tweet. Les ' + (isQuote ? 'citations' : 'retweets') + ' seront effectues progressivement par differents comptes actifs.'
  };
}

function buildReactions(name, platform, targetInfo) {
  var reactionType = '';
  if (name.includes('love') || name.includes('coeur') || name.includes('heart')) reactionType = 'Love/Coeur';
  else if (name.includes('haha') || name.includes('rire')) reactionType = 'Haha/Rire';
  else if (name.includes('wow') || name.includes('etonne') || name.includes('étonné')) reactionType = 'Wow/Etonne';
  else if (name.includes('sad') || name.includes('triste')) reactionType = 'Triste';
  else if (name.includes('angry') || name.includes('colere') || name.includes('colère') || name.includes('grrr')) reactionType = 'En colere';
  else if (name.includes('care') || name.includes('soutien') || name.includes('solidaire')) reactionType = 'Solidaire';

  return {
    title: 'Reactions ' + (reactionType ? '(' + reactionType + ')' : '') + ' - ' + platform,
    description: 'Ce service ajoute des reactions ' + (reactionType ? 'de type "' + reactionType + '"' : 'variees') + ' sur votre publication ' + platform + '. Les reactions diversifient l\'engagement et montrent que votre contenu provoque des emotions, ce qui pese plus qu\'un simple like dans l\'algorithme.',
    targetInfo: targetInfo,
    linkType: 'Lien direct de la publication ' + platform + '.',
    advantages: [
      'Les reactions pesent plus qu\'un like simple dans l\'algorithme',
      'Diversifie les types d\'interactions visibles',
      'Montre que votre contenu suscite des emotions',
      'Ameliore le taux d\'engagement global'
    ],
    howItWorks: 'Collez le lien de la publication. Les reactions ' + (reactionType ? '"' + reactionType + '"' : '') + ' seront ajoutees progressivement par differents comptes.'
  };
}

function buildMembers(name, platform, isGroup, isChannel, targetInfo) {
  var containerType = isChannel ? 'votre chaine/canal' : (isGroup ? 'votre groupe' : 'votre groupe/communaute');

  return {
    title: 'Membres pour ' + containerType + ' - ' + platform,
    description: 'Ce service ajoute des membres a ' + containerType + ' ' + platform + '. Un nombre eleve de membres donne une image de communaute active et attire naturellement de nouveaux membres qui veulent rejoindre un groupe populaire.',
    targetInfo: targetInfo,
    linkType: 'Lien d\'invitation ou lien public de ' + containerType + '. Le ' + (isChannel ? 'canal' : 'groupe') + ' doit etre accessible.',
    advantages: [
      'Donne une image de communaute active et populaire',
      'Attire de nouveaux membres par preuve sociale',
      'Ameliore la visibilite dans les recherches',
      'Renforce votre autorite dans votre niche'
    ],
    howItWorks: 'Collez le lien d\'invitation ou le lien public de ' + containerType + '. Les membres rejoindront progressivement. Assurez-vous que le lien est valide et que le ' + (isChannel ? 'canal' : 'groupe') + ' est accessible.'
  };
}

function buildVotes(name, platform, targetInfo) {
  return {
    title: 'Votes / Sondage - ' + platform,
    description: 'Ce service ajoute des votes sur votre sondage ou poll ' + platform + '. Utile pour orienter les resultats d\'un sondage ou montrer un engagement eleve sur vos contenus interactifs.',
    targetInfo: targetInfo,
    linkType: 'Lien de la publication contenant le sondage.',
    advantages: [
      'Augmente la participation visible a votre sondage',
      'Signal d\'engagement fort pour le contenu interactif',
      'Encourage d\'autres utilisateurs a voter aussi',
      'Montre que votre contenu genere de l\'interaction'
    ],
    howItWorks: 'Collez le lien de la publication avec le sondage et indiquez la quantite de votes souhaitee.'
  };
}

function buildTraffic(name, platform, targetInfo) {
  var isOrg = name.includes('organic') || name.includes('organique');
  var isSocial = name.includes('social');
  var isDirect = name.includes('direct');
  var isGoogle = name.includes('google');

  var sourceDesc = '';
  if (isGoogle) sourceDesc = 'Les visites proviennent de recherches Google, ameliorant votre referencement SEO.';
  else if (isSocial) sourceDesc = 'Les visites proviennent des reseaux sociaux, simulant du trafic referent.';
  else if (isOrg) sourceDesc = 'Les visites simulent du trafic organique naturel depuis differentes sources.';
  else if (isDirect) sourceDesc = 'Les visites sont de type direct (acces direct a l\'URL).';
  else sourceDesc = 'Les visites proviennent de sources variees pour un trafic diversifie.';

  return {
    title: 'Trafic Web / Visites - ' + (platform !== 'la plateforme' ? platform : 'Site web'),
    description: 'Ce service genere du trafic vers votre site web ou page. ' + sourceDesc + ' Utile pour ameliorer vos statistiques de frequentation, attirer l\'attention de partenaires ou booster le lancement d\'un projet.',
    targetInfo: targetInfo,
    linkType: 'URL complete de votre site web ou page (commencant par https://).',
    advantages: [
      'Augmente les statistiques de frequentation de votre site',
      isGoogle ? 'Ameliore le referencement naturel (SEO)' : 'Diversifie les sources de trafic',
      'Ideal pour lancer un nouveau site ou produit',
      'Signal positif pour les partenaires et annonceurs'
    ],
    howItWorks: 'Collez l\'URL de votre site web. Le trafic sera genere progressivement depuis differentes sources geographiques et navigateurs.'
  };
}

function buildStreams(name, platform, isPlaylist, targetInfo) {
  var contentType = isPlaylist ? 'votre playlist' : 'votre titre/album';

  return {
    title: 'Streams / Ecoutes - ' + platform,
    description: 'Ce service augmente le nombre d\'ecoutes/streams sur ' + contentType + ' ' + platform + '. Plus d\'ecoutes ameliorent vos chances d\'apparaitre dans les playlists algorithmiques, augmentent vos revenus par stream et renforcent votre credibilite aupres des labels et promoteurs.',
    targetInfo: targetInfo,
    linkType: 'Lien direct de ' + contentType + ' ' + platform + '.',
    advantages: [
      'Augmente vos revenus par stream',
      'Ameliore vos chances dans les playlists algorithmiques (Discover Weekly, etc.)',
      'Renforce votre credibilite aupres des labels',
      'Genere un effet boule de neige avec les algorithmes de decouverte'
    ],
    howItWorks: 'Collez le lien de ' + contentType + '. Les ecoutes seront generees progressivement pour un rendu naturel dans vos statistiques.'
  };
}

function buildEngagement(name, platform, targetInfo) {
  return {
    title: 'Pack Engagement complet - ' + platform,
    description: 'Ce service combine plusieurs types d\'interactions (likes, commentaires, partages, sauvegardes) sur votre publication ' + platform + '. Un engagement diversifie est LE signal le plus fort pour les algorithmes : il montre que votre contenu genere des reactions variees et authentiques.',
    targetInfo: targetInfo,
    linkType: 'Lien direct de la publication ' + platform + '.',
    advantages: [
      'Combine plusieurs types d\'interactions pour un impact maximal',
      'Signal le plus puissant pour les algorithmes de recommandation',
      'Simule un engagement organique naturel et diversifie',
      'Ameliore tous vos indicateurs en une seule commande'
    ],
    howItWorks: 'Collez le lien de la publication. Differents types d\'interactions seront ajoutes pour reproduire un engagement naturel et varie.'
  };
}

function buildReach(name, platform, targetInfo) {
  return {
    title: 'Portee / Reach - ' + platform,
    description: 'Ce service augmente la portee de votre contenu ' + platform + '. La portee represente le nombre de comptes uniques qui voient votre contenu, un indicateur cle de performance pour les createurs et les marques.',
    targetInfo: targetInfo,
    linkType: 'Lien de la publication ' + platform + '.',
    advantages: [
      'Augmente le nombre de comptes uniques touches',
      'Ameliore vos statistiques de performance',
      'Signal important pour les collaborations',
      'Contribue a la croissance organique'
    ],
    howItWorks: 'Collez le lien de la publication. La portee sera augmentee progressivement.'
  };
}

function buildMentions(name, platform, targetInfo) {
  return {
    title: 'Mentions / Tags - ' + platform,
    description: 'Ce service genere des mentions ou tags de votre compte ' + platform + '. Etre mentionne par d\'autres comptes augmente votre visibilite et peut attirer de nouveaux abonnes qui decouvrent votre profil a travers ces mentions.',
    targetInfo: targetInfo,
    linkType: 'Lien de votre profil ou nom d\'utilisateur ' + platform + '.',
    advantages: [
      'Augmente votre visibilite aupres de nouvelles audiences',
      'Chaque mention est un point d\'entree vers votre profil',
      'Signal de popularite pour l\'algorithme',
      'Peut generer des abonnes supplementaires'
    ],
    howItWorks: 'Indiquez votre nom d\'utilisateur ou le lien de votre profil. Les mentions seront generees dans des publications variees.'
  };
}

function buildGeneric(name, platform, targetInfo) {
  return {
    title: 'Service de Boost - ' + platform,
    description: 'Ce service ameliore vos metriques sur ' + platform + '. Concu pour renforcer votre presence en ligne et augmenter votre visibilite aupres de votre audience cible de maniere progressive et naturelle.',
    targetInfo: targetInfo,
    linkType: 'Lien de votre publication ou profil ' + platform + '. Le contenu doit etre public.',
    advantages: [
      'Ameliore votre presence en ligne',
      'Renforce votre credibilite sociale',
      'Augmente votre visibilite organique',
      'Resultat professionnel et progressif'
    ],
    howItWorks: 'Collez le lien de votre publication ou profil. Le service sera livre progressivement. Assurez-vous que votre contenu est public et accessible.'
  };
}

function detectQuality(name) {
  var badges = [];
  var details = '';

  if (name.includes('no drop') || name.includes('no-drop') || name.includes('nodrop')) {
    badges.push('<span class="q-badge q-nodrop"><i class="fas fa-shield-alt"></i> Sans baisse</span>');
    details += 'Garanti sans baisse : les resultats restent stables. ';
  }
  if (name.includes('lifetime') || name.includes('a vie') || name.includes('à vie')) {
    badges.push('<span class="q-badge q-lifetime"><i class="fas fa-infinity"></i> Garanti a vie</span>');
    details += 'Garantie a vie avec rechargement automatique en cas de baisse. ';
  }
  if (name.includes('guaranteed') || name.includes('garanti')) {
    badges.push('<span class="q-badge q-guaranteed"><i class="fas fa-certificate"></i> Garanti</span>');
  }
  if (name.includes('refill') || name.includes('r30') || name.includes('r60') || name.includes('r90') || name.includes('r365')) {
    var refillDays = '';
    if (name.includes('r30') || name.includes('30 day') || name.includes('30 jour') || name.includes('30d')) refillDays = '30 jours';
    else if (name.includes('r60') || name.includes('60 day') || name.includes('60 jour') || name.includes('60d')) refillDays = '60 jours';
    else if (name.includes('r90') || name.includes('90 day') || name.includes('90 jour') || name.includes('90d')) refillDays = '90 jours';
    else if (name.includes('r180') || name.includes('180 day') || name.includes('180 jour')) refillDays = '180 jours';
    else if (name.includes('r365') || name.includes('365 day') || name.includes('1 year') || name.includes('1 an')) refillDays = '1 an';
    var refillText = refillDays ? 'Recharge ' + refillDays : 'Avec recharge';
    badges.push('<span class="q-badge q-refill"><i class="fas fa-sync-alt"></i> ' + refillText + '</span>');
    details += refillDays ? 'Rechargement gratuit pendant ' + refillDays + ' en cas de baisse. ' : 'Rechargement gratuit en cas de baisse. ';
  }
  if (name.includes('hq') || name.includes('high quality') || name.includes('haute qualite') || name.includes('haute qualité')) {
    badges.push('<span class="q-badge q-hq"><i class="fas fa-gem"></i> Haute Qualite</span>');
    details += 'Comptes haute qualite avec photos et activite reelle. ';
  }
  if (name.includes('premium')) {
    badges.push('<span class="q-badge q-premium"><i class="fas fa-crown"></i> Premium</span>');
    details += 'Service premium : comptes verifies et resultats optimaux. ';
  }
  if (name.includes('real') && !name.includes('reel')) {
    badges.push('<span class="q-badge q-real"><i class="fas fa-user-check"></i> Comptes reels</span>');
    details += 'Comptes reels et actifs pour un engagement authentique. ';
  }
  if (name.includes('active') || name.includes('actif')) {
    badges.push('<span class="q-badge q-active"><i class="fas fa-bolt"></i> Comptes actifs</span>');
  }
  if (name.includes('instant') || name.includes('instantane') || name.includes('instantané')) {
    badges.push('<span class="q-badge q-instant"><i class="fas fa-bolt"></i> Instantane</span>');
    details += 'Livraison instantanee des les premieres minutes. ';
  }
  if (name.includes('fast') || name.includes('rapide')) {
    badges.push('<span class="q-badge q-fast"><i class="fas fa-rocket"></i> Rapide</span>');
  }
  if (name.includes('slow') || name.includes('lent') || name.includes('gradual') || name.includes('progressif') || name.includes('drip feed') || name.includes('drip-feed') || name.includes('organic') || name.includes('organique')) {
    badges.push('<span class="q-badge q-slow"><i class="fas fa-hourglass-half"></i> Progressif</span>');
    details += 'Livraison lente et progressive pour un rendu naturel et organique. ';
  }

  return { badges: badges, details: details.trim() };
}

function getPlatformDisplayName(platform) {
  var names = {
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
  try {
    var type = (serviceType || '').toLowerCase();

    var specificNote = '';
    if (type.includes('abonné') || type.includes('follower') || type.includes('abonne') || type.includes('subscriber')) {
      specificNote = 'Les abonnes peuvent connaitre une legere baisse (5-15%) dans les 48-72h suivant la livraison. C\'est normal : les plateformes verifient regulierement les comptes. Les services avec garantie "Recharge" ou "No Drop" compensent automatiquement ces baisses.';
    } else if (type.includes('like') || type.includes("j'aime") || type.includes('jaime')) {
      specificNote = 'Les likes peuvent fluctuer legerement (-5 a -10%) apres la livraison. C\'est le comportement standard des algorithmes anti-spam. Pour minimiser les baisses, evitez de commander plusieurs services de likes en meme temps sur la meme publication.';
    } else if (type.includes('vue') || type.includes('view')) {
      specificNote = 'Les compteurs de vues peuvent prendre 1 a 24h pour se mettre a jour completement. Si le compteur semble lent, patientez. Les vues sont generalement stables une fois comptabilisees.';
    } else if (type.includes('commentaire') || type.includes('comment')) {
      specificNote = 'Les commentaires peuvent etre filtres par les systemes anti-spam de la plateforme. Si certains commentaires n\'apparaissent pas, cela signifie qu\'ils ont ete interceptes. Les commentaires personnalises ont un meilleur taux de retention.';
    } else {
      specificNote = 'Les resultats peuvent connaitre de legeres variations apres la livraison. C\'est un phenomene normal lie aux mecanismes de securite des reseaux sociaux. Les services avec garantie offrent un rechargement en cas de baisse significative.';
    }

    return '<div class="drop-notice">' +
      '<div class="drop-notice-header">' +
      '<i class="fas fa-exclamation-triangle"></i>' +
      '<strong>Note importante sur les baisses</strong>' +
      '</div>' +
      '<p>' + specificNote + '</p>' +
      '<p>Consultez notre guide pour maximiser la retention de vos resultats et adopter les meilleures strategies.</p>' +
      '<a href="strategie-de-boost.html" class="drop-notice-link">' +
      '<i class="fas fa-lightbulb"></i> Consulter notre Strategie de Boost' +
      '<i class="fas fa-arrow-right"></i>' +
      '</a>' +
      '</div>';
  } catch (e) {
    console.error('Erreur getDropNotice:', e);
    return '';
  }
}
