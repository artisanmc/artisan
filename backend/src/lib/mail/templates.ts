import type { MailMessage } from "./mailer";

export type MailLocale = "en" | "fr";

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!,
  );
}

export function welcomeEmail(params: {
  to: string;
  displayName: string;
  locale?: MailLocale;
}): MailMessage {
  const { to, displayName, locale = "en" } = params;
  const editorUrl = process.env.EDITOR_URL ?? "http://localhost:5173";

  const isEnglish = locale === "en";

  const subject = isEnglish ? "Welcome to Artisan" : "Bienvenue sur Artisan";

  const text = isEnglish
    ? `Hi ${displayName},\n\nWelcome to Artisan! Start editing your menus at ${editorUrl}.\n\nBest regards,\nThe Artisan Team`
    : `Bonjour ${displayName},\n\nBienvenue sur Artisan ! Commencez à éditer vos menus à ${editorUrl}.\n\nCordialement,\nL'équipe Artisan`;

  const escapedDisplayName = escapeHtml(displayName);
  const escapedEditorUrl = escapeHtml(editorUrl);

  const html = isEnglish
    ? `<div style="font-family: sans-serif; color: #333; line-height: 1.6;">
  <p>Hi ${escapedDisplayName},</p>
  <p>Welcome to Artisan! Start editing your menus at <a href="${escapedEditorUrl}" style="color: #0066cc; text-decoration: none;">${escapedEditorUrl}</a>.</p>
  <p>Best regards,<br>The Artisan Team</p>
</div>`
    : `<div style="font-family: sans-serif; color: #333; line-height: 1.6;">
  <p>Bonjour ${escapedDisplayName},</p>
  <p>Bienvenue sur Artisan ! Commencez à éditer vos menus à <a href="${escapedEditorUrl}" style="color: #0066cc; text-decoration: none;">${escapedEditorUrl}</a>.</p>
  <p>Cordialement,<br>L'équipe Artisan</p>
</div>`;

  return {
    to,
    subject,
    text,
    html,
  };
}

export function accessRequestEmail(params: {
  to: string;
  networkName: string;
  requesterName: string;
  requesterEmail: string;
  message?: string | null;
  url: string;
  locale?: MailLocale;
}): MailMessage {
  const { to, networkName, requesterName, requesterEmail, message, url, locale = "en" } = params;
  const isEnglish = locale === "en";

  const subject = isEnglish
    ? `Access request for ${networkName} on Artisan`
    : `Demande d'accès à ${networkName} sur Artisan`;

  const text = isEnglish
    ? `${requesterName} (${requesterEmail}) requested access to ${networkName} on Artisan.${message ? `\n\nMessage: ${message}` : ""}\n\nReview the request: ${url}\n\nBest regards,\nThe Artisan Team`
    : `${requesterName} (${requesterEmail}) a demandé l'accès à ${networkName} sur Artisan.${message ? `\n\nMessage : ${message}` : ""}\n\nExaminer la demande : ${url}\n\nCordialement,\nL'équipe Artisan`;

  const escapedNetworkName = escapeHtml(networkName);
  const escapedRequesterName = escapeHtml(requesterName);
  const escapedRequesterEmail = escapeHtml(requesterEmail);
  const escapedMessage = message ? escapeHtml(message) : null;
  const escapedUrl = escapeHtml(url);

  const html = isEnglish
    ? `<div style="font-family: sans-serif; color: #333; line-height: 1.6;">
  <p><strong>${escapedRequesterName}</strong> (${escapedRequesterEmail}) requested access to <strong>${escapedNetworkName}</strong> on Artisan.</p>
  ${escapedMessage ? `<p>Message: ${escapedMessage}</p>` : ""}
  <p><a href="${escapedUrl}" style="color: #0066cc; text-decoration: none;">Review the request</a></p>
  <p>Best regards,<br>The Artisan Team</p>
</div>`
    : `<div style="font-family: sans-serif; color: #333; line-height: 1.6;">
  <p><strong>${escapedRequesterName}</strong> (${escapedRequesterEmail}) a demandé l'accès à <strong>${escapedNetworkName}</strong> sur Artisan.</p>
  ${escapedMessage ? `<p>Message : ${escapedMessage}</p>` : ""}
  <p><a href="${escapedUrl}" style="color: #0066cc; text-decoration: none;">Examiner la demande</a></p>
  <p>Cordialement,<br>L'équipe Artisan</p>
</div>`;

  return {
    to,
    subject,
    text,
    html,
  };
}

export function passwordResetEmail(params: {
  to: string;
  displayName: string;
  url: string;
  locale?: MailLocale;
}): MailMessage {
  const { to, displayName, url, locale = "en" } = params;
  const isEnglish = locale === "en";

  const subject = isEnglish ? "Reset your Artisan password" : "Réinitialiser votre mot de passe Artisan";

  const text = isEnglish
    ? `Hi ${displayName},\n\nSomeone asked to reset the password of your Artisan account. Open this link within the hour to choose a new one:\n\n${url}\n\nIf that wasn't you, ignore this email — your password stays unchanged.\n\nBest regards,\nThe Artisan Team`
    : `Bonjour ${displayName},\n\nUne réinitialisation du mot de passe de votre compte Artisan a été demandée. Ouvrez ce lien dans l'heure pour en choisir un nouveau :\n\n${url}\n\nSi vous n'êtes pas à l'origine de cette demande, ignorez cet email — votre mot de passe reste inchangé.\n\nCordialement,\nL'équipe Artisan`;

  const escapedDisplayName = escapeHtml(displayName);
  const escapedUrl = escapeHtml(url);

  const html = isEnglish
    ? `<div style="font-family: sans-serif; color: #333; line-height: 1.6;">
  <p>Hi ${escapedDisplayName},</p>
  <p>Someone asked to reset the password of your Artisan account. The link below expires in one hour.</p>
  <p><a href="${escapedUrl}" style="color: #0066cc; text-decoration: none;">Choose a new password</a></p>
  <p>If that wasn't you, ignore this email — your password stays unchanged.</p>
  <p>Best regards,<br>The Artisan Team</p>
</div>`
    : `<div style="font-family: sans-serif; color: #333; line-height: 1.6;">
  <p>Bonjour ${escapedDisplayName},</p>
  <p>Une réinitialisation du mot de passe de votre compte Artisan a été demandée. Le lien ci-dessous expire dans une heure.</p>
  <p><a href="${escapedUrl}" style="color: #0066cc; text-decoration: none;">Choisir un nouveau mot de passe</a></p>
  <p>Si vous n'êtes pas à l'origine de cette demande, ignorez cet email — votre mot de passe reste inchangé.</p>
  <p>Cordialement,<br>L'équipe Artisan</p>
</div>`;

  return {
    to,
    subject,
    text,
    html,
  };
}

export function inviteEmail(params: {
  to: string;
  networkName: string;
  inviterName: string;
  url: string;
  locale?: MailLocale;
}): MailMessage {
  const { to, networkName, inviterName, url, locale = "en" } = params;
  const isEnglish = locale === "en";

  const subject = isEnglish
    ? `You're invited to join ${networkName} on Artisan`
    : `Invitation à rejoindre ${networkName} sur Artisan`;

  const text = isEnglish
    ? `${inviterName} invited you to join ${networkName} on Artisan.\n\nAccept the invite: ${url}\n\nBest regards,\nThe Artisan Team`
    : `${inviterName} vous invite à rejoindre ${networkName} sur Artisan.\n\nAccepter l'invitation : ${url}\n\nCordialement,\nL'équipe Artisan`;

  const escapedNetworkName = escapeHtml(networkName);
  const escapedInviterName = escapeHtml(inviterName);
  const escapedUrl = escapeHtml(url);

  const html = isEnglish
    ? `<div style="font-family: sans-serif; color: #333; line-height: 1.6;">
  <p>${escapedInviterName} invited you to join <strong>${escapedNetworkName}</strong> on Artisan.</p>
  <p><a href="${escapedUrl}" style="color: #0066cc; text-decoration: none;">Accept the invite</a></p>
  <p>Best regards,<br>The Artisan Team</p>
</div>`
    : `<div style="font-family: sans-serif; color: #333; line-height: 1.6;">
  <p>${escapedInviterName} vous invite à rejoindre <strong>${escapedNetworkName}</strong> sur Artisan.</p>
  <p><a href="${escapedUrl}" style="color: #0066cc; text-decoration: none;">Accepter l'invitation</a></p>
  <p>Cordialement,<br>L'équipe Artisan</p>
</div>`;

  return {
    to,
    subject,
    text,
    html,
  };
}
