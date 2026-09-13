# Projets serveur, projets hébergés et démo immédiate

Statut : plan et orientations validés dans la conversation, avec précisions
architecture et démo confirmées le 2026-09-12. Phases 1 à 7 vérifiées et déployées
localement : démo dans le navigateur, copie et exécution protocole Minecraft,
migrations et smoke final validés. Les fixtures d'acceptation ont été nettoyées ;
les sauvegardes et rapports non secrets sont conservés.

## Objectif et décisions produit

Un seul éditeur, deux emplacements de stockage. Un Project possède une seule
source de vérité active pour ses fichiers, assets, historique et brouillons.

| | Serveur | Hébergé par Artisan |
|---|---|---|
| Source de vérité | Dossier Minecraft | Arbre de fichiers durable côté backend |
| Brouillons | `.artisan/drafts/` dans ce dossier | Même format dans le stockage hébergé |
| Ouverture et enregistrement | Serveur connecté | Sans serveur Minecraft |
| Contexte | Modules et données du serveur | Version Minecraft choisie, vanilla et exemples |
| Utilisation en jeu | Publication explicite sur le serveur | Copie explicite vers un serveur |

Décisions issues de la conversation :

- Pour un projet classique, le dossier définit l'ID côté fichiers. Pour un
  projet fourni par un add-on, l'ID explicite enregistré par cet add-on fait
  autorité, indépendamment du dossier. Supprimer dans les deux cas la dépendance
  à `project_id` dans le manifeste. L'identité interne backend reste stable.
- Cette exception est permanente : conserver `register(projectId, dir)` sans
  dépréciation. Pour Boutique, l'ID de projet cible est `boutique_addon` au lieu
  de `boutique_shop` ; cela ne renomme pas le module ni ses namespaces de données.
- L'interface générale reste accessible quand Minecraft est arrêté. Un projet
  serveur fermé ne s'ouvre pas hors ligne. Une coupure ne détruit pas le travail
  déjà ouvert : reprise après reconnexion et contrôle des conflits.
- La démo est accessible **sans compte**, avec un projet temporaire individuel.
  L'inscription permet de le conserver (choix confirmé le 2026-09-12).
- « Copier vers un serveur » crée un projet indépendant, sans synchronisation
  bidirectionnelle ni bascule implicite du stockage source.
- Un renommage via l'éditeur conserve les liens backend ; un renommage manuel
  crée une nouvelle identité découverte, avec les brouillons présents sur disque.
  Aucun rapprochement automatique par ressemblance ou hash.

Choix techniques retenus et paramètres initiaux :

- Les projets hébergés authentifiés appartiennent à un Network, même sans serveur.
  Les memberships et capacités existantes restent le modèle d'autorisation.
- Le backend héberge un volume durable de fichiers, avec publication de révisions
  atomiques et métadonnées SQL. Les binaires restent des fichiers, pas du base64
  dans une copie JSON du domaine. Prévoir sauvegarde et restauration conjointes.
- Une démo est une session invitée limitée à son projet temporaire, pas un faux
  User, Network ou Server. Expiration confirmée après 24 h d'inactivité effective.
  Quotas initiaux proposés : un projet par session, 20 MiB et 1 000 fichiers.
  Paramètres configurables ; leur validation de charge fait partie de la livraison.
- La démo n'appelle pas d'IA facturée et n'accède à aucun serveur. Un projet
  hébergé authentifié pourra utiliser l'assistant avec les crédits du Network.

### Architecture confirmée — composition et interface commune

- Définir une interface `ProjectStorage` et deux implémentations
  `ServerProjectStorage` et `HostedProjectStorage` (noms proposés, APIs à créer).
  Préférer la composition à une hiérarchie de classes avec méthodes surchargées
  selon le stockage. Mutualiser les règles métier au-dessus des adaptateurs.
- Un resolver central sélectionne l'adaptateur depuis la localisation autorisée
  du projet. Injecter cette dépendance dans les services ; côté éditeur, fournir
  un contexte de projet et un client commun. Ne jamais accepter du navigateur
  un type de stockage permettant de contourner la résolution autorisée.
- Aucun branchement sur `storageKind` dans les composants, l'autosave, les
  sérialiseurs ou les règles de publication. Les différences techniques restent
  dans les adaptateurs ; les contrôles métier s'appuient sur des capacités
  explicites. Le discriminant reste légitime dans le resolver, la persistance
  et les migrations, pas dans chaque parcours.
- Vérifier ces frontières par les mêmes tests de contrat sur les deux
  implémentations et un contrôle des imports/branches lors de la revue.

### Durée et récupération de la démo confirmées

Les fichiers, assets et brouillons anonymes vivent sur le backend. Le navigateur
porte un cookie opaque de récupération et une copie de secours locale ; il n'est
pas le stockage principal. Le cookie permet de revenir après fermeture de
l'onglet, tant que le projet et la session n'ont pas expiré.

Une utilisation effective renouvelle les 24 h ; un polling ou heartbeat en
arrière-plan ne prolonge pas indéfiniment une démo abandonnée. Le backend calcule
et renvoie `expiresAt`, utilisé par l'UI pour afficher la date d'expiration et
« Projet temporaire — créez un compte pour le conserver ». À expiration, refuser
l'accès et planifier la purge des fichiers et métadonnées, sans toucher un claim
en cours. Lier la durée du cookie à cette politique.

Effacer le cookie ou changer de navigateur ne donne pas accès à la même démo.
L'inscription puis la réclamation retirent le TTL de démo et conservent le projet
dans le Network autorisé ; « permanent » signifie hors expiration de démo, pas
une exemption des règles ordinaires de suppression. Tester le renouvellement,
le polling sans activité, l'expiration et la course entre purge et réclamation.

## Phase 0 — Découverte et références à relire

La documentation contient des descriptions historiques contradictoires. Les
signatures actuelles et les tests sont prioritaires pour l'implémentation.

- `CONTEXT.md`, entrées Project, Bundle, Draft : vocabulaire et fichiers canoniques.
- `docs/decisions/server-disk-only-storage.md`, révision du 2026-09-11 : brouillons
  privés backend ajoutés après le passage au disque serveur.
- `docs/decisions/assets-on-server-disk.md`, décisions 1–4 : assets sources sur
  disque, cache jetable, binaires transportés séparément de l'arbre texte.
- `docs/decisions/accounts-only-editing.md` : auth comptes-only actuelle ; la démo
  doit être une exception explicitement documentée et confinée.
- `docs/decisions/addon-owned-project-roots.md` et
  `plugin/src/main/kotlin/net/artisanmc/modules/api/ProjectRootRegistry.kt` :
  `@Stable register(projectId: String, dir: File)` ; ne pas casser ses appelants.
- `plugin/src/main/kotlin/net/artisanmc/plugin/project/ProjectRoots.kt` :
  `all()`, `dirFor(projectId)` ; les racines d'add-ons gagnent les collisions.
- `plugin/src/main/kotlin/net/artisanmc/plugin/yaml/ProjectReader.kt:128` : lecture
  du manifeste ; `ProjectBundle` reçoit encore `manifest.projectId` vers L289.
- `backend/src/lib/projectStorage.ts` : `projectDiskId`,
  `getProjectForServer`, `ensureProjectForServer`. L'ID disque est scoped au
  serveur ; l'ID interne global ne doit jamais autoriser un accès cross-tenant.
- `backend/src/db/schema.ts:352` : `projects.serverKeyId` obligatoire aujourd'hui,
  `externalId` distinct de `id`, slug scoped au serveur ; `project_drafts` vers L386.
- `backend/src/lib/projectDrafts.ts` : `validSnapshot`, `validDraftBody`,
  `publishDraftSnapshot(serverKeyId, diskId, snapshot)`. Base, arbre initial,
  renommages et révision sont nécessaires à la reprise.
- `backend/src/routes/projectDrafts.ts` : brouillons privés, états terminaux,
  autorisation `publish_content` et verrou SQL pendant publication.
- `backend/src/ws/hub.ts` : `requestProjectWrite`, découverte des
  `hello.local_project_ids` ; `docs/architecture/ws-protocol.md` : CAS par fichier,
  erreurs corrélées et opérations d'assets séparées.
- `editor/src/features/project/useDraftSync.ts` : secours local immédiat puis
  synchronisation backend ; `backendDrafts.ts`, `saveProjectToDisk.ts`,
  `diskSave.ts` et `editor/src/schema/projectFromFiles.ts` : patterns à réutiliser.
- Tests de départ : `backend/src/routes/projectDrafts.test.ts`,
  `editor/src/features/project/backendDrafts.test.ts`,
  `editor/src/features/project/saveProjectToDisk.test.ts`,
  `editor/src/schema/projectFromFiles.test.ts`.

Compléments vérifiés pendant la découverte :

- `editor/src/features/project/useProjectLoader.ts` :
  `useProjectLoader(projectId, serverRef?)`, `buildProject` ; conversion de l'arbre
  relatif, chargement actuel du brouillon avant la lecture serveur. Étendre
  `useProjectLoader.test.tsx` et `useProjectLoader.staleRace.test.tsx` : le nouveau
  mode serveur doit explicitement bloquer une nouvelle ouverture hors ligne.
- `editor/src/features/export/projectZip.ts` : `normalizeProjectFiles` privilégie
  actuellement l'ID du manifeste ; `readProjectZip` décode tout en texte.
  Patterns complémentaires dans ce répertoire : `runImportZip.ts`, `runExportZip.ts`,
  `transform.ts`, `buildZip.ts`. Prévoir le choix du nom pour une archive sans
  dossier racine et un parcours binaire réel, pas ce lecteur texte tel quel.
- `backend/src/lib/projectTreeReads.ts` : `readProjectTree` et `forgetProjectTree`,
  cache scoped serveur/projet à inclure dans l'adaptation. Caches et sessions
  doivent distinguer propriétaire et identité interne, même avec dossiers homonymes.
- `plugin/src/main/kotlin/net/artisanmc/plugin/sync/ProjectFilesReader.kt` :
  `readAll`, `readRelative`, `binaries`, `allPaths`. `readAll` inclut aujourd'hui
  des métadonnées `.artisan/` : l'exclusion des brouillons privés est obligatoire.
- `plugin/src/main/kotlin/net/artisanmc/plugin/provider/SyncedMenuProvider.kt` :
  déplacements temporaires atomiques par fichier, mais atomicité d'un lot face
  à un crash non garantie. La phase 3 doit rendre les lots récupérables avant
  tout reload, pour ne jamais charger un mélange avant/après publication.
  Étendre `plugin/src/test/kotlin/net/artisanmc/plugin/ProjectWriteChannelTest.kt`.
- La phase 6 doit adapter les dépendances systématiques à `currentUser` dans le
  loader et l'autosave au principal autorisé (compte ou invité limité à sa démo).

APIs nouvelles citées ci-dessous : **contrats proposés**, pas des fonctions déjà
disponibles. Ne pas confondre le manifeste runtime `manifest/v1` avec
`docs/schema/pack/v1/schema.json` (format d'archive `pack/v1`).

## Phase 1 — Contrat de stockage et identité dans le modèle

Lire les références Phase 0 et `docs/architecture/entities.md` avant de coder.
Écrire les tests de contrat et de contraintes SQL avant l'implémentation.

1. Introduire une localisation discriminée : serveur (serverKeyId + nom de
   dossier) ou hébergée (racine privée backend + nom logique du dossier).
   Garder `projects.id` comme ancre interne immuable.
2. Ajouter `storageKind`, rendre le lien serveur conditionnel, imposer les
   contraintes SQL correspondantes et l'unicité des noms dans chaque portée.
   Adapter slugs, listes, permissions, suppression de Network/compte/serveur.
3. Définir un contrat commun : lecture texte et binaires, écriture CAS en lot,
   historique, CRUD de brouillons avec révision, publication, création,
   renommage et suppression. Exposer les capacités disponibles séparément du
   stockage : capture en jeu, données live, modules, prévisualisation.
4. Faire passer les routes actuelles par un adaptateur serveur reproduisant
   leur comportement ; ajouter des routes projet indépendantes d'un serverId.
   Conserver les routes existantes en façade compatible pendant la transition.

Vérification : mêmes tests de contrat pour les deux adaptateurs, 403 cross-network,
collisions de noms, contraintes SQL invalides, aucun faux serveur pour héberger.
Garde : ne pas généraliser tout le backend ; aucun changement de moteur d'édition.
Docs : nouvel ADR proposé `project-storage-modes`, entities, REST, CONTEXT,
CHANGELOG ; migrations générées par `bun run db:generate`.

## Phase 2 — Identité résolue et renommage fiable

Partir de `ProjectRoots`, `ProjectReader`, `ProjectRootRegistry`,
`projectFromFiles.ts` et des sérialiseurs réellement retrouvés dans le dépôt.
Tests d'abord : manifeste divergent, absent, legacy, collisions et redémarrage.

1. Transmettre explicitement l'identité résolue au chargement ; cesser d'émettre
   `project_id`. Les anciens manifests restent lisibles, leur ID divergent est
   ignoré et signalé. Versionner le format si un schéma publié exige ce champ ;
   ne jamais éditer un schéma v1 déjà livré pour supprimer une exigence.
2. Aligner création, import/export, commandes, modèles et références explicites.
   Réécrire uniquement des références structurées reconnues ; jamais un replace
   global de texte. Signaler les références externes que l'outil ne peut modifier.
3. Conserver l'API @Stable `register(projectId, dir)` comme mécanisme permanent
   pour les projets d'add-ons. Le resolver fournit au lecteur l'ID enregistré
   pour une racine d'add-on et le nom du dossier pour une racine classique ; le
   reste du système consomme cette identité sans réimplémenter la distinction.
   L'UI expose `canRename: false` pour les projets gérés par un add-on. Conserver
   les contrôles de collision et la portée serveur des IDs. Déplacer le dossier
   d'un add-on ne change pas son identité si son enregistrement vise ce dossier.
   Migrer explicitement le projet Boutique `boutique_shop` vers `boutique_addon` :
   enregistrement, déclarations d'écrans et références structurées au projet,
   métadonnées backend et caches. Préserver l'ID interne backend et ses liens,
   vérifier les brouillons existants, refuser une destination déjà occupée et
   rendre la migration reprenable sans doublon à la découverte. Aucun renommage
   physique du dossier, du module ou des namespaces imposé par ce choix d'ID.
4. Renommer via une opération durable et idempotente : réserver le nom cible,
   verrouiller les écritures, journaliser l'intention, renommer atomiquement sur
   le stockage, puis actualiser l'ancre backend sans changer son ID interne.
   Une reconnexion réconcilie les opérations en cours avant la découverte ordinaire.
   Retrouver le résultat après perte d'ACK ; ne pas créer un doublon.
5. Invalider les caches et annoncer le changement aux onglets ouverts. Préserver
   les brouillons/historiques du dossier et refuser les anciennes écritures.

Vérification : arrêt à chaque étape du renommage, retry, destination occupée,
renommage de casse Windows, onglets concurrents, racines add-ons et liens backend.
Tester un ID d'add-on différent du dossier sans `project_id` dans le manifeste,
le refus de renommage UI et la migration Boutique avec brouillons conservés.
Garde : pas de transaction SQL prétendant couvrir une opération distante.
Docs : protocole WS, API publique + CHANGELOG, modules, schémas, docs projets.

## Phase 3 — Brouillons serveur et migration des données existantes

Reprendre les règles de `projectDrafts.ts`, les tests des routes, et le CAS décrit
dans `ws-protocol.md`. Écrire les tests Kotlin et de relais avant les handlers.

1. Stocker chaque brouillon sous `.artisan/drafts/<draftId>/` : enveloppe versionnée,
   propriétaire opaque, nom, révision, état, base, arbre initial, modifications et
   renommages. Inclure les nouveaux binaires/références nécessaires au brouillon ;
   aucun asset non publié ne doit être perdu ou apparaître en jeu implicitement.
2. Étendre le protocole par capacités négociées : lecture/liste/écriture/suppression
   et publication de brouillons. Le backend autorise l'acteur et transmet une
   identité vérifiée ; le navigateur ne choisit pas librement son ownerId.
3. Reproduire la confidentialité web et le CAS des révisions, verrous de publication,
   états terminaux et résultat idempotent. Écriture atomique et journal de reprise
   pour éviter « fichiers publiés, brouillon encore actif » après un crash.
4. Exclure `.artisan/drafts/` du runtime, des hashes du contenu publié, des lectures
   ordinaires, caches publics et exports de partage. Une sauvegarde administrative
   du dossier complet conserve volontairement les brouillons.
5. Migrer par Project, à la connexion d'un plugin compatible : geler les mutations
   backend du lot, copier avec IDs/révisions/propriétaires, relire et vérifier le
   contenu, enregistrer le basculement, puis purger la copie backend vérifiée.
   Reprise idempotente, pas de suppression si serveur absent ou migration incomplète.
   Un ancien plugin conserve provisoirement le parcours existant ; statut de
   migration explicite, aucune alternance silencieuse entre deux sources actives.
6. Adapter la suppression de compte : révoquer immédiatement l'accès web, puis
   transmettre une purge différée à la reconnexion. Les fichiers privés ne sont
   pas secrets vis-à-vis de l'administrateur ayant accès au disque Minecraft.
   Un brouillon copié sur un autre serveur reste privé au même compte autorisé,
   sans attribution automatique à celui qui découvre le dossier.

Vérification : deux propriétaires, deux onglets, perte d'ACK, déconnexion en
publication/migration, reprise sans perte, suppression de compte serveur éteint,
copie manuelle du dossier, contrôle des exclusions et binaires non publiés.
Garde : jamais purger `project_drafts` globalement ; le mode hébergé en a encore besoin.
Docs : entities, WS, internals, ADR stockage, sauvegardes et brouillons publics.

## Phase 4 — Stockage hébergé durable et éditeur sans serveur

Suivre les contrats Phase 1, le format d'assets de l'ADR assets et les patterns
`projectFromFiles`, `diskSave`, `backendDrafts`, `useDraftSync`.

1. Implémenter l'adaptateur hébergé avec fichiers texte et binaires durables,
   verrouillage partagé entre workers, CAS, staging puis activation atomique d'une
   révision. Journaliser la reprise et collecter les fichiers abandonnés sans
   supprimer ceux référencés par un brouillon ou une opération en cours.
2. Conserver les brouillons hébergés dans le format commun ; les index SQL ne
   deviennent pas une seconde représentation éditable du contenu. Prévoir un
   export administratif complet et un test de restauration fichier + métadonnées.
3. Ajouter la création et la liste « Projets hébergés » au niveau Network ; choisir
   une version Minecraft et un modèle vanilla. Le projet reçoit des URLs sans serveur.
4. Adapter le contexte de l'éditeur et son autosave au stockage, en conservant un
   seul canvas et les stores domaine. Distinguer « brouillon enregistré » de
   l'application explicite au projet ; côté hébergé, cette action ne publie rien en jeu.
5. Résoudre assets, catalogues et fonctionnalités via les capacités. Les données
   d'exemple sont identifiées comme telles. Capture joueur, exécution et données
   de plugins exigent une connexion ; une prévisualisation reste utilisable.
6. Adapter l'assistant authentifié au contexte hébergé (fichiers/upload, crédits
   Network), sans requêtes serveur implicites. Auditer ses scopes et reprises.
7. Garder le secours navigateur existant, scoped propriétaire/projet ; il n'est
   ni la source de vérité ni une troisième option de stockage. Une coupure
   suspend les écritures et préserve le buffer ; reprise contrôlée par révisions.

Vérification : création/édition/rechargement avec zéro serveur, import/export
avec textures/polices, persistance après redémarrage backend, restauration,
concurrence, isolation, même fixture rendue par les deux modes. Tests UI des
capacités, de la coupure et de la reprise. Pas de promesse d'édition sans Internet.
Docs : stack et exploitation du volume durable, env/Compose si nécessaire,
REST, internals, docs-site projets et capabilities ; design system existant.

## Phase 5 — Copier un projet hébergé vers Minecraft

Réutiliser les opérations de création/CAS et d'assets découvertes, ainsi que
les tests d'import/export ; ajouter d'abord un scénario de copie complète.

1. Action « Copier vers un serveur » : choisir un serveur autorisé connecté,
   vérifier la compatibilité plugin/version/modules et proposer un nom libre.
2. Copier une révision figée du contenu enregistré, assets compris. Si le brouillon
   courant diffère, proposer de l'appliquer ou de copier la version enregistrée.
   Ne pas copier les brouillons privés d'autres personnes ni l'historique par défaut.
3. Créer dans un staging invisible au runtime ; contrôler taille, chemins et
   intégrité de tous les fichiers avant activation et hot-reload. Un identifiant
   d'opération rend les retries idempotents même après déconnexion.
4. Enregistrer le nouveau projet backend après confirmation vérifiée, avec reprise
   possible si le serveur a activé le dossier avant la panne. Ouvrir la copie et
   laisser le projet hébergé indépendant. Aucun écrasement d'un dossier existant.

Vérification : assets complets, destination occupée, interruption pendant upload
et après activation, retry sans doublon, droits insuffisants, absence de publication
partielle, source inchangée. Test réel en jeu du projet copié et de son resource pack.
Garde : pas de synchronisation permanente, fusion de projets ou déploiement multi-serveur.
Docs : WS/REST, guide « Créer sans serveur puis copier vers Minecraft ».

## Phase 6 — Démo anonyme, conservation après inscription

État du 2026-09-13 : socle backend vérifié (isolation, quotas, activité effective,
claim/reprise, brouillons, sauvegarde et purge physique puis métadonnées à 24 h).
Dernière vérification ciblée : 31 tests démo/catalogue verts. Acceptation navigateur
réelle vérifiée : même projet après claim, brouillon privé révision 3 et PNG
conservés, reprise authentifiée sans cookie invité réussie (200), expiration 410.
Le parcours réel « Try the demo » jusqu'aux sprites prend 1,748 s à chaud sur
volume Docker Linux ; l'ancienne mesure 7,726 s sur bind Windows n'est pas une
mesure de production. Preuves locales : `.scratch/phase6-acceptance/claim-report.json`
et `warm-report.json`. La régression `confirmDemoDraft` est couverte : une session
de brouillon absente est rechargée avant le claim, avec maintien du contrôle CAS.

Lire `accounts-only-editing.md` et les protections de sessions existantes avant
de créer l'exception invitée. Réutiliser l'adaptateur hébergé et le même éditeur.

1. « Essayer la démo » ouvre un projet d'exemple prévalidé dans une session isolée.
   Cookie opaque HttpOnly, expiration, vérification d'origine et protection CSRF
   pour les mutations ; aucune identité invitée reçue comme preuve dans le body.
2. Appliquer côté backend quotas de stockage et fréquence de création, limites
   d'uploads, budget global et collecte des sessions expirées. Aucun accès aux
   routes serveur, crédits, invitations ou fichiers d'une autre démo.
3. Montrer la durée de conservation et le statut temporaire. Autoriser l'édition,
   la reprise pendant la session et l'export portable. Proposer « Conserver mon projet ».
4. Après inscription/connexion, réclamer atomiquement la démo vers un Network
   autorisé choisi ou créé. Préserver fichiers, assets et brouillon, remapper le
   propriétaire invité, invalider son accès. Double clic/retry ne duplique rien.
   Une collecte TTL ne doit pas supprimer un projet en cours de réclamation.

Vérification : deux navigateurs isolés, édition avant compte, refresh, expiration,
quotas, login OAuth avec retour, réclamation concurrente, conservation des assets
et du brouillon. Mesurer délai clic→éditeur interactif ; cible proposée <5 s sur
environnement de référence chaud, hors délai réseau exceptionnel.
Garde : pas de réintroduction des anciennes sessions anonymes liées aux serveurs.
Docs : amendement limité accounts-only, parcours démo, confidentialité, env et ops.

## Phase 7 — Validation transversale et livraison progressive

Validation backend terminée : wrapper sécurisé `artisan_test*`, migration unique,
un processus Bun par fichier pour isoler les mocks ; arguments ciblés conservés.
Premier passage complet : 143 fichiers, 1 184 succès, 3 échecs, 2 skips existants.
Catalogue corrigé et limites de temps explicites pour deux scénarios IA longs ;
second passage complet vert sous Bun 1.3.11 : 143 fichiers, 1 191 succès, zéro
échec, deux tests conditionnels ignorés (backup CLI réel et fournisseur IA externe).
Logs : `artisan-test-results-f3Zdaz` dans le répertoire temporaire du runner.
Le backup PostgreSQL réel avait été vérifié séparément en phase 6 ; cette suite
ne réaffirme pas une exécution du fournisseur IA externe. Acceptation E2E distincte.

Chaque phase suit tests rouges → implémentation → tests verts, puis documentation
correspondante. Réutiliser les suites existantes, ajouter les scénarios qui prouvent
les invariants ; les commandes ci-dessous sont à exécuter pendant l'implémentation.

- Backend : `cd backend`, `bun run test` (jamais `bun test` direct),
  `bun run db:generate` pour tout changement SQL, migration sur base de test.
- Éditeur : `cd editor`, `npm test -- --run`, `npm run lint`, `npm run build`.
- Plugin : `cd plugin`, `./gradlew test`, `./gradlew shadowJar`.
- E2E : `npm run test:e2e` côté éditeur ; ajouter la matrice serveur/hébergé/démo,
  coupure/reprise, rename, publication en conflit, copie et claim.
- Vérifier import legacy → export courant → runtime, appels d'add-ons @Stable,
  hashes/exclusions, droits multi-tenant, sauvegarde/restauration et migrations.
- Auditer l'absence de `manifest.projectId` comme identité autoritaire, de requêtes
  WS dans les parcours hébergés, de secrets serveur pour les invités, et de copies
  backend actives pour les projets serveur migrés. Conserver `project_id` sur le
  fil et les FK internes quand ils ont encore un sens : aucune suppression aveugle.
- Déployer d'abord les capacités compatibles backend/plugin, puis activer les
  brouillons serveur par projet ; ouvrir l'hébergement aux comptes, puis la démo.
  Un rollback désactive les nouvelles entrées, conserve les données et ne remet
  jamais une ancienne copie backend en autorité sur un projet serveur migré.
- Terminer par `/sync-docs` si l'ampleur dépasse les petites mises à jour same-commit.
  Ne pas présenter les décisions proposées comme déjà implémentées dans les ADRs.

Critère final : une personne ouvre la démo sans compte, modifie et conserve son
projet après inscription, le recharge sans serveur, le copie sur Minecraft, puis
édite sa copie serveur avec brouillons sur disque. Un renommage UI conserve les
liens ; une interruption à chaque étape ne perd aucun travail confirmé enregistré.

## Limites assumées de cette première livraison

Pas de synchronisation bidirectionnelle, d'édition collaborative temps réel, de
simulation complète de Minecraft, de marketplace ou de migration automatique des
références externes. Le serveur reste nécessaire pour ouvrir un projet serveur ;
un projet hébergé exige l'accès à Artisan. Les projets d'add-ons gardent
durablement un ID explicite enregistré par le module, via l'API stable existante.

## Journal d'exécution

- Phases 1 à 4 vérifiées par revue transversale. Phase 4 livrée : workspace
  partagé, client lié à l'identité immuable, création hébergée sans serveur,
  mutations d'assets privées et archives texte/binaires atomiques. La démo
  anonyme n'est pas implémentée dans cette phase.
- Phase 4 éditeur : 400 assertions ciblées vertes, puis suites corrigées de
  nettoyage/reprise (11 tests), routes/rendu (58 tests) et revue finale (9 tests).
  Le premier asset crée explicitement son brouillon ; une génération de session
  annule les imports en cours à la déconnexion, même si le même compte revient.
- Phase 4 finale : stockage (30 tests) et routes (16), frontières backend (47),
  assistant (25), hub (59), plugin (20) ; éditeur 400 assertions / 56 fichiers,
  routes/rendu (58), correctifs de revue (9). TypeScript application et build verts.
- Phase 5 vérifiée : copie atomique backend/plugin et action éditeur commune.
  Choix explicite version enregistrée ou application du brouillon, reprise par UUID
  scoped compte/projet, capacité `canCopyToServer`. Phase 6 vérifiée dans le navigateur.
- Phase 5 intégration locale réelle : sauvegarde PostgreSQL et plugins avant
  migrations/déploiement ; copie complète avec glyphes et police, retry idempotent,
  source inchangée, relecture binaire identique et resource pack généré. Chromium :
  brouillon hébergé conservé après reload, application puis copie, navigation et
  quatre canvas chargés sans erreur JavaScript. Client protocole sur serveur
  Paper 1.21.11 jetable isolé : fenêtre de 27 slots reçue, resource pack téléchargé
  (10 059 440 octets, SHA-1 vérifié), ACK protocole envoyé. Aucun rendu graphique
  Minecraft revendiqué. Deux défauts RP corrigés par tests : préparation stricte
  après activation et téléchargement des IDs serveur `srv_`. Fixtures supprimées
  par IDs exacts ; preuves et recette dans `.scratch/phase5-integration-20260913/`.
- Phase 5 éditeur : 60 tests ciblés / 9 fichiers, puis 16 tests finaux copie/UI
  incluant limites et rejets préalables confirmés ; TypeScript application, Biome
  ciblé et build de production verts. Vérification backend/plugin suivie séparément.

- 2026-09-12 — Démarrage de la phase 1 après validation. Architecture acceptée
  dans [project-storage-modes](../../decisions/project-storage-modes.md).
- Baseline éditeur : 3 fichiers, 31 tests verts (`backendDrafts`,
  `saveProjectToDisk`, `projectFromFiles`). Aucun test backend lancé lors de ce
  préflight afin de ne pas partager la base de test avec une autre suite.
- Les modifications préexistantes du workspace sont préservées. Aucune
  migration de production exécutée au stade de ce préflight.
- Phase 1 : fondations vérifiées (14 tests), routes et compatibilité vérifiées
  (154 tests distincts). Aucun nouveau diagnostic TypeScript par rapport au
  baseline HEAD après correction des gardes d'identité des routes.
- Les assertions SQL de rejet utilisent une attente et une capture explicites :
  le matcher de rejet bloquait ces requêtes dans le runner ; les contraintes et
  leurs codes d'erreur restent vérifiés, sans modification de la règle SQL.
- Phase 2 démarrée. Les ports de cycle de vie et de brouillons restent à compléter
  en phases 2 et 3 ; le runtime hébergé n'est pas encore disponible.
- Phase 2 éditeur : 170 tests verts dans 15 fichiers (import/export, identité,
  renommage et reprise, brouillons en cours, routes), vérification Biome ciblée
  et bundle Vite verts. Les contrôles backend/plugin restent suivis séparément.
- Phase 3 éditeur : client `persistedDrafts` indépendant du stockage, opérations
  idempotentes conservées avec leur snapshot dans le secours par propriétaire,
  références binaires préservées, état de migration explicite. Une première
  ouverture attend le serveur ; une coupure conserve le buffer déjà ouvert.
  Archives et arbres publics excluent les métadonnées privées ; l'import texte
  refuse les binaires au lieu de les corrompre. Régressions ciblées : 361 tests
  verts dans 43 fichiers ; reprise finale vérifiée dans 41 tests, TypeScript
  application, Biome ciblé et build Vite verts. La publication réapplique la
  base réellement confirmée aux nouvelles frappes et intentions de renommage.
  Phase 3 reste en cours jusqu'à vérification backend/plugin et revue transversale.

- Audit final sync-docs : statuts ADR/plan, identité stable des add-ons, exemple
  Boutique historique et distinction création serveur/démo alignés. Le mapping
  local conserve des chemins anciens (CLAUDE/Ifz/gg.interfaze) ; les correspondances
  AGENTS actuelles ont servi de référence. Aucun changement du mapping.

- Phase 7 vérifiée : après conservation de la démo, copie
  idempotente vers le serveur, source inchangée et PNG de SHA-256 identique.
  Un vrai client protocole rejoint le serveur et reçoit le menu de 27 slots ;
  le resource pack de 10 058 568 octets est téléchargé, son SHA-1 vérifié et son
  accusé de réception protocole envoyé. Cela ne prouve pas un rendu graphique
  Minecraft. Le brouillon serveur révision 1 est conservé après renommage.
  Preuves : `.scratch/phase6-acceptance/copy-report.json` et `player-report.json`.
  Vérification hors ligne : cible serveur 503, source hébergée toujours 200.
  Après claim, une nouvelle ouverture puis sélection de Compass affiche le nom
  français exact « Acceptance confirmed second » ; le titre du menu demeure
  volontairement inchangé (`claimed-item-title.png`). Déploiement local terminé :
  sauvegarde coordonnée SQL et volume, backend arrêté, puis migrations 0045–0047
  appliquées (48 migrations au total), health 200 et vraie démo ouverte sur 5173.
  Nettoyage terminé : fixture locale supprimée par ID exact, conteneurs/volume/bases
  dédiés et secrets de test supprimés, preview arrêté. Stack principale active,
  authentification Minecraft inchangée. Recette et preuves :
  `.scratch/phase6-acceptance/RUNBOOK.md` ; backup coordonné conservé dans
  `.scratch/phase6-deploy-backup-20260913/`.
