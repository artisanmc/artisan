# Validation deep link + access request — manuel

1. /artisan editor → lien vers /networks/<slug>/servers/<slug> exact.
2. Anonyme clique → login (next) → atterrit sur la page serveur après connexion.
3. Compte SANS membership ouvre le lien → panneau « Demander l'accès » (pas de rebond) → envoie une demande (message optionnel).
4. Owner : email reçu (si SMTP) + demande visible dans Members → Approve → le demandeur voit le network au rechargement.
5. Re-demande pendant pending → « déjà en attente » ; après deny → nouvelle demande possible.
6. 404 réel (network supprimé) → rebond /networks conservé.
