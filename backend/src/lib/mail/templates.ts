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
