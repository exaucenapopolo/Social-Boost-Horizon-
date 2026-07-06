// ─────────────────────────────────────────────────────────────────
// email-service.js — Social Boost Horizon
// Basé sur Resend (https://resend.com)
//
// PRÉREQUIS OBLIGATOIRE :
//   Votre domaine doit être vérifié sur https://resend.com/domains
//   Si le domaine n'est pas vérifié, AUCUN email ne part et
//   l'erreur est silencieuse côté client.
//
//   Pour tester sans domaine vérifié, remplacez FROM par :
//   const FROM = 'Social Boost Horizon <onboarding@resend.dev>';
//   (limité à votre propre adresse email uniquement)
// ─────────────────────────────────────────────────────────────────

const { Resend } = require('resend');

const resend   = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;
const FROM     = 'Social Boost Horizon <support@socialboosthorizon.com>';
const REPLY_TO = 'support@socialboosthorizon.com';
const ADMIN_EMAIL = 'socialboosthorizon984@gmail.com';
const SITE_URL    = 'https://socialboosthorizon.com';

function fmt(n) {
  return Number(n || 0).toLocaleString('fr-FR');
}

function baseTemplate(title, previewText, bodyContent) {
  return `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1.0"/>
<title>${title}</title>
</head>
<body style="margin:0;padding:0;background:#0b0b1a;font-family:'Segoe UI',Arial,sans-serif;">
<div style="display:none;max-height:0;overflow:hidden;">${previewText}</div>

<table width="100%" cellpadding="0" cellspacing="0" style="background:#0b0b1a;padding:30px 10px;">
  <tr><td align="center">
    <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;">

      <!-- HEADER -->
      <tr><td style="background:linear-gradient(135deg,#1a0a3e 0%,#0d1b3e 100%);border-radius:16px 16px 0 0;padding:32px 40px;text-align:center;border-bottom:2px solid rgba(139,92,246,0.4);">
        <div style="font-size:28px;font-weight:900;letter-spacing:1px;">
          <span style="color:#8B5CF6;">Social</span>
          <span style="color:#06B6D4;"> Boost</span>
          <span style="background:linear-gradient(90deg,#f59e0b,#fbbf24);-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text;"> Horizon</span>
        </div>
        <div style="color:rgba(255,255,255,0.45);font-size:12px;margin-top:6px;letter-spacing:2px;text-transform:uppercase;">La plateforme de croissance social</div>
      </td></tr>

      <!-- BODY -->
      <tr><td style="background:linear-gradient(180deg,#120d2a 0%,#0f1a30 100%);padding:40px;border-left:1px solid rgba(139,92,246,0.15);border-right:1px solid rgba(139,92,246,0.15);">
        ${bodyContent}
      </td></tr>

      <!-- FOOTER -->
      <tr><td style="background:#080814;border-radius:0 0 16px 16px;padding:24px 40px;text-align:center;border:1px solid rgba(139,92,246,0.1);border-top:none;">
        <div style="margin-bottom:16px;">
          <a href="${SITE_URL}/dashboard.html" style="color:#8B5CF6;text-decoration:none;font-size:13px;margin:0 10px;">Dashboard</a>
          <a href="${SITE_URL}/commander.html" style="color:#8B5CF6;text-decoration:none;font-size:13px;margin:0 10px;">Commander</a>
          <a href="${SITE_URL}/fonds.html" style="color:#8B5CF6;text-decoration:none;font-size:13px;margin:0 10px;">Recharger</a>
        </div>
        <div style="margin-bottom:14px;">
          <a href="https://wa.me/56927785730" style="display:inline-block;background:linear-gradient(135deg,#16a34a,#15803d);color:#fff;text-decoration:none;padding:10px 24px;border-radius:50px;font-size:13px;font-weight:700;">
            📲 Support WhatsApp : +56 9 2778 5730
          </a>
        </div>
        <div style="background:rgba(6,182,212,0.07);border:1px solid rgba(6,182,212,0.2);border-radius:10px;padding:12px 16px;margin-bottom:14px;text-align:center;">
          <div style="color:#22d3ee;font-size:12px;font-weight:700;margin-bottom:4px;">🌐 Vous cherchez un numéro étranger ?</div>
          <div style="color:rgba(255,255,255,0.55);font-size:12px;line-height:1.6;margin-bottom:8px;">Notre partenaire a ce qu'il vous faut — rapide et fiable.</div>
          <a href="https://texerra.site" style="color:#06b6d4;text-decoration:none;font-size:12px;font-weight:700;">👉 Consulter texerra.site</a>
        </div>
        <div style="color:rgba(255,255,255,0.3);font-size:11px;line-height:1.6;">
          &copy; ${new Date().getFullYear()} Social Boost Horizon. Tous droits réservés.<br/>
          <a href="mailto:${REPLY_TO}" style="color:#8B5CF6;text-decoration:none;">${REPLY_TO}</a>
        </div>
      </td></tr>

    </table>
  </td></tr>
</table>
</body>
</html>`;
}

function adminTemplate(title, previewText, bodyContent) {
  return `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1.0"/>
<title>${title}</title>
</head>
<body style="margin:0;padding:0;background:#0a0a14;font-family:'Segoe UI',Arial,sans-serif;">
<div style="display:none;max-height:0;overflow:hidden;">${previewText}</div>
<table width="100%" cellpadding="0" cellspacing="0" style="background:#0a0a14;padding:20px 10px;">
  <tr><td align="center">
    <table width="680" cellpadding="0" cellspacing="0" style="max-width:680px;width:100%;">
      <tr><td style="background:linear-gradient(135deg,#1a0a3e 0%,#0a1a3e 100%);border-radius:16px 16px 0 0;padding:28px 36px;text-align:center;border-bottom:3px solid rgba(139,92,246,0.5);">
        <div style="font-size:11px;letter-spacing:3px;text-transform:uppercase;color:rgba(255,255,255,0.4);margin-bottom:8px;">ESPACE ADMIN — SOCIAL BOOST HORIZON</div>
        <div style="font-size:24px;font-weight:900;">
          <span style="color:#8B5CF6;">📊</span>
          <span style="color:#fff;"> ${title}</span>
        </div>
        <div style="color:rgba(255,255,255,0.4);font-size:12px;margin-top:6px;">${previewText}</div>
      </td></tr>
      <tr><td style="background:linear-gradient(180deg,#0f0c24 0%,#0a1020 100%);padding:32px 36px;border-left:1px solid rgba(139,92,246,0.12);border-right:1px solid rgba(139,92,246,0.12);">
        ${bodyContent}
      </td></tr>
      <tr><td style="background:#060610;border-radius:0 0 16px 16px;padding:20px 36px;text-align:center;border:1px solid rgba(139,92,246,0.08);border-top:none;">
        <div style="margin-bottom:12px;">
          <a href="https://wa.me/56927785730" style="display:inline-block;background:linear-gradient(135deg,#16a34a,#15803d);color:#fff;text-decoration:none;padding:8px 20px;border-radius:50px;font-size:12px;font-weight:700;">
            📲 Support WhatsApp : +56 9 2778 5730
          </a>
        </div>
        <div style="background:rgba(6,182,212,0.06);border:1px solid rgba(6,182,212,0.15);border-radius:8px;padding:10px 14px;margin-bottom:12px;">
          <div style="color:#22d3ee;font-size:11px;font-weight:700;margin-bottom:3px;">🌐 Vous cherchez un numéro étranger ?</div>
          <div style="color:rgba(255,255,255,0.4);font-size:11px;margin-bottom:5px;">Notre partenaire a ce qu'il vous faut — rapide et fiable.</div>
          <a href="https://texerra.site" style="color:#06b6d4;text-decoration:none;font-size:11px;font-weight:700;">👉 Consulter texerra.site</a>
        </div>
        <div style="color:rgba(255,255,255,0.25);font-size:11px;">
          Rapport généré automatiquement — Social Boost Horizon<br/>
          <a href="mailto:${REPLY_TO}" style="color:#8B5CF6;">${REPLY_TO}</a>
        </div>
      </td></tr>
    </table>
  </td></tr>
</table>
</body>
</html>`;
}

function badge(text, color) {
  const colors = {
    purple: { bg: 'rgba(139,92,246,0.15)', border: 'rgba(139,92,246,0.4)', text: '#a78bfa' },
    cyan:   { bg: 'rgba(6,182,212,0.15)',  border: 'rgba(6,182,212,0.4)',  text: '#22d3ee' },
    green:  { bg: 'rgba(16,185,129,0.15)', border: 'rgba(16,185,129,0.4)', text: '#34d399' },
    gold:   { bg: 'rgba(245,158,11,0.15)', border: 'rgba(245,158,11,0.4)', text: '#fbbf24' },
    red:    { bg: 'rgba(239,68,68,0.15)',  border: 'rgba(239,68,68,0.4)',  text: '#f87171' },
  };
  const c = colors[color] || colors.purple;
  return `<span style="display:inline-block;background:${c.bg};border:1px solid ${c.border};color:${c.text};border-radius:20px;padding:4px 14px;font-size:12px;font-weight:700;letter-spacing:0.5px;">${text}</span>`;
}

function infoRow(icon, label, value, valueColor) {
  return `<tr>
    <td style="padding:10px 0;border-bottom:1px solid rgba(255,255,255,0.05);">
      <table width="100%" cellpadding="0" cellspacing="0"><tr>
        <td style="color:rgba(255,255,255,0.5);font-size:13px;">${icon} ${label}</td>
        <td align="right" style="color:${valueColor || '#e2e8f0'};font-size:13px;font-weight:600;">${value}</td>
      </tr></table>
    </td>
  </tr>`;
}

function ctaButton(text, url, color) {
  const bg = color === 'green' ? 'linear-gradient(135deg,#10b981,#059669)'
           : color === 'gold'  ? 'linear-gradient(135deg,#f59e0b,#d97706)'
           : color === 'red'   ? 'linear-gradient(135deg,#ef4444,#dc2626)'
           : 'linear-gradient(135deg,#8B5CF6,#6d28d9)';
  return `<div style="text-align:center;margin-top:28px;">
    <a href="${url}" style="display:inline-block;background:${bg};color:#fff;text-decoration:none;font-weight:700;font-size:15px;padding:14px 36px;border-radius:50px;letter-spacing:0.5px;box-shadow:0 4px 20px rgba(139,92,246,0.35);">${text}</a>
  </div>`;
}

function infoCard(rows) {
  return `<table width="100%" cellpadding="0" cellspacing="0" style="background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.08);border-radius:12px;padding:4px 20px;margin:20px 0;">
    ${rows}
  </table>`;
}

function adminSection(title, color, content) {
  const colors = {
    blue:   { border: 'rgba(6,182,212,0.4)',   bg: 'rgba(6,182,212,0.06)',   text: '#22d3ee' },
    purple: { border: 'rgba(139,92,246,0.4)',  bg: 'rgba(139,92,246,0.06)',  text: '#a78bfa' },
    yellow: { border: 'rgba(245,158,11,0.4)',  bg: 'rgba(245,158,11,0.06)', text: '#fbbf24' },
    green:  { border: 'rgba(16,185,129,0.4)',  bg: 'rgba(16,185,129,0.06)',  text: '#34d399' },
    orange: { border: 'rgba(249,115,22,0.4)',  bg: 'rgba(249,115,22,0.06)',  text: '#fb923c' },
    gift:   { border: 'rgba(236,72,153,0.4)',  bg: 'rgba(236,72,153,0.06)',  text: '#f472b6' },
  };
  const c = colors[color] || colors.purple;
  return `<div style="border:1px solid ${c.border};background:${c.bg};border-radius:12px;padding:20px 24px;margin-bottom:20px;">
    <div style="font-size:15px;font-weight:800;color:${c.text};margin-bottom:14px;">${title}</div>
    ${content}
  </div>`;
}

function adminRow(label, value, valueColor, bold) {
  return `<div style="display:flex;justify-content:space-between;align-items:center;padding:7px 0;border-bottom:1px solid rgba(255,255,255,0.04);">
    <span style="color:rgba(255,255,255,0.55);font-size:13px;">${label}</span>
    <span style="color:${valueColor || '#e2e8f0'};font-size:13px;font-weight:${bold ? '700' : '500'};">${value}</span>
  </div>`;
}

function statBox(value, label, color) {
  return `<td align="center" style="padding:12px 8px;">
    <div style="background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.08);border-radius:10px;padding:14px 10px;">
      <div style="font-size:24px;font-weight:900;color:${color};">${value}</div>
      <div style="font-size:11px;color:rgba(255,255,255,0.4);margin-top:4px;">${label}</div>
    </div>
  </td>`;
}

// ─────────────────────────────────────────────────────────────────
// 1. EMAIL DE BIENVENUE
//
// FIX : la fonction lève maintenant une vraie erreur si Resend
//       échoue, au lieu de l'avaler silencieusement.
//       index.js capture cette erreur et log un message clair.
// ─────────────────────────────────────────────────────────────────
async function sendWelcomeEmail({ email, username, country }) {
  if (!resend) {
    console.warn('⚠️ sendWelcomeEmail : RESEND_API_KEY non défini — email non envoyé.');
    return;
  }

  const body = `
    <h2 style="color:#fff;font-size:22px;font-weight:700;margin:0 0 8px;">Bienvenue sur Social Boost Horizon ! 🎉</h2>
    <p style="color:rgba(255,255,255,0.6);font-size:14px;margin:0 0 28px;">Ton compte a été créé avec succès. Tu rejoins des milliers d'utilisateurs qui boostent leur présence en ligne.</p>

    <div style="background:linear-gradient(135deg,rgba(139,92,246,0.12),rgba(6,182,212,0.08));border:1px solid rgba(139,92,246,0.25);border-radius:14px;padding:24px;margin-bottom:24px;">
      <div style="font-size:16px;font-weight:700;color:#c4b5fd;margin-bottom:16px;">👤 Ton compte</div>
      ${infoCard(`
        ${infoRow('🧑', 'Nom', username)}
        ${infoRow('📧', 'Email', email)}
        ${infoRow('🌍', 'Pays', country || 'Non spécifié')}
      `)}
    </div>

    <div style="background:rgba(16,185,129,0.08);border:1px solid rgba(16,185,129,0.2);border-radius:12px;padding:20px;margin-bottom:24px;">
      <div style="font-size:14px;font-weight:700;color:#34d399;margin-bottom:12px;">🚀 Comment démarrer ?</div>
      <div style="color:rgba(255,255,255,0.65);font-size:13px;line-height:1.8;">
        <div style="margin-bottom:8px;">💳 <strong style="color:#e2e8f0;">1. Rechargez votre compte</strong> — Déposez du crédit via Mobile Money</div>
        <div style="margin-bottom:8px;">🛒 <strong style="color:#e2e8f0;">2. Choisissez un service</strong> — Followers, Likes, Vues et bien plus</div>
        <div style="margin-bottom:8px;">⚡ <strong style="color:#e2e8f0;">3. Passez votre commande</strong> — Livraison rapide et automatique</div>
        <div>📊 <strong style="color:#e2e8f0;">4. Suivez vos résultats</strong> — Historique en temps réel</div>
      </div>
    </div>

    <div style="background:rgba(245,158,11,0.08);border:1px solid rgba(245,158,11,0.2);border-radius:12px;padding:16px;margin-bottom:28px;text-align:center;">
      <div style="color:#fbbf24;font-size:13px;font-weight:600;">💎 Programme Revendeur disponible</div>
      <div style="color:rgba(255,255,255,0.55);font-size:12px;margin-top:4px;">Commandez en volume et bénéficiez de remises allant jusqu'à 15%</div>
    </div>

    ${ctaButton('🚀 Accéder à mon Dashboard', `${SITE_URL}/dashboard.html`, 'purple')}
  `;

  // FIX : on laisse l'erreur remonter au lieu de l'avaler.
  // index.js la capture et log un message clair avec la cause exacte.
  const result = await resend.emails.send({
    from:     FROM,
    to:       email,
    reply_to: REPLY_TO,
    subject:  `Bienvenue ${username} sur Social Boost Horizon ! 🎉`,
    html:     baseTemplate(
      'Bienvenue sur Social Boost Horizon',
      `Bienvenue ${username} ! Votre compte est prêt.`,
      body
    )
  });

  console.log(`📧 Email bienvenue envoyé à ${email} — id: ${result.id || 'n/a'}`);
  return result;
}

// ─────────────────────────────────────────────
// 2. RECHARGE CONFIRMÉE
// ─────────────────────────────────────────────
async function sendRechargeEmail({ email, username, amountXAF, originalAmount, currency, newBalance, method, transactionId }) {
  if (!resend) return;
  const displayOriginal = (currency && currency !== 'XAF' && originalAmount)
    ? `<br/><span style="color:rgba(255,255,255,0.4);font-size:11px;">(${fmt(originalAmount)} ${currency})</span>`
    : '';
  const body = `
    <div style="text-align:center;margin-bottom:28px;">
      <div style="width:64px;height:64px;background:linear-gradient(135deg,rgba(16,185,129,0.2),rgba(6,182,212,0.1));border:2px solid rgba(16,185,129,0.4);border-radius:50%;margin:0 auto 16px;line-height:64px;font-size:28px;">✅</div>
      <h2 style="color:#fff;font-size:22px;font-weight:700;margin:0 0 6px;">Recharge Confirmée !</h2>
      <p style="color:rgba(255,255,255,0.55);font-size:14px;margin:0;">Votre crédit a bien été ajouté à votre compte.</p>
    </div>
    <div style="background:linear-gradient(135deg,rgba(16,185,129,0.1),rgba(6,182,212,0.05));border:1px solid rgba(16,185,129,0.3);border-radius:14px;padding:28px;text-align:center;margin-bottom:24px;">
      <div style="color:rgba(255,255,255,0.5);font-size:12px;text-transform:uppercase;letter-spacing:1px;margin-bottom:8px;">Montant crédité</div>
      <div style="font-size:38px;font-weight:900;color:#34d399;">+${fmt(amountXAF)} <span style="font-size:20px;">FCFA</span></div>
      ${displayOriginal}
    </div>
    ${infoCard(`
      ${infoRow('👤', 'Compte', username || email)}
      ${infoRow('💳', 'Méthode', method || 'Mobile Money')}
      ${infoRow('📋', 'Référence', transactionId ? `<code style="font-size:11px;color:#a78bfa;">${transactionId}</code>` : '—', '#a78bfa')}
      ${infoRow('💰', 'Nouveau solde', `${fmt(newBalance)} FCFA`, '#34d399')}
      ${infoRow('📅', 'Date', new Date().toLocaleString('fr-FR', { timeZone: 'Africa/Douala', dateStyle: 'medium', timeStyle: 'short' }))}
    `)}
    <div style="background:rgba(139,92,246,0.08);border-radius:10px;padding:14px 18px;margin-top:20px;text-align:center;">
      <span style="color:rgba(255,255,255,0.55);font-size:13px;">Votre solde est disponible immédiatement pour passer vos commandes.</span>
    </div>
    ${ctaButton('🛒 Commander maintenant', `${SITE_URL}/commander.html`, 'green')}
  `;
  try {
    await resend.emails.send({ from: FROM, to: email, reply_to: REPLY_TO,
      subject: `✅ Recharge de ${fmt(amountXAF)} FCFA confirmée`,
      html: baseTemplate('Recharge confirmée', `+${fmt(amountXAF)} FCFA ajoutés à votre compte.`, body)
    });
    console.log(`📧 Email recharge envoyé à ${email}`);
  } catch (err) {
    console.error('❌ Erreur email recharge:', err.message);
  }
}

// ─────────────────────────────────────────────
// 3. COMMANDE PASSÉE
// ─────────────────────────────────────────────
async function sendOrderEmail({ email, username, orderId, serviceName, platform, quantity, priceXAF, newBalance, link }) {
  if (!resend) return;
  const shortLink = link ? (link.length > 45 ? link.substring(0, 42) + '...' : link) : '—';
  const historyUrl = orderId && orderId.includes('AUTO2')
    ? `${SITE_URL}/historique-avancee.html`
    : orderId && orderId.includes('AUTO')
    ? `${SITE_URL}/mes-commandes-auto.html`
    : `${SITE_URL}/commandes.html`;
  const body = `
    <div style="text-align:center;margin-bottom:28px;">
      <div style="width:64px;height:64px;background:linear-gradient(135deg,rgba(139,92,246,0.2),rgba(6,182,212,0.1));border:2px solid rgba(139,92,246,0.4);border-radius:50%;margin:0 auto 16px;line-height:64px;font-size:28px;">🛒</div>
      <h2 style="color:#fff;font-size:22px;font-weight:700;margin:0 0 6px;">Commande Passée avec Succès !</h2>
      <p style="color:rgba(255,255,255,0.55);font-size:14px;margin:0;">Votre commande est en cours de traitement. La livraison démarre sous peu.</p>
    </div>
    <div style="background:linear-gradient(135deg,rgba(139,92,246,0.1),rgba(6,182,212,0.05));border:1px solid rgba(139,92,246,0.25);border-radius:14px;padding:24px;margin-bottom:20px;text-align:center;">
      <div style="color:rgba(255,255,255,0.4);font-size:11px;text-transform:uppercase;letter-spacing:1px;margin-bottom:6px;">Numéro de commande</div>
      <div style="font-size:22px;font-weight:900;color:#a78bfa;letter-spacing:1px;">${orderId}</div>
      <div style="margin-top:10px;">${badge('⚡ En cours de traitement', 'purple')}</div>
    </div>
    ${infoCard(`
      ${infoRow('🔧', 'Service', serviceName)}
      ${platform ? infoRow('📱', 'Plateforme', platform) : ''}
      ${infoRow('🔢', 'Quantité', `${fmt(quantity)} unités`)}
      ${infoRow('💵', 'Coût débité', `${fmt(priceXAF)} FCFA`, '#f87171')}
      ${infoRow('💰', 'Solde restant', `${fmt(newBalance)} FCFA`, '#34d399')}
      ${infoRow('🔗', 'Lien', `<span style="font-size:11px;word-break:break-all;">${shortLink}</span>`)}
      ${infoRow('📅', 'Date', new Date().toLocaleString('fr-FR', { timeZone: 'Africa/Douala', dateStyle: 'medium', timeStyle: 'short' }))}
    `)}
    <div style="background:rgba(245,158,11,0.07);border:1px solid rgba(245,158,11,0.18);border-radius:10px;padding:14px 18px;margin-top:20px;">
      <div style="color:#fbbf24;font-size:12px;font-weight:700;margin-bottom:4px;">⏱️ Délai de livraison</div>
      <div style="color:rgba(255,255,255,0.55);font-size:12px;line-height:1.6;">La livraison est progressive et peut prendre quelques minutes à quelques heures selon le volume commandé. Ne modifiez pas votre contenu pendant la livraison.</div>
    </div>
    ${ctaButton('📊 Suivre ma commande', historyUrl, 'purple')}
  `;
  try {
    await resend.emails.send({ from: FROM, to: email, reply_to: REPLY_TO,
      subject: `🛒 Commande ${orderId} confirmée`,
      html: baseTemplate('Commande confirmée', `Votre commande ${orderId} est en cours de livraison.`, body)
    });
    console.log(`📧 Email commande envoyé à ${email}`);
  } catch (err) {
    console.error('❌ Erreur email commande:', err.message);
  }
}

// ─────────────────────────────────────────────
// 4. DEMANDE DE RETRAIT
// ─────────────────────────────────────────────
async function sendWithdrawalRequestEmail({ email, username, amount, phoneNumber, method, withdrawalId }) {
  if (!resend) return;
  const body = `
    <div style="text-align:center;margin-bottom:28px;">
      <div style="width:64px;height:64px;background:linear-gradient(135deg,rgba(245,158,11,0.2),rgba(239,68,68,0.05));border:2px solid rgba(245,158,11,0.4);border-radius:50%;margin:0 auto 16px;line-height:64px;font-size:28px;">💸</div>
      <h2 style="color:#fff;font-size:22px;font-weight:700;margin:0 0 6px;">Demande de Retrait Enregistrée</h2>
      <p style="color:rgba(255,255,255,0.55);font-size:14px;margin:0;">Votre demande a été reçue et sera traitée dans les 24 heures.</p>
    </div>
    <div style="background:linear-gradient(135deg,rgba(245,158,11,0.1),rgba(239,68,68,0.03));border:1px solid rgba(245,158,11,0.3);border-radius:14px;padding:28px;text-align:center;margin-bottom:24px;">
      <div style="color:rgba(255,255,255,0.5);font-size:12px;text-transform:uppercase;letter-spacing:1px;margin-bottom:8px;">Montant demandé</div>
      <div style="font-size:38px;font-weight:900;color:#fbbf24;">${fmt(amount)} <span style="font-size:20px;">FCFA</span></div>
    </div>
    ${infoCard(`
      ${infoRow('👤', 'Compte', username || email)}
      ${infoRow('📱', 'Numéro de réception', phoneNumber)}
      ${infoRow('💳', 'Méthode', method || 'Mobile Money')}
      ${infoRow('🏷️', 'Référence', withdrawalId ? `<code style="font-size:11px;color:#a78bfa;">${withdrawalId}</code>` : '—', '#a78bfa')}
      ${infoRow('📅', 'Date de demande', new Date().toLocaleString('fr-FR', { timeZone: 'Africa/Douala', dateStyle: 'medium', timeStyle: 'short' }))}
      ${infoRow('⏳', 'Délai de traitement', 'Sous 24 heures', '#fbbf24')}
    `)}
    ${ctaButton('🏠 Retour au Dashboard', `${SITE_URL}/dashboard.html`, 'gold')}
  `;
  try {
    await resend.emails.send({ from: FROM, to: email, reply_to: REPLY_TO,
      subject: `💸 Demande de retrait de ${fmt(amount)} FCFA enregistrée`,
      html: baseTemplate('Demande de retrait', `Votre retrait de ${fmt(amount)} FCFA est en cours de traitement.`, body)
    });
    console.log(`📧 Email retrait demandé envoyé à ${email}`);
  } catch (err) {
    console.error('❌ Erreur email retrait demandé:', err.message);
  }
}

// ─────────────────────────────────────────────
// 5. RETRAIT APPROUVÉ
// ─────────────────────────────────────────────
async function sendWithdrawalApprovedEmail({ email, username, amount, phoneNumber, method, note }) {
  if (!resend) return;
  const body = `
    <div style="text-align:center;margin-bottom:28px;">
      <div style="width:64px;height:64px;background:linear-gradient(135deg,rgba(16,185,129,0.2),rgba(6,182,212,0.1));border:2px solid rgba(16,185,129,0.4);border-radius:50%;margin:0 auto 16px;line-height:64px;font-size:28px;">🎉</div>
      <h2 style="color:#fff;font-size:22px;font-weight:700;margin:0 0 6px;">Retrait Approuvé !</h2>
      <p style="color:rgba(255,255,255,0.55);font-size:14px;margin:0;">Votre paiement a été effectué avec succès.</p>
    </div>
    <div style="background:linear-gradient(135deg,rgba(16,185,129,0.1),rgba(6,182,212,0.05));border:1px solid rgba(16,185,129,0.35);border-radius:14px;padding:28px;text-align:center;margin-bottom:24px;">
      <div style="color:rgba(255,255,255,0.5);font-size:12px;text-transform:uppercase;letter-spacing:1px;margin-bottom:8px;">Montant versé</div>
      <div style="font-size:38px;font-weight:900;color:#34d399;">${fmt(amount)} <span style="font-size:20px;">FCFA</span></div>
      <div style="margin-top:12px;">${badge('✅ Paiement effectué', 'green')}</div>
    </div>
    ${infoCard(`
      ${infoRow('👤', 'Bénéficiaire', username || email)}
      ${infoRow('📱', 'Numéro reçu', phoneNumber)}
      ${infoRow('💳', 'Méthode', method || 'Mobile Money')}
      ${infoRow('📅', "Date d'approbation", new Date().toLocaleString('fr-FR', { timeZone: 'Africa/Douala', dateStyle: 'medium', timeStyle: 'short' }))}
      ${note ? infoRow('💬', 'Note admin', note) : ''}
    `)}
    ${ctaButton('🏠 Retour au Dashboard', `${SITE_URL}/dashboard.html`, 'green')}
  `;
  try {
    await resend.emails.send({ from: FROM, to: email, reply_to: REPLY_TO,
      subject: `🎉 Retrait de ${fmt(amount)} FCFA approuvé et payé !`,
      html: baseTemplate('Retrait approuvé', `Votre retrait de ${fmt(amount)} FCFA a été payé.`, body)
    });
    console.log(`📧 Email retrait approuvé envoyé à ${email}`);
  } catch (err) {
    console.error('❌ Erreur email retrait approuvé:', err.message);
  }
}

// ─────────────────────────────────────────────
// 6. RETRAIT REJETÉ
// ─────────────────────────────────────────────
async function sendWithdrawalRejectedEmail({ email, username, amount, note }) {
  if (!resend) return;
  const body = `
    <div style="text-align:center;margin-bottom:28px;">
      <div style="width:64px;height:64px;background:linear-gradient(135deg,rgba(239,68,68,0.2),rgba(245,158,11,0.05));border:2px solid rgba(239,68,68,0.4);border-radius:50%;margin:0 auto 16px;line-height:64px;font-size:28px;">❌</div>
      <h2 style="color:#fff;font-size:22px;font-weight:700;margin:0 0 6px;">Demande de Retrait Rejetée</h2>
      <p style="color:rgba(255,255,255,0.55);font-size:14px;margin:0;">Votre demande n'a pas pu être traitée. Votre solde a été remboursé.</p>
    </div>
    <div style="background:rgba(239,68,68,0.08);border:1px solid rgba(239,68,68,0.25);border-radius:14px;padding:28px;text-align:center;margin-bottom:24px;">
      <div style="color:rgba(255,255,255,0.5);font-size:12px;text-transform:uppercase;letter-spacing:1px;margin-bottom:8px;">Montant concerné</div>
      <div style="font-size:38px;font-weight:900;color:#f87171;">${fmt(amount)} <span style="font-size:20px;">FCFA</span></div>
      <div style="margin-top:12px;">${badge('🔄 Remboursé à votre compte', 'red')}</div>
    </div>
    ${infoCard(`
      ${infoRow('👤', 'Compte', username || email)}
      ${infoRow('💰', 'Montant', `${fmt(amount)} FCFA`)}
      ${note ? infoRow('💬', 'Raison', note, '#fbbf24') : ''}
      ${infoRow('📅', 'Date', new Date().toLocaleString('fr-FR', { timeZone: 'Africa/Douala', dateStyle: 'medium', timeStyle: 'short' }))}
    `)}
    ${ctaButton('🏠 Retour au Dashboard', `${SITE_URL}/dashboard.html`, 'red')}
  `;
  try {
    await resend.emails.send({ from: FROM, to: email, reply_to: REPLY_TO,
      subject: `❌ Demande de retrait de ${fmt(amount)} FCFA rejetée`,
      html: baseTemplate('Retrait rejeté', `Votre demande de retrait a été rejetée. Solde remboursé.`, body)
    });
    console.log(`📧 Email retrait rejeté envoyé à ${email}`);
  } catch (err) {
    console.error('❌ Erreur email retrait rejeté:', err.message);
  }
}

// ─────────────────────────────────────────────
// EXPORTS
// ─────────────────────────────────────────────
module.exports = {
  sendWelcomeEmail,
  sendRechargeEmail,
  sendOrderEmail,
  sendWithdrawalRequestEmail,
  sendWithdrawalApprovedEmail,
  sendWithdrawalRejectedEmail,
};
