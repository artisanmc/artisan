# Validation Members — manuel

1. Owner : network settings → Members → Invite (sans email) → lien copié.
2. Second compte (navigation privée) : ouvrir le lien → preview → login → Rejoindre → network visible, projects éditables, deploy OK.
3. Le member ne voit PAS les actions membres/serveurs (rotate, delete, invites) ; API directe → 403.
4. Invite avec email (si SMTP configuré) : mail reçu avec le lien ; sinon : lien quand même retourné.
5. Revoke d'une invite → le lien affiche « révoquée ».
6. Promote member → owner ; demote impossible sur le dernier owner (bouton désactivé + 409 API).
7. Remove member → le network disparaît de son compte au prochain chargement.
