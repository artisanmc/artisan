# Catalogue standard et offres custom

Statut : implémentation terminée et déployée localement le 2026-09-28 ; réserves de validation globale ci-dessous.

Contexte confirmé par Iban : Stripe n'est pas connecté et aucun abonnement Stripe n'existe. Aucune reprise d'abonnements ou réconciliation de tarifs Stripe historiques à implémenter. Le fonctionnement sans Stripe est le parcours initial normal.

## Objectif et décisions proposées

- Catalogue standard backend versionné : Free, Pro mensuel (9 EUR), Pro annuel (70 EUR), 500 crédits mensuels pour Pro. Reprendre les limites actuelles de `planLimits.ts`, sans inventer de nouvelles fonctionnalités payantes.
- Clés métier stables `free` / `pro`, variante de facturation et version de conditions distinctes des UUID et identifiants Stripe.
- Offres standard gérées dans le code, visibles en lecture seule dans le panel. Offres custom créées en base depuis une copie explicite des droits d'une version standard, privées et réservées à un Network.
- Résolution centrale des droits : limites serveurs/ressources/collaborateurs et capacités réellement utilisées. Les contrôles métier consomment les droits, pas le nom du plan.
- Conditions commerciales immuables par version ; nouvelle version pour changer prix, crédits ou droits. Les futurs abonnés conserveront leur version, sans migration commerciale automatique.
- Catalogue consultable sans Stripe ; souscription disponible uniquement après provisionnement confirmé. Le catalogue frontend provient de l'API, sans nouveau package partagé.
- Ne pas introduire de catégorie legacy ou de mécanisme de reprise d'abonnements. Inspecter les éventuels plans manuels locaux avant migration et les conserver comme brouillons custom non publiés ; ne pas les supprimer ni les assimiler aux standards par leur nom. Ne pas modifier les packs de crédits dans cette évolution.

## Phase 0 — Découverte effectuée

Sources relues :

- `backend/src/modules/billing/plansRepo.ts` : `createPlan`, `updatePlan`, `getPlan`, `listPlans`. Création actuellement couplée à Stripe ; conditions modifiables en place.
- `backend/src/db/schema.ts:718` : `subscriptionPlans`, puis `networkBilling` ; absence de clés métier/version/audience/droits détaillés.
- `backend/src/modules/billing/webhookHandler.ts:19` : résolution par Product ; incompatible avec plusieurs versions tarifaires partageant un Product.
- `backend/src/modules/billing/annualProCredits.ts` et `userRoutes.ts` : allocations annuelles et réponses de solde relisent le plan courant.
- `backend/src/modules/billing/resourceQuota.ts`, `editorAccess.ts`, `planLimits.ts` : distinction Free/Pro et quotas à centraliser.
- `editor/src/lib/api/billing.ts:36`, `features/marketing/PricingPage.tsx:64`, `features/billing/CreditsPage.tsx` : catalogue public, second endpoint d'offre, fallback de constantes et dépendance à editorPro.
- `editor/src/lib/api/adminBilling.ts`, `features/admin/billing/PlanForm.tsx`, `BillingPlansTab.tsx` : édition de toutes les offres, composants du design system réutilisables.
- `docs/architecture/entities.md:262`, `rest-endpoints.md:38`, `editor-internals.md:884`, `docs-site/src/content/docs/editor/free-and-pro.md` : contrats et tarifs documentés.

Patterns existants à suivre : `__setStripeGatewayForTests` et `app.request` dans `checkout.test.ts`, transactions et verrouillage de `annualProCredits.ts`, garde `requireCapability(..., "manage_billing")` du checkout. Vérifier les signatures du gateway local et la documentation officielle Stripe avant d'étendre son API ; ne pas supposer de méthodes SDK.

Le graphe est indexé mais certaines réponses sont obsolètes ; sources locales vérifiées en complément. Changements utilisateur présents, notamment `editor/src/state/accountStore.ts` et plusieurs fichiers canvas : les préserver.

## Phase 1 — Catalogue et persistance (tests d'abord)

1. Écrire les tests du catalogue, de ses clés/variantes/versions, de la validité des droits et de la synchronisation répétée/concurrente.
2. Définir le catalogue typé dans le module billing ; reprendre les valeurs de `planLimits.ts` et les contrats documentés.
3. Ajouter la distinction standard/custom, versions immuables, audience et Network cible, droits et rythme d'allocation des crédits. Distinguer période de facturation et période de crédits.
4. Générer la migration Drizzle et initialiser le catalogue standard. Préserver les données d'éventuels plans manuels sous forme de brouillons custom à compléter, sans reprise d'historique commercial.
5. Synchroniser le catalogue local au démarrage après migrations, indépendamment du paiement. Une version déjà enregistrée avec des conditions différentes doit produire une erreur explicite, pas une réécriture silencieuse.

Vérification : base vide, base avec plans manuels, double exécution et deux workers ; mêmes clés et contenus entre environnements, aucun doublon, aucun appel Stripe nécessaire. Garde : préserver les données des plans manuels, pas de `db:push` en production.

## Phase 2 — Paiement et conditions souscrites (tests d'abord)

1. Étendre les tests de `plans.test.ts`, `checkout.test.ts`, `stripe.test.ts`, `webhook.test.ts` et `read.test.ts` avant modification.
2. Séparer provisionnement Stripe et synchronisation locale ; assurer reprise après échec partiel et idempotence. Conserver une correspondance durable Price Stripe → version d'offre par environnement.
3. Résoudre checkout, factures, renouvellements et changements d'abonnement par Price/version. Préserver les garanties de paiement confirmé et d'expiration décrites dans `entities.md:269`.
4. Remplacer directement la résolution par Product par la résolution Price/version ; aucun fallback historique ni import d'anciens abonnements. Sans Stripe, autoriser la création des offres custom et la consultation du catalogue, avec souscription indisponible. Prévoir le provisionnement des versions publiées lors de la future connexion de Stripe.
5. Faire lire les conditions souscrites aux soldes et au versement mensuel annuel. Conserver le verrouillage, les bornes calendaires et l'idempotence existants.

Vérification avec gateway simulé : un futur abonné conserve son tarif après publication d'une nouvelle version, crédits annuels inchangés, factures rejouées, upgrade payé/non payé, annulation et expiration, provisionnement interrompu. Vérifier aussi le parcours initial sans Stripe. Garde : ni activation de droits par simple création/attribution d'offre, ni remplacement global des abonnements lors d'une publication.

## Phase 3 — Droits effectifs et offres privées (tests d'abord)

1. Introduire un résolveur unique des droits du Network, fondé sur sa version payée et sa validité ; Free par défaut. Les limites du plan effectif s’appliquent automatiquement ; supprimer l’ancien interrupteur global et ignorer sa configuration persistée (correction validée après livraison).
2. Recenser et remplacer les branches Pro dans les gardes serveurs, collaborateurs, ressources, mutations et contrats d'accès éditeur/plugin concernés. Ajouter une capacité seulement lorsqu'une fonctionnalité existante la consomme.
3. Autoriser l'admin à copier une version standard vers une offre custom indépendante, puis à publier de nouvelles versions custom. Valider quotas, absence de limite, tarif et calendrier des crédits côté backend.
4. Filtrer le catalogue public ; exposer les offres privées au Network autorisé seulement. Vérifier l'éligibilité au checkout indépendamment de l'affichage, et la cohérence des métadonnées au fulfillment.

Vérification : limites custom distinctes de Free/Pro, null illimité, autre Network refusé, anonymes sans données privées, offre inactive non souscriptible, expiration ramenant aux droits Free. Réutiliser `resourceQuota.test.ts` et les suites des gardes touchés. Garde : aucune décision métier fondée sur un nom ou UUID d'offre ; aucune modification du protocole plugin sans contrats et tests associés.

## Phase 4 — Landing, facturation et admin (tests d'abord)

1. Étendre les DTO et conserver la compatibilité nécessaire des endpoints v1 ; utiliser la même définition pour le catalogue public et les informations d'offre.
2. Adapter `PricingPage` aux clés/variantes et données du catalogue ; retirer les prix/limites dupliqués et la sélection implicite par editorPro.
3. Adapter `CreditsPage` au catalogue du Network et au rythme de crédits explicite.
4. Dans le panel : badge géré dans le code, lecture seule des standards garantie aussi par l'API ; création custom à partir d'une version, droits, tarif, Network cible et publication de version.

Vérification : reprendre `PricingPage.test.tsx`, `CreditsPage.test.tsx`, `PlanForm.test.tsx` ; tester offres disponibles sans paiement, offre privée éligible, standard non éditable, changement de Network sans fuite d'offres. Réutiliser Sheet/Input/FormField/Button et i18n existants. Garde : aucun catalogue frontend parallèle, aucun composant ad hoc contournant le design system.

## Phase 5 — Documentation et validation finale

- Mettre à jour `CONTEXT.md`, `CHANGELOG.md` Unreleased, `entities.md`, `rest-endpoints.md`, `editor-internals.md`, ainsi que les guides admin/console, install-admin, editor/credits et free-and-pro. Documenter publication de version, synchronisation, configuration par environnement et récupération après échec.
- Utiliser `sync-docs` pour auditer la dette documentaire si la mise à jour dépasse le seuil AGENTS ; faire valider ses patches selon ses instructions.
- Exécuter les tests ciblés après chaque phase, puis les suites concernées backend/éditeur, lint disponible et builds éditeur/docs/backend adaptés. Backend : exclusivement `bun run test`, jamais `bun test` direct.
- Tester une migration sur une base de test avec plans manuels et une installation vide ; vérifier conservation des données et idempotence de synchronisation, sans Stripe configuré.
- Vérifier les parcours landing → authentification → Network → checkout, admin custom et refus inter-Network ; utiliser le gateway simulé pour les achats.
- Construire et déployer localement si disponible après validation, en préservant les modifications utilisateur. Ne pas connecter de compte Stripe réel pour cette évolution.

Critère final : installation neuve sans Stripe avec offres standard présentes et création custom fonctionnelle ; mêmes conditions dans chaque environnement ; versions souscrites stables dans les tests de paiement simulé ; offre custom réservée à son Network ; toutes les limites appliquées depuis les droits effectifs.

## Résultat et vérification

- Catalogue standard : `backend/src/modules/billing/catalog.ts`. Conditions publiées immuables, clés stables et synchronisation sans Stripe ; offres custom privées et versions indépendantes.
- Migrations générées 0061–0063 : catalogue/version/droits, suppression de Network sans suppression des offres privées, ordre des factures payées. Reprise des plans manuels vérifiée depuis le snapshot 0060 sur fixtures isolées.
- Backend : suite complète via `bun run test`, 161 processus, 1 281 tests réussis, 0 échec, 1 ignoré ; base `artisan_test_managed_catalog_full`. Dernière correction du callback d'index vérifiée par 4 tests catalogue ; génération Drizzle sans différence résiduelle.
- Plugin : 1 109 tests recensés, 0 échec, 6 ignorés ; build `shadowJar` réussi. Quota effectif nullable et capability v2, compatibilité des quotas finis v1 vérifiée.
- Éditeur : 38 tests ciblés réussis ; suite complète 2 943 réussis sur 2 944 (393 fichiers sur 394). Seul échec : `BoardGroupControls.test.tsx`, réarrangement d'un groupe du canvas, hors modification de facturation et laissé intact.
- Builds backend, éditeur et documentation réussis ; lint ciblé de l'interface et `git diff --check` propres. Typecheck global backend encore en échec sur des diagnostics de dépendances/anciens callbacks de schéma/app ; aucun diagnostic dans billing/index ni dans le nouveau callback d'index après correction.
- Backend et Minecraft locaux redémarrés ; services opérationnels. API publique HTTP 200 avec les trois offres standard et `purchasable:false`, absence de clé Stripe confirmée. Page Tarifs vérifiée dans le navigateur : 9 EUR/mois et 70 EUR/an, limites du catalogue, souscription indisponible.
- Artisan chargé au démarrage Minecraft. Erreur distincte observée dans MSQuests (`BukkitVersion`, `NumberFormatException` sur `build`), hors périmètre et non modifiée.
- Aucun appel à un compte Stripe réel, aucun commit/push. Modifications concurrentes du canvas préservées. Mapping sync-docs existant sans entrées billing/admin/marketing ; documentation correspondante actualisée explicitement.


## Correction validée — Free par défaut et cadence des crédits

- Free fournit les droits effectifs de tout Network sans version payée valide ; aucune souscription Stripe ni ligne de facturation fictive n’est créée.
- Suppression de l’onglet Accès éditeur, du réglage global et des routes admin editor-policy. Les mutations serveur portent toujours le quota effectif avec `enabled: true`.
- La réponse subscription expose un `effectivePlan` distinct du statut de paiement : Free par défaut ou la version payée encore valide.
- Les libellés des crédits distinguent leur cadence (mensuelle pour les deux offres Pro) de celle de facturation ; les contrats custom conservent leur cadence explicite.

- Vérification backend : suite complète isolée (161 fichiers) initialement à 158 fichiers verts ; les 3 fixtures de connexion sans capacité quota ont été corrigées puis vérifiées séparément : hub 59/59, projectDrafts 8/8, userNetworks 142/142. Régression explicite Free/sans facturation et ancien plugin : resourceQuota 3/3. Tous les tests billing ont passé dans la suite complète.
- Build runtime backend réussi (949 modules) ; contrôle de whitespace réussi. Aucun changement de schéma ni migration requis pour cette correction.
