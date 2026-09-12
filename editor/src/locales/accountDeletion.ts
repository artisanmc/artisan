export const accountDeletionEn = {
  title: "Delete my account",
  body: "This permanently deletes your Artisan account, private drafts and assistant history. Networks where you are the last owner will be removed from Artisan, including access for their members. Files on your Minecraft servers stay intact. Shared networks with another owner remain available.",
  send: "Send confirmation email",
  sent: "Confirmation email sent to {{email}}. The link expires in 30 minutes. Your account stays active until you confirm on that page.",
  confirm: "Permanently delete my account",
  confirmBody:
    "This action cannot be undone. Confirm only if you requested this email for your account.",
  done: "Your account has been deleted.",
  doneBody:
    "Your sessions have been revoked. Files on your Minecraft servers have not been changed.",
  back: "Back to profile",
  cancel: "Cancel",
  busy: "Please wait…",
  errors: {
    invalid_token: "This link is invalid or has expired. Request a new email from your profile.",
    email_unavailable: "The confirmation email could not be sent. Please try again later.",
    rate_limited: "Please wait one minute before requesting another email.",
    active_subscription:
      "A network where you are the last owner still has an active subscription. Cancel it in billing before deleting your account.",
    unauthorized: "Sign in again to request the confirmation email.",
    unknown: "The request failed. Please try again.",
  },
};

export const accountDeletionFr: typeof accountDeletionEn = {
  title: "Supprimer mon compte",
  body: "Cette action supprime définitivement votre compte Artisan, vos brouillons privés et votre historique de l’assistant. Les réseaux dont vous êtes le dernier propriétaire seront retirés d’Artisan, ainsi que l’accès de leurs membres. Les fichiers de vos serveurs Minecraft restent intacts. Les réseaux partagés avec un autre propriétaire restent accessibles.",
  send: "Envoyer l’email de confirmation",
  sent: "Email de confirmation envoyé à {{email}}. Le lien expire dans 30 minutes. Votre compte reste actif jusqu’à votre confirmation sur cette page.",
  confirm: "Supprimer définitivement mon compte",
  confirmBody:
    "Cette action est irréversible. Confirmez uniquement si vous avez demandé cet email pour votre compte.",
  done: "Votre compte a été supprimé.",
  doneBody:
    "Vos sessions ont été révoquées. Les fichiers de vos serveurs Minecraft n’ont pas été modifiés.",
  back: "Retour au profil",
  cancel: "Annuler",
  busy: "Veuillez patienter…",
  errors: {
    invalid_token: "Ce lien est invalide ou expiré. Demandez un nouvel email depuis votre profil.",
    email_unavailable: "L’email de confirmation n’a pas pu être envoyé. Réessayez plus tard.",
    rate_limited: "Patientez une minute avant de demander un autre email.",
    active_subscription:
      "Un réseau dont vous êtes le dernier propriétaire a encore un abonnement actif. Résiliez-le dans la facturation avant de supprimer votre compte.",
    unauthorized: "Reconnectez-vous pour demander l’email de confirmation.",
    unknown: "La demande a échoué. Veuillez réessayer.",
  },
};
