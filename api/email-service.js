// ─────────────────────────────────────────────────────────────────
// email-service.js — Social Boost Horizon
// Basé sur Resend (https://resend.com)
// ─────────────────────────────────────────────────────────────────

const { Resend } = require('resend');

const resend   = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;
const FROM     = 'Social Boost Horizon <support@socialboosthorizon.com>';
const REPLY_TO = 'support@socialboosthorizon.com';
const ADMIN_EMAIL = 'socialboosthorizon984@gmail.com';
const SITE_URL    = 'https://socialboosthorizon.com';

// ─── Identité visuelle ───
const LOGO_URL             = 'https://raw.githubusercontent.com/exaucenapopolo/Social-Boost-Horizon-/refs/heads/main/assets/logos/Logo%20social%20Boost%20horizon.jpg';
const WHATSAPP_NUMBER      = '+1 (242) 454-2961';
const WHATSAPP_LINK        = 'https://wa.me/12424542961';
const PARTNER_TEXERRA_URL  = 'https://www.texerra.site/';
const PARTNER_TRIXHUB_URL  = 'https://www.trixhub.store/?ref=EXA0001HJB';

function fmt(n) {
  return Number(n || 0).toLocaleString('fr-FR');
}

// ─── Composants HTML réutilisables ───
function sectionTitle(text) {
  return `<div style="font-size:12px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;color:#C9A961;margin:0 0 14px;">${text}</div>`;
}

function divider() {
  return `<div style="height:1px;background:#1e2430;margin:28px 0;"></div>`;
}

function infoTable(rows) {
  const safeRows = Array.isArray(rows)
    ? rows.filter(Boolean).join('')
    : String(rows || '');
  return `<table width="100%" cellpadding="0" cellspacing="0" style="background:#0f131c;border:1px solid #1e2430;border-radius:6px;padding:6px 20px;margin:8px 0;">
    ${safeRows}
  </table>`;
}

function infoRow(label, value, valueColor) {
  return `<tr>
    <td style="padding:11px 0;border-bottom:1px solid #161c27;color:#8b93a7;font-size:13px;width:42%;">${label}</td>
    <td align="right" style="padding:11px 0;border-bottom:1px solid #161c27;color:${valueColor || '#e8eaf0'};font-size:13px;font-weight:600;">${value}</td>
  </tr>`;
}

function ctaButton(text, url, tone) {
  const bg = tone === 'green' ? '#2e7d54'
           : tone === 'red'   ? '#8a3535'
           : '#C9A961';
  const fg = tone === 'gold' || !tone ? '#0a0e17' : '#ffffff';
  return `<div style="text-align:center;margin-top:32px;">
    <a href="${url}" style="display:inline-block;background:${bg};color:${fg};text-decoration:none;font-weight:700;font-size:14px;letter-spacing:0.5px;padding:14px 36px;border-radius:6px;font-family:Arial,sans-serif;">${text}</a>
  </div>`;
}

function paragraph(text) {
  return `<p style="color:#c3c9d6;font-size:14px;line-height:1.75;margin:0 0 14px;font-family:Arial,sans-serif;">${text}</p>`;
}

function blockItem(title, description) {
  return `<div style="margin-bottom:22px;">
    <div style="color:#e8eaf0;font-size:14px;font-weight:700;letter-spacing:0.3px;margin-bottom:5px;font-family:Arial,sans-serif;">${title}</div>
    <div style="color:#8b93a7;font-size:13px;line-height:1.7;font-family:Arial,sans-serif;">${description}</div>
  </div>`;
}

// ─── En-tête commun (logo + nom de marque) ───
function header() {
  return `<tr><td align="center" style="padding:0 0 26px;">
    <img src="${LOGO_URL}" alt="Social Boost Horizon" width="60" height="60" style="display:block;border-radius:50%;border:2px solid #C9A961;">
    <div style="margin-top:12px;color:#C9A961;font-size:14px;font-weight:700;letter-spacing:2.5px;font-family:Arial,sans-serif;">SOCIAL BOOST HORIZON</div>
    <div style="margin-top:5px;color:#666e7d;font-size:10px;letter-spacing:2px;text-transform:uppercase;font-family:Arial,sans-serif;">Plateforme de croissance digitale</div>
  </td></tr>`;
}

// ─── Section partenaires (2 blocs côte à côte) ───
function partnersBlock() {
  return `<tr><td style="padding:26px 0 0;">
    <div style="color:#666e7d;font-size:10px;letter-spacing:2px;text-transform:uppercase;text-align:center;margin-bottom:14px;font-family:Arial,sans-serif;">Nos partenaires officiels</div>
    <table width="100%" cellpadding="0" cellspacing="0">
      <tr>
        <td width="50%" valign="top" style="padding-right:6px;">
          <a href="${PARTNER_TEXERRA_URL}" style="text-decoration:none;display:block;">
            <div style="border:1px solid #1e2430;border-radius:6px;padding:16px 14px;background:#0f131c;min-height:92px;">
              <div style="color:#C9A961;font-size:12px;font-weight:700;letter-spacing:1.2px;font-family:Arial,sans-serif;">TEXERRA SMS</div>
              <div style="color:#8b93a7;font-size:11px;line-height:1.55;margin-top:6px;font-family:Arial,sans-serif;">Services digitaux, SMS et solutions en ligne.</div>
              <div style="color:#4DA6FF;font-size:11px;margin-top:8px;font-weight:600;font-family:Arial,sans-serif;">texerra.site →</div>
            </div>
          </a>
        </td>
        <td width="50%" valign="top" style="padding-left:6px;">
          <a href="${PARTNER_TRIXHUB_URL}" style="text-decoration:none;display:block;">
            <div style="border:1px solid #1e2430;border-radius:6px;padding:16px 14px;background:#0f131c;min-height:92px;">
              <div style="color:#C9A961;font-size:12px;font-weight:700;letter-spacing:1.2px;font-family:Arial,sans-serif;">TRIXHUB</div>
              <div style="color:#8b93a7;font-size:11px;line-height:1.55;margin-top:6px;font-family:Arial,sans-serif;">Gagnez jusqu'à 5 000 FCFA par jour en ligne.</div>
              <div style="color:#4DA6FF;font-size:11px;margin-top:8px;font-weight:600;font-family:Arial,sans-serif;">trixhub.store →</div>
            </div>
          </a>
        </td>
      </tr>
    </table>
  </td></tr>`;
}

// ─── Pied de page commun ───
function footer() {
  return `<tr><td align="center" style="padding:28px 12px 0;">
    <div style="color:#8b93a7;font-size:12px;line-height:1.9;font-family:Arial,sans-serif;">
      Support : <a href="mailto:${REPLY_TO}" style="color:#C9A961;text-decoration:none;">${REPLY_TO}</a><br>
      WhatsApp : <a href="${WHATSAPP_LINK}" style="color:#C9A961;text-decoration:none;">${WHATSAPP_NUMBER}</a>
    </div>
    <div style="color:#3d4453;font-size:10px;margin-top:14px;font-family:Arial,sans-serif;">
      © ${new Date().getFullYear()} Social Boost Horizon — Tous droits réservés.
    </div>
  </td></tr>`;
}

// ─── Enveloppe email utilisateur ───
function userTemplate(subject, previewText, content) {
  return `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1.0"/>
<title>${subject}</title>
</head>
<body style="margin:0;padding:0;background:#0b0e17;">
<div style="display:none;max-height:0;overflow:hidden;color:transparent;">${previewText}</div>

<table width="100%" cellpadding="0" cellspacing="0" style="background:#0b0e17;padding:36px 12px;">
  <tr><td align="center">
    <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;">

      ${header()}

      <tr><td style="background:#131720;border:1px solid #1e2430;border-radius:8px;padding:38px 34px;">
        ${content}
      </td></tr>

      ${partnersBlock()}
      ${footer()}

    </table>
  </td></tr>
</table>
</body>
</html>`;
}

// ─── Enveloppe email admin ───
function adminTemplate(subject, previewText, content) {
  return `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1.0"/>
<title>${subject}</title>
</head>
<body style="margin:0;padding:0;background:#0b0e17;">
<div style="display:none;max-height:0;overflow:hidden;color:transparent;">${previewText}</div>

<table width="100%" cellpadding="0" cellspacing="0" style="background:#0b0e17;padding:36px 12px;">
  <tr><td align="center">
    <table width="660" cellpadding="0" cellspacing="0" style="max-width:660px;width:100%;">

      <tr><td align="center" style="padding:0 0 22px;">
        <img src="${LOGO_URL}" alt="Social Boost Horizon" width="52" height="52" style="display:block;border-radius:50%;border:2px solid #C9A961;">
        <div style="margin-top:10px;color:#C9A961;font-size:12px;font-weight:700;letter-spacing:2.5px;font-family:Arial,sans-serif;">ESPACE ADMINISTRATION</div>
        <div style="margin-top:4px;color:#666e7d;font-size:10px;letter-spacing:2px;font-family:Arial,sans-serif;">SOCIAL BOOST HORIZON</div>
      </td></tr>

      <tr><td style="background:#131720;border:1px solid #1e2430;border-radius:8px;padding:34px 32px;">
        ${content}
      </td></tr>

      ${footer()}

    </table>
  </td></tr>
</table>
</body>
</html>`;
}

// ═══════════════════════════════════════════════════════════════
// 1. EMAIL DE BIENVENUE
// ═══════════════════════════════════════════════════════════════
async function sendWelcomeEmail({ email, username, country }) {
  if (!resend) {
    console.warn('sendWelcomeEmail : RESEND_API_KEY non défini — email non envoyé.');
    return;
  }

  const prenom = username || (email || '').split('@')[0] || 'Cher client';

  const content = `
    <div style="font-size:20px;color:#e8eaf0;font-weight:700;margin:0 0 8px;font-family:Arial,sans-serif;">Bienvenue chez Social Boost Horizon</div>
    <div style="color:#8b93a7;font-size:13px;margin-bottom:26px;font-family:Arial,sans-serif;">Votre compte a été créé avec succès.</div>

    ${paragraph(`Bonjour ${prenom},`)}
    ${paragraph(`Nous avons le plaisir de vous confirmer l'ouverture de votre espace personnel sur Social Boost Horizon, la plateforme tout-en-un dédiée à la croissance digitale. Votre compte est désormais actif et vous pouvez commencer à utiliser l'ensemble de nos services immédiatement.`)}

    ${divider()}

    ${sectionTitle('Ce que vous pouvez faire dès maintenant')}

    ${blockItem('Commander parmi plus de 12 500 services', "Accédez à un catalogue complet couvrant 46 plateformes internationales : abonnés, likes, vues, spectateurs live, streams, comptes monétisables, logiciels et bien davantage.")}

    ${blockItem('Revendre nos services sous votre marque', "Proposez nos prestations à vos propres clients, fixez vos tarifs et développez votre activité commerciale sans nécessiter de démarche préalable auprès de notre équipe.")}

    ${blockItem('Ouvrir votre boutique personnalisée', "Créez directement sur notre plateforme une boutique à votre image, avec vos visuels, votre identité graphique et vos propres prix de vente.")}

    ${blockItem('Intégrer notre API (développeurs)', "Vous êtes développeur ou disposez déjà d'un site web ? Intégrez notre API REST documentée pour vendre nos 12 500 services depuis vos propres interfaces et automatiser vos commandes.")}

    ${blockItem('Recharger votre solde en toute simplicité', "Alimentez votre compte par Mobile Money dans 21 pays africains, par carte bancaire internationale (Visa, Mastercard, American Express) ou par PayPal.")}

    ${blockItem('Suivre vos performances en temps réel', "Consultez votre tableau de bord, l'historique détaillé de vos commandes, vos statistiques d'activité et l'état de chacune de vos livraisons.")}

    ${divider()}

    ${infoTable(
      infoRow('Titulaire du compte', prenom) +
      infoRow('Adresse email', email || '—') +
      infoRow('Pays', country || 'Non spécifié') +
      infoRow('Solde initial', '0 FCFA')
    )}

    ${paragraph(`Nous vous invitons à vous connecter à votre espace personnel pour explorer l'ensemble des fonctionnalités disponibles et effectuer votre première opération.`)}

    ${ctaButton('Accéder à mon tableau de bord', `${SITE_URL}/dashboard.html`)}

    ${paragraph(`Pour toute question ou assistance, notre équipe support reste à votre disposition 7 jours sur 7. Vous pouvez nous écrire à <a href="mailto:${REPLY_TO}" style="color:#C9A961;text-decoration:none;">${REPLY_TO}</a> ou nous joindre sur WhatsApp au <a href="${WHATSAPP_LINK}" style="color:#C9A961;text-decoration:none;">${WHATSAPP_NUMBER}</a>.`)}
  `;

  const result = await resend.emails.send({
    from:     FROM,
    to:       email,
    reply_to: REPLY_TO,
    subject:  `Bienvenue chez Social Boost Horizon — Votre compte est actif`,
    html:     userTemplate(
      'Bienvenue chez Social Boost Horizon',
      `Bonjour ${prenom}, votre compte est désormais actif.`,
      content
    )
  });

  console.log(`Email bienvenue envoyé à ${email} — id: ${result.id || 'n/a'}`);
  return result;
}

// ═══════════════════════════════════════════════════════════════
// 2. RECHARGE CONFIRMÉE
// ═══════════════════════════════════════════════════════════════
async function sendRechargeEmail({ email, username, amountXAF, originalAmount, currency, newBalance, method, transactionId }) {
  if (!resend) return;

  const displayOriginal = (currency && currency !== 'XAF' && originalAmount)
    ? `<br><span style="color:#666e7d;font-size:11px;">(équivalent à ${fmt(originalAmount)} ${currency})</span>`
    : '';

  const content = `
    <div style="font-size:20px;color:#e8eaf0;font-weight:700;margin:0 0 8px;font-family:Arial,sans-serif;">Recharge confirmée</div>
    <div style="color:#8b93a7;font-size:13px;margin-bottom:26px;font-family:Arial,sans-serif;">Votre crédit a été ajouté à votre compte.</div>

    ${paragraph(`Bonjour ${username || email},`)}
    ${paragraph(`Nous vous confirmons la bonne réception de votre paiement. Le montant indiqué ci-dessous a été crédité sur votre solde Social Boost Horizon.`)}

    <div style="background:#0f131c;border:1px solid #1e2430;border-radius:6px;padding:30px;text-align:center;margin:22px 0;">
      <div style="color:#666e7d;font-size:11px;letter-spacing:2px;text-transform:uppercase;margin-bottom:10px;font-family:Arial,sans-serif;">Montant crédité</div>
      <div style="color:#C9A961;font-size:34px;font-weight:700;font-family:Arial,sans-serif;">+ ${fmt(amountXAF)} FCFA</div>
      ${displayOriginal}
    </div>

    ${infoTable(
      infoRow('Titulaire du compte', username || email) +
      infoRow('Méthode de paiement', method || 'Mobile Money') +
      infoRow('Référence de transaction', transactionId ? `<code style="font-size:11px;color:#C9A961;">${transactionId}</code>` : '—') +
      infoRow('Nouveau solde disponible', `${fmt(newBalance)} FCFA`, '#2e7d54') +
      infoRow('Date et heure', new Date().toLocaleString('fr-FR', { timeZone: 'Africa/Douala', dateStyle: 'long', timeStyle: 'short' }))
    )}

    ${paragraph(`Votre solde est immédiatement disponible. Vous pouvez dès à présent passer vos commandes sur l'ensemble de notre catalogue.`)}

    ${ctaButton('Passer une commande', `${SITE_URL}/commander.html`)}
  `;

  try {
    await resend.emails.send({
      from: FROM, to: email, reply_to: REPLY_TO,
      subject: `Recharge confirmée — ${fmt(amountXAF)} FCFA crédités`,
      html: userTemplate('Recharge confirmée', `Votre solde a été crédité de ${fmt(amountXAF)} FCFA.`, content)
    });
    console.log(`Email recharge envoyé à ${email}`);
  } catch (err) {
    console.error('Erreur email recharge :', err.message);
  }
}

// ═══════════════════════════════════════════════════════════════
// 3. COMMANDE PASSÉE
// ═══════════════════════════════════════════════════════════════
async function sendOrderEmail({ email, username, orderId, serviceName, platform, quantity, priceXAF, newBalance, link }) {
  if (!resend) return;

  const shortLink = link ? (link.length > 45 ? link.substring(0, 42) + '...' : link) : '—';
  const historyUrl = orderId && orderId.includes('AUTO2')
    ? `${SITE_URL}/historique-avancee.html`
    : orderId && orderId.includes('AUTO')
    ? `${SITE_URL}/mes-commandes-auto.html`
    : `${SITE_URL}/commandes.html`;

  const content = `
    <div style="font-size:20px;color:#e8eaf0;font-weight:700;margin:0 0 8px;font-family:Arial,sans-serif;">Commande enregistrée</div>
    <div style="color:#8b93a7;font-size:13px;margin-bottom:26px;font-family:Arial,sans-serif;">Votre commande est en cours de traitement.</div>

    ${paragraph(`Bonjour ${username || email},`)}
    ${paragraph(`Nous vous confirmons la bonne prise en charge de votre commande. La livraison est en cours et se déroulera progressivement selon le volume commandé.`)}

    <div style="background:#0f131c;border:1px solid #1e2430;border-radius:6px;padding:22px;text-align:center;margin:22px 0;">
      <div style="color:#666e7d;font-size:11px;letter-spacing:2px;text-transform:uppercase;margin-bottom:6px;font-family:Arial,sans-serif;">Numéro de commande</div>
      <div style="color:#C9A961;font-size:19px;font-weight:700;letter-spacing:1px;font-family:Arial,sans-serif;">${orderId}</div>
      <div style="color:#4DA6FF;font-size:11px;margin-top:8px;font-weight:600;letter-spacing:1px;font-family:Arial,sans-serif;">EN COURS DE TRAITEMENT</div>
    </div>

    ${infoTable(
      infoRow('Service commandé', serviceName) +
      (platform ? infoRow('Plateforme', platform) : '') +
      infoRow('Quantité', `${fmt(quantity)} unités`) +
      infoRow('Coût débité', `${fmt(priceXAF)} FCFA`, '#8a3535') +
      infoRow('Solde restant', `${fmt(newBalance)} FCFA`, '#2e7d54') +
      infoRow('Lien ciblé', `<span style="font-size:11px;word-break:break-all;">${shortLink}</span>`) +
      infoRow('Date et heure', new Date().toLocaleString('fr-FR', { timeZone: 'Africa/Douala', dateStyle: 'long', timeStyle: 'short' }))
    )}

    ${sectionTitle('Recommandations')}

    ${paragraph(`La livraison étant progressive, nous vous invitons à ne pas modifier votre contenu (profil, publication, lien) pendant toute la durée du traitement. Toute modification pourrait interrompre ou fausser la livraison.`)}

    ${ctaButton('Suivre ma commande', historyUrl)}
  `;

  try {
    await resend.emails.send({
      from: FROM, to: email, reply_to: REPLY_TO,
      subject: `Commande ${orderId} — Enregistrée avec succès`,
      html: userTemplate('Commande enregistrée', `Votre commande ${orderId} est en cours de livraison.`, content)
    });
    console.log(`Email commande envoyé à ${email}`);
  } catch (err) {
    console.error('Erreur email commande :', err.message);
  }
}

// ═══════════════════════════════════════════════════════════════
// 4. DEMANDE DE RETRAIT
// ═══════════════════════════════════════════════════════════════
async function sendWithdrawalRequestEmail({ email, username, amount, phoneNumber, method, withdrawalId }) {
  if (!resend) return;

  const content = `
    <div style="font-size:20px;color:#e8eaf0;font-weight:700;margin:0 0 8px;font-family:Arial,sans-serif;">Demande de retrait reçue</div>
    <div style="color:#8b93a7;font-size:13px;margin-bottom:26px;font-family:Arial,sans-serif;">Votre demande est en cours de traitement.</div>

    ${paragraph(`Bonjour ${username || email},`)}
    ${paragraph(`Nous vous informons que votre demande de retrait a bien été enregistrée par notre équipe. Elle sera traitée dans un délai maximum de 24 heures ouvrées.`)}

    <div style="background:#0f131c;border:1px solid #1e2430;border-radius:6px;padding:30px;text-align:center;margin:22px 0;">
      <div style="color:#666e7d;font-size:11px;letter-spacing:2px;text-transform:uppercase;margin-bottom:10px;font-family:Arial,sans-serif;">Montant demandé</div>
      <div style="color:#C9A961;font-size:34px;font-weight:700;font-family:Arial,sans-serif;">${fmt(amount)} FCFA</div>
    </div>

    ${infoTable(
      infoRow('Titulaire du compte', username || email) +
      infoRow('Numéro de réception', phoneNumber) +
      infoRow('Méthode', method || 'Mobile Money') +
      infoRow('Référence de la demande', withdrawalId ? `<code style="font-size:11px;color:#C9A961;">${withdrawalId}</code>` : '—') +
      infoRow('Date de la demande', new Date().toLocaleString('fr-FR', { timeZone: 'Africa/Douala', dateStyle: 'long', timeStyle: 'short' })) +
      infoRow('Délai de traitement', 'Sous 24 heures', '#C9A961')
    )}

    ${paragraph(`Aucune action supplémentaire n'est requise de votre part. Vous recevrez un nouveau message dès validation et exécution du paiement.`)}

    ${ctaButton('Retour au tableau de bord', `${SITE_URL}/dashboard.html`)}
  `;

  try {
    await resend.emails.send({
      from: FROM, to: email, reply_to: REPLY_TO,
      subject: `Demande de retrait de ${fmt(amount)} FCFA enregistrée`,
      html: userTemplate('Demande de retrait', `Votre retrait de ${fmt(amount)} FCFA est en cours de traitement.`, content)
    });
    console.log(`Email retrait demandé envoyé à ${email}`);
  } catch (err) {
    console.error('Erreur email retrait demandé :', err.message);
  }
}

// ═══════════════════════════════════════════════════════════════
// 5. RETRAIT APPROUVÉ
// ═══════════════════════════════════════════════════════════════
async function sendWithdrawalApprovedEmail({ email, username, amount, phoneNumber, method, note }) {
  if (!resend) return;

  const content = `
    <div style="font-size:20px;color:#e8eaf0;font-weight:700;margin:0 0 8px;font-family:Arial,sans-serif;">Retrait approuvé</div>
    <div style="color:#8b93a7;font-size:13px;margin-bottom:26px;font-family:Arial,sans-serif;">Votre paiement a été exécuté avec succès.</div>

    ${paragraph(`Bonjour ${username || email},`)}
    ${paragraph(`Nous avons le plaisir de vous confirmer que votre demande de retrait a été approuvée et que le paiement correspondant a été exécuté.`)}

    <div style="background:#0f131c;border:1px solid #1e2430;border-radius:6px;padding:30px;text-align:center;margin:22px 0;">
      <div style="color:#666e7d;font-size:11px;letter-spacing:2px;text-transform:uppercase;margin-bottom:10px;font-family:Arial,sans-serif;">Montant versé</div>
      <div style="color:#2e7d54;font-size:34px;font-weight:700;font-family:Arial,sans-serif;">${fmt(amount)} FCFA</div>
      <div style="color:#8b93a7;font-size:12px;margin-top:10px;letter-spacing:1px;font-family:Arial,sans-serif;">PAIEMENT EFFECTUÉ</div>
    </div>

    ${infoTable(
      infoRow('Bénéficiaire', username || email) +
      infoRow('Numéro de réception', phoneNumber) +
      infoRow('Méthode', method || 'Mobile Money') +
      (note ? infoRow('Note administrative', note) : '') +
      infoRow("Date d'approbation", new Date().toLocaleString('fr-FR', { timeZone: 'Africa/Douala', dateStyle: 'long', timeStyle: 'short' }))
    )}

    ${ctaButton('Retour au tableau de bord', `${SITE_URL}/dashboard.html`, 'green')}
  `;

  try {
    await resend.emails.send({
      from: FROM, to: email, reply_to: REPLY_TO,
      subject: `Retrait de ${fmt(amount)} FCFA approuvé et payé`,
      html: userTemplate('Retrait approuvé', `Votre retrait de ${fmt(amount)} FCFA a été payé.`, content)
    });
    console.log(`Email retrait approuvé envoyé à ${email}`);
  } catch (err) {
    console.error('Erreur email retrait approuvé :', err.message);
  }
}

// ═══════════════════════════════════════════════════════════════
// 6. RETRAIT REJETÉ
// ═══════════════════════════════════════════════════════════════
async function sendWithdrawalRejectedEmail({ email, username, amount, note }) {
  if (!resend) return;

  const content = `
    <div style="font-size:20px;color:#e8eaf0;font-weight:700;margin:0 0 8px;font-family:Arial,sans-serif;">Demande de retrait non validée</div>
    <div style="color:#8b93a7;font-size:13px;margin-bottom:26px;font-family:Arial,sans-serif;">Le montant a été automatiquement réintégré à votre solde.</div>

    ${paragraph(`Bonjour ${username || email},`)}
    ${paragraph(`Après examen, votre demande de retrait n'a pas pu être validée. Le montant concerné a été immédiatement réintégré à votre solde Social Boost Horizon, sans perte ni frais.`)}

    <div style="background:#0f131c;border:1px solid #1e2430;border-radius:6px;padding:30px;text-align:center;margin:22px 0;">
      <div style="color:#666e7d;font-size:11px;letter-spacing:2px;text-transform:uppercase;margin-bottom:10px;font-family:Arial,sans-serif;">Montant concerné</div>
      <div style="color:#8a3535;font-size:34px;font-weight:700;font-family:Arial,sans-serif;">${fmt(amount)} FCFA</div>
      <div style="color:#8b93a7;font-size:12px;margin-top:10px;letter-spacing:1px;font-family:Arial,sans-serif;">MONTANT RÉINTÉGRÉ À VOTRE SOLDE</div>
    </div>

    ${infoTable(
      infoRow('Titulaire du compte', username || email) +
      infoRow('Montant concerné', `${fmt(amount)} FCFA`) +
      (note ? infoRow('Motif communiqué', note) : '') +
      infoRow('Date', new Date().toLocaleString('fr-FR', { timeZone: 'Africa/Douala', dateStyle: 'long', timeStyle: 'short' }))
    )}

    ${paragraph(`Pour toute question concernant cette décision, notre équipe support reste joignable à l'adresse <a href="mailto:${REPLY_TO}" style="color:#C9A961;text-decoration:none;">${REPLY_TO}</a>.`)}

    ${ctaButton('Retour au tableau de bord', `${SITE_URL}/dashboard.html`, 'red')}
  `;

  try {
    await resend.emails.send({
      from: FROM, to: email, reply_to: REPLY_TO,
      subject: `Demande de retrait de ${fmt(amount)} FCFA non validée`,
      html: userTemplate('Retrait non validé', `Votre demande de retrait a été rejetée. Solde réintégré.`, content)
    });
    console.log(`Email retrait rejeté envoyé à ${email}`);
  } catch (err) {
    console.error('Erreur email retrait rejeté :', err.message);
  }
}

// ═══════════════════════════════════════════════════════════════
// 7. CANDIDATURE PARTENARIAT (admin)
// ═══════════════════════════════════════════════════════════════
async function sendPartnershipEmail({ name, email, whatsapp, type, message, requestId }) {
  if (!resend) {
    console.warn('sendPartnershipEmail : RESEND_API_KEY non défini — email non envoyé.');
    return;
  }

  const cleanWhatsapp = String(whatsapp || '').replace(/[^0-9]/g, '');
  const waLink = cleanWhatsapp ? `https://wa.me/${cleanWhatsapp}` : null;
  const safeMessage = String(message || '').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br>');

  const content = `
    <div style="font-size:20px;color:#e8eaf0;font-weight:700;margin:0 0 8px;font-family:Arial,sans-serif;">Nouvelle candidature partenariat</div>
    <div style="color:#8b93a7;font-size:13px;margin-bottom:26px;font-family:Arial,sans-serif;">Soumise depuis la page partenariat du site.</div>

    ${infoTable(
      infoRow('Nom / Raison sociale', name) +
      infoRow('Email professionnel', `<a href="mailto:${email}" style="color:#C9A961;text-decoration:none;">${email}</a>`) +
      infoRow('WhatsApp', waLink ? `<a href="${waLink}" style="color:#C9A961;text-decoration:none;">${whatsapp}</a>` : whatsapp) +
      infoRow('Cadre envisagé', type, '#C9A961') +
      infoRow('Référence dossier', requestId ? `<code style="font-size:11px;color:#C9A961;">${requestId}</code>` : '—') +
      infoRow('Date de réception', new Date().toLocaleString('fr-FR', { timeZone: 'Africa/Douala', dateStyle: 'long', timeStyle: 'short' }))
    )}

    <div style="margin-top:24px;">
      ${sectionTitle('Présentation du projet')}
      <div style="background:#0f131c;border:1px solid #1e2430;border-radius:6px;padding:20px 22px;color:#c3c9d6;font-size:13px;line-height:1.75;font-family:Arial,sans-serif;white-space:normal;">${safeMessage}</div>
    </div>

    <div style="margin-top:24px;padding:14px 18px;background:#0f131c;border:1px solid #1e2430;border-radius:6px;">
      <div style="color:#C9A961;font-size:11px;font-weight:700;letter-spacing:1.2px;margin-bottom:6px;font-family:Arial,sans-serif;">ACTION ATTENDUE</div>
      <div style="color:#8b93a7;font-size:12px;line-height:1.65;font-family:Arial,sans-serif;">Répondre au candidat sous 24 à 48 heures ouvrées, conformément à l'engagement affiché publiquement sur la page partenariat.</div>
    </div>

    ${waLink ? `<div style="text-align:center;margin-top:26px;">
      <a href="${waLink}" style="display:inline-block;background:#2e7d54;color:#fff;text-decoration:none;font-weight:700;font-size:13px;letter-spacing:0.5px;padding:13px 30px;border-radius:6px;font-family:Arial,sans-serif;">Contacter le candidat sur WhatsApp</a>
    </div>` : ''}
  `;

  await resend.emails.send({
    from: FROM,
    to: ADMIN_EMAIL,
    reply_to: email,
    subject: `Nouvelle candidature partenariat — ${name} (${type})`,
    html: adminTemplate('Nouvelle candidature partenariat', `De ${name} — ${type}`, content)
  });

  console.log(`Email partenariat envoyé à ${ADMIN_EMAIL} (candidat : ${email})`);
}

// ═══════════════════════════════════════════════════════════════
// EXPORTS
// ═══════════════════════════════════════════════════════════════
module.exports = {
  sendWelcomeEmail,
  sendRechargeEmail,
  sendOrderEmail,
  sendWithdrawalRequestEmail,
  sendWithdrawalApprovedEmail,
  sendWithdrawalRejectedEmail,
  sendPartnershipEmail,
};
