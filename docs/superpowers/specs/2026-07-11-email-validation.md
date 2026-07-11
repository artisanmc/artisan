# Validation email — manuel (nécessite un domaine TEM configuré)

Pré-requis utilisateur : projet Scaleway + domaine TEM validé (SPF/DKIM/DMARC), credentials SMTP.

1. Renseigner SMTP_HOST=smtp.tem.scw.cloud, SMTP_PORT=587, SMTP_USER, SMTP_PASS, MAIL_FROM dans backend/.env.
2. `bun backend/scripts/send-test-email.ts <ton adresse>` → mail reçu (vérifier spam), FROM correct, rendu html.
3. Variante fr : `... <adresse> fr`.
4. Signup réel sur l'éditeur local → mail de bienvenue reçu ; signup avec SMTP_* vides → aucun envoi, aucun WARN répété (un seul au premier essai).
5. Coolify prod : ajouter les env vars au service backend avant de compter dessus.
