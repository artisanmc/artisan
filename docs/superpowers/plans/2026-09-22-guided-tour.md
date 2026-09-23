# Visite guidée de l’éditeur

Statut : implémenté ; validations ciblées réussies le 23 septembre 2026, selon le bilan ci-dessous. Reconstruction finale en cours après le dernier correctif du transfert invité.

## Comportement retenu

- Première ouverture d’un projet utilisable : accueil automatique « Découvrir Artisan en une minute », avec « Commencer » et « Plus tard ».
- Six étapes courtes, zone concernée mise en évidence, une ou deux phrases par étape, compteur, Précédent / Suivant / Plus tard / Terminer.
- Une seule présentation automatique par compte, y compris si le compte visite la démo. État conservé côté serveur, commun aux appareils et projets.
- Démo sans compte : état conservé dans ce navigateur, indépendamment de l’expiration du projet de démo. Effacer les données du navigateur réinitialise ce suivi invité.
- Plus tard, fermeture ou interruption : conserver l’étape ; proposer Reprendre la visite dans le menu du projet, sans réouverture automatique.
- Action permanente Refaire la visite dans le menu du projet, aussi en démo ; une relance manuelle ne réactive jamais le déclenchement automatique.
- Reprendre l’état invité au retour corrélé du passage explicite démo → compte ; un compte ayant déjà commencé ou terminé conserve son état. Abandonner ce parcours supprime l'intention de transfert ; une autre connexion ne la récupère pas.
- FR/EN, clavier, mobile, thème clair/sombre et réduction des animations.

## Parcours retenu

| Étape | Zone / contenu |
| --- | --- |
| 1 | Menu de navigation : retrouver ses projets et serveurs ; expliquer le projet invité en démo. |
| 2 | Canvas : visualiser les menus et leurs liens, sélectionner pour modifier. |
| 3 | Boutons et propriétés : ajouter un item ou une image, régler apparence et actions. |
| 4 | Éléments : retrouver menus, commandes et dialogues du projet. |
| 5 | Onglets : traductions, données, ressources, assistant si disponible. |
| 6 | Conserver son travail : expliquer les commandes réellement disponibles selon le stockage ; en démo, Conserver ce projet. |

Le tour ne modifie aucun document, ne déclenche aucune sauvegarde ni aucun déploiement. Il ouvre temporairement les panneaux nécessaires, restaure leur état, et adapte ses cibles aux permissions et à l’écran. L’inspecteur dépend d’une sélection : expliquer son fonctionnement depuis une cible disponible plutôt que sélectionner/modifier arbitrairement un élément.

## Phase 0 — Découverte effectuée

Sources et points d’intégration vérifiés :

- `CONTEXT.md`, sections Project / DemoSession / Document : le compte, le projet et le Network sont des identités distinctes.
- `docs/architecture/entities.md:16–41,196–210` : session invitée temporaire et préférences utilisateur.
- `docs/architecture/editor-internals.md:68–92,414–451,540–586` : workspace partagé, capacités de démo, panneaux temporaires et disposition mobile.
- `docs-site/src/content/docs/editor/index.md` et `projects.md` : vocabulaire et parcours utilisateur.
- `editor/src/features/project/ProjectWorkspace.tsx:99` : `ProjectCanvasPage({ projectRef } = {})`, montage partagé et attente du chargement/authentification.
- `editor/src/features/demo/DemoWorkspace.tsx` : `DemoWorkspace()` monte `ProjectCanvasPage`, bannière Conserver ce projet et dialogue de récupération.
- `editor/src/components/ProjectTopBarControls.tsx:112` : barre de projet et commandes ; menu existant pour la relance.
- `editor/src/components/UserMenu.tsx:21` : menu utilisateur possible en complément, mais il ne remplace pas une entrée accessible en démo.
- `backend/src/routes/auth.ts:187–243` : `GET/PATCH /api/v1/auth/me`, validation et mise à jour des préférences de l’utilisateur authentifié.
- `editor/src/lib/api/auth.ts` : `AuthUserDto`, `getMe`, `patchMe` ; `editor/src/state/authStore.ts` hydrate la session.
- `backend/src/db/schema.ts` : table `users` contenant déjà langue et thème ; aucun état de tour existant trouvé.

APIs autorisées : composants du design system existant, `useTranslation`, primitives React/Zustand déjà installées, routes auth existantes à étendre explicitement. Pas de route ni de bibliothèque de tour présumée disponible. Les primitives UI exactes et le menu enfant de la topbar seront lus avant leur modification.

## Phase 1 — État du tour, tests avant implémentation

1. Copier le pattern de préférence authentifiée de `auth.ts` et de `patchMe`. Écrire des tests qui échouent pour état initial, validation, isolement par utilisateur et relecture après nouvelle session.
2. Ajouter le stockage du suivi dans `users`, avec migration générée via `bun run db:generate`. Étendre les DTO et l’hydratation ; contrôler aussi les réponses login/signup/OAuth avant de décider du déclenchement.
3. Écrire puis implémenter le contrôleur du tour : première présentation, progression, report, achèvement, relance explicite. Le tour n’est éligible qu’après résolution de la session et disponibilité du workspace.
4. Ajouter stockage invité local et transfert lors du retour d’authentification démo. Tester interruption, changement de compte, démo expirée, rechargement, stockage indisponible et refus/échec API.

Vérification : tests ciblés backend via `bun run test`, tests frontend via `npm test -- --run`. L’état serveur connu prime ; ne pas traiter une lecture en échec comme un utilisateur neuf. Une préférence de compte n’appartient ni au projet ni au Network. Distinguer l’identité du compte du principal invité utilisé pour accéder au projet de démo.

## Phase 2 — Affichage et intégration, tests avant implémentation

1. Ajouter des tests du parcours visible : zones ciblées, progression, navigation clavier, fermeture/report, reprise et relance, adaptation démo et mobile.
2. Créer une primitive de visite dans `editor/src/components/ui/` avec les tokens et contrôles existants ; ajouter un spécimen dans `features/design-system/DesignSystemPage.tsx`.
3. Ajouter un module `features/onboarding/` pour étapes traduites, état d’exécution et coordination des cibles. Utiliser des repères explicites et stables sur les composants, sans dépendre du texte traduit ou de classes de présentation.
4. Monter le tour dans le workspace commun ; ajouter l’entrée de menu Reprendre / Refaire la visite, accessible en démo.
5. Attendre les cibles et ignorer proprement celles indisponibles. Suspendre lors d’un dialogue prioritaire, d’une erreur ou d’une sortie du projet. Restaurer les panneaux temporaires et le focus à la fermeture.

Vérification : tests comportementaux, puis inspection navigateur en compte et en démo, formats bureau et mobile. Aucun panneau caché ciblé, aucune sauvegarde déclenchée, aucun brouillon modifié par la visite ; pas de lancement sur les pages marketing, login ou administration.

## Phase 3 — Documentation et vérification finale

- Mettre à jour `docs/architecture/entities.md`, `rest-endpoints.md`, `editor-internals.md`, `CHANGELOG.md` et le guide public éditeur. Traiter les mises à jour plus larges avec `sync-docs` suivant les consignes du projet.
- Exécuter les tests pertinents backend/éditeur, lint des fichiers concernés et build éditeur ; vérifier la migration générée et le spécimen du design system.
- Vérifier manuellement : compte neuf, compte déjà présenté/terminé, reprise sur autre navigateur, démo anonyme, démo avec compte, transfert vers compte, report/reprise, relance, navigation clavier et mobile.
- Le dépôt contient déjà de nombreuses modifications en cours, notamment auth, démo, schéma, traductions et docs : intégrer des changements ciblés sans écraser ce travail.
- Vérifier l’environnement de déploiement disponible après validation et implémentation, puis construire/déployer conformément aux consignes du projet.

## Bilan de validation — 23 septembre 2026

- Backend : 32 tests auth/tour réussis ; initialisation atomique, isolement des comptes, progression, import et achèvement vérifiés par les tests.
- Contrôleur : 29 tests réussis, dont les régressions de connexion abandonnée et de retour OAuth corrélé à la démo.
- Éditeur : suites ciblées UI, primitive et routes existantes réussies ; vérification TypeScript et lint de l'éditeur réussis.
- Navigateur : les six étapes terminées sur mobile (390 × 844) ; accueil et étapes 1–2 vérifiés sur desktop, puis « Plus tard », restitution du focus et absence de relance automatique après rechargement.
- Le suivi par compte et sa relecture entre sessions sont couverts automatiquement côté backend ; aucune inscription ni vérification manuelle entre appareils n'a été réalisée.
- Build de production final réussi après le dernier correctif du contrôleur, documentation publique incluse.
- Migration 0051 appliquée localement et backend redémarré. Documentation synchronisée ; aucun déploiement en production ni commit effectué.
