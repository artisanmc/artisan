# Accounts-only editing — suppression du mode session anonyme

**Statut : accepted (2026-07-11).** Décision issue d'une session grill-with-docs ; termes `Link` et `Membership` fixés dans `CONTEXT.md` le même jour.

L'édition web exige désormais un compte : le lien de session anonyme émis par `/artisan editor` (trust dance `trusteditor`, surface REST `/api/v1/editor-session/:token/*`, `sessionStore` éditeur) est supprimé — cutover sec, pas de fenêtre de coexistence. `/artisan editor` devient purement informatif (link code si le Server est vierge, URL de l'éditeur sinon), l'autorisation d'éditer est portée par la **Membership** (owner/member, scope Network, checks par capacités centralisées), et l'entrée d'équipe se fait par invitation (lien + email — infra Scaleway TEM). La sync plugin ↔ backend (server key, bundles, `local_push`/FTP) n'est pas concernée : c'est une auth serveur, pas une session navigateur.

## Pourquoi

**Amendement limité — démo hébergée (2026-09-13).** Une session invitée peut éditer
uniquement son projet hébergé temporaire. Elle ne crée ni User, ni Network, ni
Server ; l'autorisation commune reçoit un principal invité borné au projet.
Les serveurs, l'IA facturée et les données d'autres projets restent réservés aux
comptes autorisés. Après connexion, une réclamation durable rattache le même
projet à un Network autorisé et révoque l'invité. Ce parcours ne rétablit pas les
anciennes sessions anonymes liées aux serveurs.

Le mode session date de la V1, avant le système comptes/networks. Depuis, c'est un **second modèle d'auth complet** : chaque feature paie la taxe deux fois (routes REST jumelles `editor-session/*` vs `user/*`, branches session/user dans l'auto-save, le deploy, la presence, l'assistant). La semaine du 2026-07-07 en a donné la mesure empirique : cinq bugs distincts imputables à la dualité, dont une éjection UX en mode dual-auth (cookie 403 sur un network autorisé par session), des server keys orphelins créés par `/artisan setup` relancé face à une UI incompréhensible, un crash backend (duplicate key non catché) déclenché par ce même setup, et des deploys user-auth qui perdaient les fichiers module (les modules ne s'enregistraient qu'en session).

## Alternatives rejetées

- **Conserver les deux modes** : la taxe est structurelle, pas transitoire — chaque nouvel écran/endpoint devra raisonner sur les deux identités pour toujours.
- **Fenêtre de dépréciation** : outil pour ne pas casser des clients existants ; le produit est pré-launch, il n'y en a pas.
- **Session anonyme « upgradeable » vers compte** : garde toute la machinerie session pour un bénéfice d'onboarding marginal face au claim-flow comptes (lien in-game → OAuth Discord → serveur lié, ~30 s une seule fois).

## Conséquences

- Friction assumée au premier contact (mur de connexion) — trade-off accepté contre la suppression d'une classe de bugs ; le billing suppose de toute façon des comptes.
- Le trust dance disparaît **sans remplacement** : la preuve « je suis admin de ce serveur » est donnée une fois au Link ; ensuite c'est la Membership qui autorise.
- Séquencement : ① cutover comptes-only → ② infra email (Scaleway TEM) → ③ Members (rôles + invitations). Chaque bloc shippe seul.
