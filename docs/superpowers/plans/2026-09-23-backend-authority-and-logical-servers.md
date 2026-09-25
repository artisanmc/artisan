# Serveurs logiques, autorité backend et déploiement explicite — plan d’implémentation

> **REPORTÉ le 2026-09-24 — piste séparée, non validée.** Le serveur logique et l'autorité backend
> sont sortis du chantier « registre serveur + canvas dérivé » et seront traités plus tard. Il
> faudra alors reprendre ce document sous forme de spec propre. Voir la section « Hors périmètre »
> de `docs/specs/server-registry-and-derived-canvas.md`.

Date : 2026-09-23. Statut : **proposition détaillée, à valider avant implémentation**.

Ce plan complète le [registre et canvas dérivé](2026-09-23-server-registry-and-derived-canvas.md)
et sa [spec produit](../../specs/server-registry-and-derived-canvas.md). Il remplace la
proposition de trois propriétaires d’espace (`server | account | demo`) ainsi que
l’autorité du disque Minecraft pour les projets migrés. Aucun code n’est implémenté ici.
Les noms de nouveaux services, tables, messages et commandes sont des propositions.

## 1. Décisions, périmètre et points à confirmer

### Direction retenue

- Un **serveur logique** est l’espace de travail, toujours dans un **Network**.
- Ce serveur peut être rattaché à un véritable serveur Minecraft ; ce rattachement est facultatif.
- Les projets, Documents et interfaces ont le même fonctionnement en personnel, partagé et démo.
- Le backend conserve le travail, les brouillons et les révisions ; Minecraft exécute une copie
  déployée. L’arrêt de Minecraft ne bloque plus l’édition.
- Les fichiers restent un format canonique portable. « Backend autoritaire » ne signifie pas
  convertir tout le YAML et les binaires en lignes SQL.
- Les changements manuels sur Minecraft restent possibles via un import explicite ; les
  agents pourront ultérieurement utiliser les mêmes services métier via MCP.
- `default` est une aide initiale, créée une seule fois. Tous les projets sont supprimables,
  y compris le dernier. Un espace volontairement vidé n’est jamais réinitialisé.
- Unicité des Documents par serveur logique ; préfixes automatiques `menu_`, `cmd_`,
  `dialog_` pour les nouveaux Documents ; ids existants conservés ; boutons locaux.
- Une version Minecraft cible par serveur logique, héritée par tous ses projets.

### Modalités proposées pour cette première version

| Sujet | Proposition du plan |
|---|---|
| Cardinalité | Un Network contient plusieurs serveurs logiques ; un serveur possède zéro ou un rattachement Minecraft actif ; une installation physique n’est rattachée qu’à un serveur logique actif |
| Personnel | Un Network personnel privé créé idempotemment pour l’utilisateur, réutilisé par les nouveaux parcours personnels ; pas un nouveau modèle de stockage |
| Démo | Un Network temporaire et un serveur logique, autorisés par une session invitée ; aucun faux compte ni membership utilisateur inventé |
| Reprise démo | Transférer le serveur logique entier dans un Network autorisé ; ne jamais le fusionner implicitement avec un autre serveur |
| Publication | Sauvegarde privée → publication d’une révision commune dans la plateforme → déploiement explicite, trois états distincts |
| Hors ligne | Éditer avec Minecraft arrêté ; backend nécessaire pour synchroniser le travail. Le mode navigateur totalement hors ligne n’est pas ajouté ici |
| Cible déconnectée | Publier reste possible ; déployer est indisponible. Pas de file d’attente qui déploie automatiquement à la prochaine connexion en V1 |
| Jeu sans backend | La dernière version déployée continue de fonctionner localement |
| Add-ons | Contrat explicite configuration éditable / seeds / données runtime ; pas de synchronisation implicite de toute leur racine |
| Collaboration | Concurrence sûre et événements de révisions dans le socle ; coédition simultanée d’un même brouillon dans une tranche ultérieure |
| MCP | Adaptateur des services métier, droits d’édition distincts du déploiement ; tranche après stabilisation des contrats |

**Décision confirmée : conserver les Networks actuels pour les projets hébergés existants.**
Créer leurs serveurs logiques dans le même Network, en conservant membres, rôles et droits
de partage. Cette décision remplace le transfert vers le propriétaire individuel et le
retrait du partage précédemment envisagés. Les brouillons privés gardent leur propriétaire.
Le Network personnel proposé pour les nouveaux parcours n’est pas une destination de
migration des projets existants.

Autres limites assumées : pas de multi-cible, de fusion implicite de serveurs, de transaction
de déploiement inter-projets, de synchronisation bidirectionnelle automatique ni de CRDT
généralisé dans le socle. Elles ne sont pas nécessaires pour éditer serveur arrêté.

## 2. Phase S0 — découverte et contrats existants à réutiliser

Les sources ont été confrontées au code courant, y compris les modifications non commitées.
Le graphe contient des copies `.scratch` et des positions périmées : rechercher les symboles
avant chaque tranche et revérifier les fichiers. Les lignes suivantes sont des repères.

| Source actuelle | Constat / motif réutilisable | Conséquence |
|---|---|---|
| `backend/src/db/schema.ts:32`, `routes/userNetworks.ts:459` | `serverKeys` porte identité/Network et `hash:null` pour un serveur non relié | Conserver les `srv_*` ; dissocier logique et credentials |
| `schema.ts:15,341`, `lib/capabilities.ts:7,31` | Pas de propriétaire unique du Network ; plusieurs owner/admin possibles | Conserver les memberships et droits ; aucun propriétaire individuel à désigner pour la migration |
| `schema.ts:104–199` | Catalogues modules, modèles et sources liés au serveur | Séparer dernière connaissance persistée et disponibilité live |
| `schema.ts:363,375–412` | Démo mono-projet ; hébergé appartient directement au Network ; version par projet | Migrer la relation Project→Server et les contraintes sans perte |
| `lib/storage/hostedProjects.ts:17,28` | `createHostedProject(input)` et son `ownerId` servent aussi à l’idempotence | `ownerId` n’est pas une preuve de propriété historique |
| `lib/storage/HostedProjectStorage.ts` | Fichiers/binaries, CAS, drafts privés et opérations atomiques | Base du stockage commun ; conserver son contrat |
| `lib/storage/hostedFilesystem.ts:267,282,314` | GC des révisions non courantes ; réponses d’opérations à rétention limitée | Ajouter snapshots publics retenus et références durables avant de déployer |
| `lib/storage/DraftStore.ts:43`, `routes/projectDrafts.ts:18` | Brouillons persistants via ProjectStorage, pas table SQL universelle | Garder propriété privée et baseline lors de migration |
| `plugin/.../provider/SyncedMenuProvider.kt:841,868` | `project_read` lit le snapshot du dernier reload | Un import local doit capturer le disque réel, pas appeler ce read |
| `plugin/.../project/ProjectPublisher.kt` | Journal de publication et reçus fingerprintés ; retry sans rejouer l’écriture | Réutiliser journal, staging et récupération pour deploy |
| `SyncedMenuProvider.kt:1213` | Écriture durable et reload peuvent avoir des résultats différents | Distinguer fichier installé et activation runtime |
| `backend/src/ws/hub.ts` (`local_push` / `sync_divergence` retirés) | Les anciennes descriptions de pushLocal ne décrivent plus un chemin actif | Nouveau contrat d’import explicite ; pas de réactivation implicite du vieux sync |
| `lib/deleteStoredProject.ts:5`, `plugin/.../sync/ProjectDeleter.kt:28` | Soft-delete puis notification sans reçu de suppression complet | Séparer suppression plateforme et retrait déployé |
| `plugin/.../project/ProjectRoots.kt:35,42,52` | `register(projectId, dir)`, racines add-ons et enregistrement tardif | Ne pas traiter toute racine comme des fichiers gérés par la plateforme |
| `lib/demoSessions.ts:349,380,467` | Claim avec intention durable, checkpoints et réautorisation | Étendre au serveur entier et à tous les brouillons |
| `lib/membershipGuard.ts:27` | `withNetworkMemberLock` | Modèle pour coordonner accès et mutations de Network |
| `editor/src/features/project/useProjectLoader.ts:108` | Loader avec effets globaux | Refactor commun prévu dans le plan registre, pas N copies du hook |
| `persistedDrafts.ts:234,515`, `saveProjectToDisk.ts` | Flush et publication ; boucle possible après de nouvelles éditions | Figer la révision revue, pas « tout ce qui sera courant au moment d’envoyer » |

À lire avant implementation : [project-storage-modes](../../decisions/project-storage-modes.md),
[server-disk-only-storage](../../decisions/server-disk-only-storage.md),
[files-first](../../decisions/files-first-source-of-truth.md),
[add-on roots](../../decisions/addon-owned-project-roots.md),
[entities](../../architecture/entities.md), [WS](../../architecture/ws-protocol.md),
[API stable](../../architecture/api-surface.md), [sauvegardes](../../operations/hosted-storage-backup.md).
Ces ADR décrivent l’existant ou son histoire ; les supplanter explicitement, sans les
réécrire comme si le nouveau modèle était déjà livré.

**Sortie S0 :** inventaire des writers (UI, API, modules, plugin, import/copie, démo,
assistant), contrats réellement disponibles, fixtures legacy et matrice de compatibilité.
Les services proposés ci-dessous ne sont pas des méthodes à appeler avant de les créer.

## 3. Modèle cible et invariants

```text
Network
  └─ Server logique (version cible, initializedAt, lifecycle)
       ├─ Project[] → arbres backend + brouillons privés + révisions publiques
       ├─ Registry / Canvas / Search / Data / Assets
       └─ DeploymentBinding? (installation, credentials, epoch, version observée)
            └─ Deployment[] → manifeste figé + résultats par projet
                 └─ Minecraft : copie déployée + données runtime séparées

DemoSession → Network temporaire + Server autorisé
Compte → memberships Network → serveurs accessibles
```

### Identités et persistance proposées

- **Server** : réutiliser l’ancre `srv_*`, relation Network, label/slug, version cible,
  état d’initialisation, état de migration/autorité. Le nom SQL peut évoluer par étapes ;
  ne pas laisser `serverKeys` rester conceptuellement à la fois espace et secret.
- **DeploymentBinding** : serverId, installationId, génération/epoch, credentials hachés,
  statut, version observée et capacités négociées. Rotation/reconnexion ne change pas Server.
  Rotation de sécurité invalide les anciennes opérations selon une règle explicite.
- **Project** : serverId obligatoire à terme, ancre immuable, externalId unique par Server,
  stockage backend, provenance et politique de fichiers. Namespace Document unique par Server.
- **PublicRevision** : arbre public immuable, hash/manifest, version de format, auteur,
  parent et date. Référence durable tant que déployable, déployé, base d’import ou retenu
  par l’historique. Ne contient ni drafts privés, ni secrets, ni journal d’authentification.
- **Deployment / DeploymentProject** : intention idempotente, binding+epoch, sélection
  figée de révisions et retraits, baseline attendue, hash observé, reçu durable et résultat
  d’activation. Les projets supprimés gardent un tombstone et leur baseline de déploiement.
- **LocalImport** : capture immuable de fichiers gérés réellement présents/absents, baseline,
  manifest/hashes, créateur autorisé, collisions et décisions de merge par projet.
- **Journal d’événements / outbox** : événements après mutation durable, identifiants et
  séquences de reprise. Éviter la fenêtre « commit réussi, notification perdue ».
- **DemoSession** : preuve d’accès au serveur temporaire, quotas/TTL communs, intention de
  claim ; ne plus dépendre de l’existence d’un projet pour considérer la session valide.

Projets restent des arbres de fichiers : reprendre le stockage hébergé sur volume durable,
PostgreSQL pour ancrages, droits, opérations et références de rétention. Ajouter une couche
de snapshots publics sans exposer l’enveloppe interne contenant des données privées.
Une transaction SQL n’englobe pas les fichiers : écrire/valider en staging, enregistrer une
intention, activer, puis reprendre/reconcilier après crash. Le GC ne supprime ni staging
engagé, ni snapshot référencé, ni baseline ; les orphelins sont collectés après délai borné.

### Droits, cycle de vie et affichage

Réutiliser `edit_content` pour les drafts, `publish_content` pour publier. Introduire un
droit de déploiement explicitement mappé aux rôles existants (proposition V1 : les mêmes
rôles que publish), sans l’accorder automatiquement à un token d’agent limité à l’édition.
Rattachement/détachement et transfert de serveur : `manage_servers` ou capacité dédiée
équivalente, vérifiée sur les Networks concernés. Le claim actuel fondé sur edit_content
ne doit pas permettre d’ajouter un serveur à un Network sans ce droit.

Supprimer un projet plateforme ne retire pas immédiatement ses fichiers en jeu. La revue
de déploiement montre ce retrait. Détacher une cible conserve le contenu backend et la copie
sur l’installation ; révoquer les credentials et clôturer les opérations concernées.
Supprimer un serveur logique est un geste distinct de vider ses projets, avec revue du
contenu et traitement explicite du rattachement. La suppression de compte ne doit pas
emporter un Network partagé dont d’autres membres disposent encore.

Une cible est décrite indépendamment du contenu : non rattachée / connectée / déconnectée /
incompatible. Les contenus affichent brouillon sauvegardé / publié / à déployer / déployé /
divergence locale / activation échouée / résultat à vérifier.

### Trois états pour le disque local

Pour chaque chemin géré, comparer **B** (dernière base de déploiement confirmée),
**R** (révision backend choisie) et **D** (capture actuelle du disque). L’absence est une
valeur explicite ; aucune chaîne vide ne doit confondre absence, projet vide et erreur.

| État | Interprétation | Action |
|---|---|---|
| D = B, R ≠ B | Modification plateforme uniquement | Déploiement possible |
| D ≠ B, R = B | Modification locale uniquement | Import proposé ; déploiement suspendu pour éviter de l’effacer |
| D = R | Contenus déjà identiques | Reçu de vérification ; aucune réécriture nécessaire |
| D ≠ B, R ≠ B, D ≠ R | Deux côtés modifiés | Comparaison à trois voies, résolution nécessaire pour les chevauchements |
| B absente | Première liaison, nouvelle racine ou provenance inconnue | Inventaire et choix explicite ; jamais supposer un dossier vide |

En import, des chemins disjoints peuvent être combinés automatiquement dans une proposition
revue. Pour un même fichier modifié des deux côtés, commencer par un conflit explicite ;
merge YAML structuré et merge binaire ne sont pas requis en V1. Suppression/modification,
renommage, ajout du même id et binaire divergent sont des cas à part entière. Une résolution
fige les hashes comparés ; si R ou D change entre revue et application, refaire la comparaison.

Les verrous plugin coordonnent les writers Artisan ; ils ne verrouillent pas un agent/FTP
extérieur. Relecture avant activation, journal, sauvegarde et récupération sont nécessaires.
Ne pas promettre un snapshot ou une activation atomiques de plusieurs fichiers face à des
writers arbitraires. Détecter l’instabilité et demander un arrêt des écritures externes pour
reprendre, sans écraser une divergence silencieusement.

## 4. Ordre d’implémentation

Chaque phase commence par des tests de comportement rouges, puis implementation, tests
verts et documentation. Les preuves incluent les erreurs/crashes, pas seulement le chemin nominal.

```text
S0 inventaire
 → S1 identités/droits
 → S2 stockage/snapshots retenus
 → S3 CRUD/édition backend
 → S4 rattachement/protocole
 → S5 déploiement
 → S6 import local/add-ons
 → S7 migration serveurs existants
 → S8 hosted/démo/Network + reprise
 → S9 validation/bascule/doc
 → S10 MCP (extension séparée)
 → S11 coédition live (extension séparée)

Registre/canvas : fonctions pures possibles tôt ; shell attend S1–S3,
revue de déploiement attend S4–S6 ; lancement public coordonné avec S7–S9.
```

### S1 — Identité Server et autorisations communes

**À implémenter**

1. Reprendre la création `hash:null` de userNetworks pour créer un serveur sans émettre
   obligatoirement de code de liaison. Conserver les ids existants et introduire le binding.
2. Ajouter serverId aux projets et état de migration ; backfill des projets serveur déjà
   rattachés. N’ajouter les contraintes finales qu’après migrations hébergée/démo.
3. Définir les invariants SQL : un seul binding actif par serveur/installation, externalId
   unique par serveur, relations contrôlées aux Networks. Adapter réservations de rename.
4. Centraliser l’autorisation Network→Server→Project et les droits de déploiement, transfert,
   créateur de draft. Réutiliser membershipGuard pour la révocation concurrente.
5. Introduire Network personnel/temporaire avec politiques explicites de liste, droits,
   quotas et lifecycle. Un Network temporaire n’ouvre ni invitations ni facturation.
   Auditer les limites commerciales et le calcul des droits : distinguer nombre de serveurs
   logiques, rattachements Minecraft et volume backend. Préserver les droits déjà acquis,
   ne pas appliquer une facturation automatique à une migration ou une démo ; toute nouvelle
   tarification reste un arbitrage produit séparé de l’unification technique.
6. Garder les anciens routes/ids via résolution autorisée ; définir les routes Server communes.
   Toute rupture de contrat public suit le versioning existant ; migration SQL forward-only.

**Sources :** schema, userNetworks, capabilities, membershipGuard, projectPrincipal,
projectAccess, refs, projectRename ; docs entities/versioning/api-surface.

**Tests :** serveur sans credentials, mêmes ids après backfill, deux bindings actifs rejetés,
accès croisé refusé, rôle member sans manage_servers ne transfère pas une démo, révocation
pendant opération, Network provisoire non accessible au seul cookie de compte.

**Garde-fous :** aucune identité dérivée d’un secret ; pas de fausse membership invitée ;
pas de propriétaire déduit du premier owner. **Docs :** CONTEXT, entities, REST, CHANGELOG,
migrations générées par `bun run db:generate`.

### S2 — Stockage backend commun et révisions retenues

**À implémenter**

1. Reprendre HostedProjectStorage et ses tests de contrat comme implementation commune
   du contenu éditable. Garder ServerProjectStorage uniquement pour le parcours legacy
   avant bascule ; les services de déploiement ne doivent pas resservir de storage d’édition.
2. Extraire l’arbre public d’une publication dans un snapshot immuable adressé par id/hash.
   Inclure YAML, binaires et métadonnées éditeur publiques ; exclure drafts/histoires privés.
   Distinguer empreinte de révision d’édition et empreinte du contenu affectant le jeu :
   déplacer un pin seul ne doit pas signaler un nouveau déploiement runtime nécessaire.
   Conserver intégralement les métadonnées dans les snapshots/exports ; classifier leurs
   champs avant toute exclusion du payload, car editor.yaml contient aussi i18n/items.
3. Ajouter références de rétention pour opérations revues/en cours, révisions déployées,
   baselines d’import et historique retenu. Adapter `collect()` ou séparer physiquement
   l’entrepôt public ; ne pas référencer un UUID actuellement supprimé au prochain commit.
4. Coordonner journal, fichiers et SQL/outbox avec checkpoints reprenables. Un reçu durable
   de déploiement ne dépend pas de la rétention de réponse de mutation hébergée à 24 heures.
5. Migrer l’inventaire de maintenance/backup vers tous les projets backend, quelle que soit
   leur provenance. Restaurer ensemble PostgreSQL, racines, snapshots et références.
6. Garder une implémentation de hash par langage et les vecteurs de conformité existants.
   Si le périmètre du manifeste diffère de l’ancien bundle, versionner ce contrat et ajouter
   un vecteur partagé ; ne pas réutiliser un hash incompatible sous le même nom.

**Sources :** HostedProjectStorage, hostedFilesystem, hostedMaintenance, DraftStore,
hashUtils / BundleHasher, testdata de hash ; guide hosted-storage-backup.

**Tests :** reprendre HostedProjectStorage.test.ts (CAS, concurrence multiprocessus,
crash, corruption), puis vérifier : publication suivie de GC laisse le snapshot déployable ; draft privé absent du
payload ; crash à chaque checkpoint ; reprise sans double revision ; contenu binaire exact ;
rétention baseline d’un projet supprimé ; backup/restauration avec opération en cours.

**Garde-fous :** historique par fichier ≠ snapshot complet ; pas de métadonnées privées dans
une URL de bundle ; pas de DB seule considérée comme sauvegarde. **Docs :** ADR stockage,
invariants, opérations de sauvegarde, variables de volume si modifiées.

### S3 — CRUD, publication et édition avec Minecraft arrêté

**À implémenter**

1. Faire passer listing/read/write/drafts/assets/history/import ZIP/copy/rename/delete
   par les services backend et les permissions S1. Auditer tous les anciens writers.
2. Initialiser `default` avec journal/état au niveau Server. Reprise idempotente, état vide
   légal, aucune recréation après suppression. Marquer les espaces existants initialisés.
3. Porter la version cible sur Server ; conserver la version observée du binding. Valider
   les catalogues et compatibilités au changement de version, sans convertir des projets.
4. Publier une révision revue avec baseline attendue et operationId/fingerprint. Contrôler
   sous verrou serveur l’unicité des Documents face aux publications concurrentes.
   Les drafts privés ne réservent pas définitivement leurs ids dans l’espace partagé.
5. Préserver les drafts privés et leurs propriétaires ; séparer édition locale non encore
   sauvée, sauvegarde backend, publication et déploiement. Retrait projet = tombstone publié.
6. Adapter les clients/capacités : backend accessible + Minecraft arrêté = édition possible ;
   catalogue live affiché comme dernière observation, actions réelles en jeu indisponibles.
   Émettre les événements de révision durables pour rafraîchir les autres sessions.

**Sources :** projectDrafts, projectPrincipal, persistedDrafts, saveProjectToDisk,
useProjectLoader, projectRuntimeStore, projectRuntime, code de création des Documents.
Graphe/unicité partagés avec P1 du plan registre, sans deux validateurs TS divergents.

**Tests :** même CRUD sans cible et cible arrêtée, deux publications concurrentes en collision,
suppression de tous les projets puis restart, version incompatible, draft tiers refusé,
événement après commit, navigateur en retard n’écrase pas une révision plus récente.

**Garde-fous :** aucun fallback disque après bascule, aucun publish qui déploie implicitement,
aucun bootstrap basé sur `projects.length`. **Docs :** REST, editor-internals, guides projets,
brouillons et publication, CHANGELOG.

### S4 — Rattachement et protocole de déploiement

**À implémenter**

1. Reprendre les codes de liaison et authentification existants en les attachant au binding,
   sans transformer attach/detach/rotation en création/suppression de contenu.
2. Ajouter une négociation explicite des capacités/protocole. Un plugin ancien peut rester
   legacy ; il ne peut pas écrire dans un serveur logique déjà basculé backend.
3. Définir les messages d’inventaire réel, préparation, application, statut/reçu et activation
   runtime. Inclure operationId, fingerprint, binding/epoch, projectId, version de manifeste,
   révision attendue, baseline, dépendances modules et hashes. Ne pas exposer des chemins absolus fournis par le client.
4. Au premier rattachement, inventorier les racines existantes et proposer import local ou
   installation des révisions backend revues. Jamais de sweep automatique d’un serveur inconnu.
5. Fencer les anciennes connexions et commandes en vol ; revérifier droits, binding et epoch
   avant application. Une reconnexion reprend un reçu, pas le déploiement d’une révision plus récente.
6. Définir états et délais : refus avant écriture, écriture engagée, écrit, activation réussie/
   échouée, résultat inconnu. Un timeout n’autorise ni nouveau contenu ni avance de baseline.
   Détacher empêche les nouvelles opérations ; si une écriture est déjà engagée, conserver
   son résultat historique même si la cible n’est plus active.

**Sources :** userNetworks/serverKeys, hub/protocol, WsClient/SyncedMenuProvider,
ProjectPublisher et ses reçus, documentation WS et discipline de versioning.

**Tests :** rotation/ancienne connexion, ACK perdu/retry même fingerprint, opérationId
réutilisé avec autre contenu refusé, reconnexion sans auto-deploy, première liaison sur
disque non vide, plugin ancien refusé après bascule, détachement pendant application.

**Garde-fous :** pas de changement implicite de sens d’un ancien message ; pas de secrets
dans URL/logs ; aucun I/O lourd dans callback OkHttp. **Docs :** WS, sécurité des liaisons,
REST/CHANGELOG si endpoints ajoutés.

### S5 — Déployer une sélection figée et suivre son activation

**À implémenter**

1. Préparer une revue depuis les révisions publiées et leur diff contre B ; stocker et
   retenir la sélection exacte et les retraits. Un clic ultérieur ne relit pas « latest ».
2. Préflight du serveur effectif : version, capacités, namespace Documents dans le résultat
   de la sélection + projets laissés en place + contenu local connu. Signaler références
   absentes ou dépendances non déployées ; empêcher collisions runtime. Déploiement partiel
   n’est pas une dispense de valider l’ensemble effectif.
3. Capturer D depuis le disque géré, comparer à B, suspendre toute divergence non résolue.
   Vérifier de nouveau sous les verrous d’application avant d’installer les fichiers.
4. Reprendre staging/journal/récupération de ProjectPublisher, contrôler chemins et checksums,
   sauvegarder les fichiers remplacés, puis activer par projet. Préserver données runtime
   et racines externes. Renommages/retraits font partie du manifeste revu, pas d’un sweep aveugle.
5. Émettre un reçu durable d’écriture ; mettre à jour la baseline installée uniquement sur
   preuve du contenu installé. Suivre séparément l’activation runtime et sa dernière version
   réussie. Une erreur de reload ne doit pas présenter l’ancienne baseline disque comme réelle.
6. Recharger de façon atomique les maps runtime, avec statut de parsing/activation précis.
   Conserver les fichiers problématiques et diagnostics ; recovery/rollback explicite.
7. Orchestrer plusieurs projets avec concurrence bornée et résultat individuel. Arrêt/crash
   au deuxième projet laisse un résultat partiel explicite, jamais « tout annulé » fictif.

**Sources :** ProjectPublisher, ProjectDeleter, SyncedMenuProvider.reloadFromDisk,
hashUtils/BundleHasher, revision retention S2 ; revue UI P9 du plan registre.

**Tests :** étendre ProjectWriteChannelTest (retry sans écraser une édition locale ultérieure),
ProjectDraftChannelTest (reçu avant reload) et ProjectPublisherRecoveryTest, puis : édition après revue exclue, disque modifié après preflight, retrait idempotent,
binaire corrompu, manque d’espace, crash staging/activation/reçu, reload échoué après commit,
reçu perdu sans seconde écriture, conflit namespace avec projet non sélectionné, succès partiel,
déploiement vide explicite, restauration du journal après restart.

**Garde-fous :** pas de baseline avancée à l’envoi, pas de lock global assimilé à une protection
contre FTP externe, pas d’écrasement add-on, pas de rollback qui annule des écritures locales
plus récentes sans les préserver. **Docs :** WS, opérations/deploy, guide UI, invariants.

### S6 — Import local explicite et contrat des add-ons

**À implémenter**

1. Ajouter une commande proposée `/artisan import-local [projectId]` et un équivalent UI.
   Elle prépare une capture/une revue ; elle ne publie ni ne déploie automatiquement.
   Documenter sa distinction avec `/artisan reload`, qui active le disque local en jeu.
2. Lire réellement le disque : inventaire stable, hashes avant/après capture, fichiers
   absents, binaires, renommages, projets ajoutés/supprimés et metadata publique. Refuser ou
   réessayer une capture instable ; exclure secrets, corbeille et fichiers runtime non gérés.
3. Comparer B/R/D, préparer une proposition par projet. Les changements disjoints se combinent ;
   chevauchements et binaires divergents demandent une résolution. Garder la capture originale.
4. Associer la capture à un utilisateur authentifié autorisé, ou à un import en attente sur
   le serveur que cet utilisateur peut réclamer. La clé machine peut envoyer une proposition,
   jamais se faire passer pour le propriétaire d’un brouillon privé. Console peut préparer,
   l’UI expose les droits requis pour publier.
5. Appliquer la résolution à un brouillon ou une nouvelle révision revue avec CAS. En cas de
   nouvelle mutation backend, recalculer/revoir ; aucune suppression de modification privée.
   La baseline de déploiement ne bouge pas lors d’un simple import : seul un reçu de
   déploiement/vérification lie B au disque installé.
6. Classer chaque chemin add-on : seed initial, configuration éditable, donnée runtime.
   Faire déclarer propriété et capacité de création par l’API modules versionnée.
   Un seed crée une proposition d’import ; il n’écrase pas le backend à chaque boot.
7. Migrer les writers d’add-ons contrôlables vers ce contrat. Pour un add-on externe sans
   contrat fiable, signaler l’état et désactiver déploiement/création risqués sur sa racine ;
   garder export/diagnostic et le runtime actuel. Désinstallation ne supprime pas le backend.

**Sources :** ProjectRoots, API modules, SyncedMenuProvider snapshot vs raw disk, ProjectReader,
ADR addon-owned-project-roots, moteur de merge existant à auditer avant réutilisation.
Le code de Boutique externe n’est pas dans ce dépôt : aucun comportement supposé garanti.

**Tests :** FTP sans reload puis import, suppression/modification, deux ajouts homonymes,
binaire divergent, backend changé après revue, console sans utilisateur, capture instable,
nouvelle racine add-on tardive, runtime data inchangée par deploy, seed redémarrage sans écrasement.

**Garde-fous :** ne pas appeler project_read pour scanner les fichiers actuels ; pas de commande
« force » générique ; aucune réactivation du vieux local_push retiré. **Docs :** commandes
AGENTS/install-admin, API modules/CHANGELOG, workflow agents/fichiers et résolution de conflits.

### S7 — Migration des serveurs existants et bascule d’autorité

**À implémenter**

1. Inventorier par serveur : versions plugin, roots core/add-ons, fichiers/binaires publics,
   états éditeur, drafts propriétaires, historiques et opérations en cours ; backup vérifiable.
   Une cible hors ligne reste « import requis », jamais un serveur backend vide prêt à déployer.
2. Négocier la capacité de migration ; terminer/reprendre les anciennes opérations puis
   poser un verrou/fence de génération. Suspendre les writers UI/API legacy du serveur.
   Les writers externes imposent une fenêtre stable contrôlée au moment de capturer.
3. Importer sans transformation les arbres, drafts et historique dans le stockage backend.
   Séparer le transfert de données privées du payload public de déploiement. Vérifier hashes,
   identités, propriétaires, nombres de fichiers et lecture de retour ; pas seulement ACK réseau.
   Préserver aussi les contenus legacy invalides ou en collision pour diagnostic ; ne pas
   les supprimer pour satisfaire une contrainte. Les placer dans un état de migration à
   résoudre avant activation incompatible, sans renommage forcé ni perte des références.
4. Journal durable par serveur et checkpoints par projet. Détecter ajouts/suppressions
   survenus pendant la copie. Reprendre le delta ou invalider la capture avant cutover.
   Garder la source et les backups tant que la migration n’est pas attestée.
5. Finaliser le serveur entier à une génération connue : backend autoritaire, marqueur plugin,
   baseline B correspondant à la capture réelle, writers legacy refusés. Installer une fence
   plugin attestée avant d’exposer les écritures backend ; un crash intermédiaire laisse le
   serveur bloqué pour reprise, jamais deux autorités simultanées.
6. Vérifier reconnexion/restart : aucun ancien hello/reload/project_write ne remplace le
   backend. Le runtime reste autonome. Préserver l’accès legacy uniquement aux serveurs
   non encore basculés, avec état explicite dans la navigation.
7. Rollback après cutover = procédure de récupération depuis snapshots backend et journaux,
   avec nouveau rapprochement des données ; jamais simple flip vers l’ancien disque si des
   écritures backend ont eu lieu. Pas de suppression automatique des sources lors du cutover.

**Sources :** ServerProjectStorage, HostedProjectStorage, DraftStore, ProjectPublisher,
ProjectRoots, ws-protocol, project-storage-modes et son précédent de migration des drafts.

**Tests :** serveur éteint, capture interrompue, crash à chaque checkpoint, ancien client,
ancien plugin, mutation externe pendant copie, add-on apparaissant tardivement, drafts de
plusieurs utilisateurs, assets/historiques, B fidèle, rollback après nouvelle édition backend.

**Garde-fous :** pas de copie vide de secours ; pas de bascule par projet qui fait croire
que tout le namespace Server est déjà migré ; aucune suppression prématurée des sources.
**Docs :** runbook migration/récupération, ADR successeur explicite aux choix disk-only.

### S8 — Migration hébergée, démo multi-projets et reprise

**À implémenter**

1. Créer les serveurs logiques des projets hébergés dans leur Network actuel. Préserver
   membres, rôles, droits de partage, ancres et racines existantes ; pas de transfert vers
   un Network personnel ni de copie de fichiers si seul le rattachement au serveur change.
2. Inventorier versions et collisions avant groupement. Par défaut créer des serveurs
   séparés par ancien Network et version compatible ; séparer aussi les groupes en collision.
   Aucun regroupement automatique de tous les hébergés d’un compte. La fusion reste explicite.
3. Vérifier la continuité des autorisations REST/WS/assets/drafts et des anciens liens via
   Network→Server→Project. Les membres conservent leurs accès ; les non-membres restent
   refusés. Garder les drafts privés liés à leur auteur, sans les exposer aux autres membres.
   La présence de plusieurs owners/admins ne bloque pas cette migration.
4. Remplacer demoSession.projectId et la contrainte mono-projet par session→Server. Adapter
   guards, clients, routes, quotas, rate limiting, activité et maintenance à tous les projets.
   Compter staging, métadonnées, histories et drafts ; lecture/retry ne prolonge pas le TTL.
5. Nouvelle démo = Network temporaire + Server + default initialisés idempotemment. Démo
   legacy garde son ancien projet sans renommage. Démo vide reste valide.
6. Claim : vérifier session et manage_servers destination, figer inventaire/révisions,
   remapper les drafts invités pour tous les projets avec checkpoints, puis transférer
   Server.networkId et révoquer la session au point de visibilité final. Ne pas changer
   d’identités ni fusionner avec un serveur existant. Reprendre après crash ou réponse perdue.
7. Protéger claim vs purge avec ordre de verrous documenté à partir de
   hosted-maintenance → demo-global → session, puis ressources cibles en ordre stable.
   Un claim abandonné doit être récupérable/nettoyable, sans protection infinie.
8. Nettoyer le Network temporaire devenu vide, jamais le Network cible. Étendre purge,
   orphelins, sauvegardes, suppression compte et inventaires à tous les projets/snapshots.

**Sources :** demoSessions, demo integration tests, hostedProjects, hostedMaintenance,
accountDeletion, membershipGuard, projectRename, refs/projectNavigation, DemoAuthReturn.

**Tests :** claim de trois projets avec crash au deuxième remap, démo vide réclamée,
default du compte inchangé, mêmes ids dans deux serveurs autorisés, quota commun,
purge concurrente, compte supprimé pendant claim, droits destination révoqués, Network
temporaire nettoyé, migration hébergée avec plusieurs owners sans réattribution, membres
toujours autorisés via anciens liens, non-membres refusés et drafts tiers invisibles.

**Garde-fous :** pas de secret démo dans URL, pas d’attribution selon ordre SQL, pas de
quota multiplié par projet, pas de claim du seul projet ouvert. **Docs :** entities,
REST/CHANGELOG, parcours démo, backup et env/AGENTS si limites changées.

### S9 — Vérification, observabilité et livraison du socle

1. Exécuter les tests de contrat et de reprise des phases, puis suites des couches touchées :
   backend **`bun run test` uniquement** ; éditeur `npm test -- --run`, lint si disponible
   et `npm run build` ; plugin `gradlew.bat test` puis `shadowJar` sous Windows.
   Vérifier les scripts présents avant lancement. Générer/committer les migrations SQL.
2. Ajouter E2E : créer sans Minecraft, éditer/publier, attacher une cible, déployer, l’arrêter,
   éditer encore, reconnecter sans déploiement automatique, comparer/importer une modification
   locale, résoudre, déployer et vérifier en jeu. Inclure assets/langues et liens inter-projets.
3. Tester disque plein/backend indisponible/restart/ACK perdu, révocation et ancien plugin.
   Vérifier plusieurs processus backend : les locks en mémoire seuls sont insuffisants.
4. Logs structurés par serverId/binding/epoch/operationId/projectId, sans secrets ni contenu
   privé ; métriques durées, conflits, retries, migrations bloquées, taille/rétention.
   UI de reprise pour « résultat inconnu », export du diagnostic et réconciliation sur reçu.
5. Vérifier statiquement tous les writers retirés après cutover, absence de auto-deploy au
   hello, GC protégeant B, défaut non ressuscité, drafts privés absents des bundles.
6. Répéter restauration conjointe DB/fichiers sur environnement isolé et une migration legacy.
   Déploiement technique progressif : lecteurs compatibles, backend/plugin négociés,
   migration contrôlée, puis UI. Aucun déploiement de code depuis ce document de plan.
7. Mettre à jour ADR/CONTEXT, entities, REST, WS, API stable, editor-internals, commandes,
   sauvegardes, guides publics et CHANGELOG ; auditer la dette documentaire avant merge.
   Garder une trace du choix historique disk-first et de ses nouvelles hypothèses.

**Critère de sortie :** une même suite métier passe sur serveur personnel sans cible,
serveur partagé avec cible et démo temporaire ; arrêt Minecraft sans perte de fonctions
d’édition ; dernier déploiement connu et récupération démontrée après incident.

## 5. Extensions préparées par le socle

### S10 — MCP pour les agents

**But :** permettre aux agents de travailler via la plateforme avec les mêmes garanties que l’UI.

1. Définir des outils proposés : lister serveurs/projets/Documents, lire une révision,
   proposer/appliquer un changement avec baseline, valider, lire un diff, publier, préparer
   un déploiement, consulter/appliquer une intention de déploiement autorisée.
2. Chaque mutation porte serverId/projectId, révision attendue, operationId et identité de
   l’agent. Réutiliser exactement les services S1–S6 ; aucune écriture directe dans storage/DB.
3. Jetons révocables bornés aux Networks/serveurs et capacités. Par défaut un agent peut
   éditer dans son périmètre ; publier et déployer demandent des capacités explicites.
   Respecter le droit réel du délégant à chaque appel, même si le token n’est pas expiré.
4. Séparer proposition/diff et application. Pour le déploiement, accepter une intention figée,
   pas une commande « deploy latest » susceptible d’embarquer du contenu non revu.
   Un token de déploiement peut être accordé pour une automatisation explicitement voulue.
5. Valider chemins, taille, formats et IDs via les mêmes règles ; prévoir pagination, taille
   maximale des patches, erreurs de conflit lisibles et audit des mutations.
6. Choisir transport/SDK après lecture de la documentation officielle MCP en vigueur lors
   de cette tranche ; aucun SDK ou outil actuel n’est supposé installé par ce plan.

**Sources :** services de ce plan, assistant/projectAccess existants pour le contrôle du
principal ; spécification MCP officielle à vérifier au démarrage de S10.

**Tests :** agent borné au mauvais serveur refusé, draft tiers invisible, baseline périmée,
double appel idempotent, permission révoquée, deploy sans capacité refusé, UI et MCP produisent
le même résultat métier et les mêmes événements. **Docs :** authentification agents, liste
d’outils et exemples de workflow ; ne pas conseiller de manipuler les fichiers backend.

### S11 — Collaboration en direct

**But :** coéditer un travail partagé ; le stockage central seul ne fournit pas cette propriété.

1. Garder en V1 les drafts privés et les conflits CAS. Ne pas diffuser leurs contenus aux
   autres membres via les événements de révision. Les notifications partagées de S3 ne
   constituent pas déjà une coédition.
2. Ajouter une session/brouillon partagé explicite, autorisé par Network/projet, distinct
   des drafts privés. Rejoindre/publier/quitter ont des règles claires ; ne pas convertir
   silencieusement les brouillons historiques en données partagées.
3. Choisir granularité et protocole à partir d’un prototype : commandes métier versionnées
   pour Documents/Elements, séquencement serveur, IDs stables, déduplication et rebase.
   Tester conflits réels avant de choisir CRDT/OT ou des verrous ciblés.
4. Snapshot + curseur d’événements cohérents, rattrapage sans trou, reconnexion, séquences
   hors ordre et resynchronisation complète si rétention dépassée. Stocker avant ack.
5. Présence/cursors éphémères, undo propre à l’auteur, sélection/viewport locaux. Une édition
   distante ne déplace pas la caméra ; les positions fixées partagées passent par des
   opérations métier, les positions auto ne sont pas persistées.
6. Faire publier une révision déterminée du travail partagé, puis déployer séparément.
   Changement de droits, départ, suppression projet et session suspendue doivent être sûrs.

**Sources :** journal/outbox S2–S3, brouillons et Stage commun existants, architecture
editor-internals ; choix protocole documenté par une ADR propre après prototype.

**Tests :** deux auteurs sur même Element et Documents distincts, undo sans annuler autrui,
perte/rejeu/réordre d’événements, révocation live, reconnexion longue, UI/agent concurrents,
publication pendant coédition, suppression du dernier projet. **Garde-fou :** jamais de
last-write-wins silencieux sur un arbre complet. **Docs :** protocole, droits, partage de brouillons.

## 6. Conditions de fin et reprise de travail

Le socle est terminé lorsque S0–S9 sont vérifiés et le registre utilise leurs contrats :
un seul modèle Server dans Network, mêmes services de contenu, aucun accès Minecraft requis
pour éditer, publication et déploiement distingués, import local explicite sans écrasement
silencieux, identités et drafts préservés à la migration, démo entière récupérable, GC/backup
testés, espace vide durablement valide. MCP et coédition sont des livraisons distinctes.

Avant de reprendre : relire les décisions, dont le maintien des Networks actuels, relever l’état Git (nombreux
changements indépendants présents), vérifier les signatures actuelles puis travailler phase
par phase. Ne pas inclure les changements d’autres travaux ni considérer les noms proposés
comme des API existantes. Faire valider ce plan avant de commencer l’implémentation.

## État d’exécution — 2026-09-24

Le socle S0–S8 est implémenté dans l’arbre de travail ; S10 (MCP) et S11 (coédition)
restent des extensions séparées comme prévu. S9 est validé en partie. L’observabilité ajoute
des métriques bornées et un endpoint admin, des journaux à clés autorisées, ainsi qu’un export
de diagnostic de déploiement sans contenu de fichiers. Vérifications :

- Backend : `bun run test` — 1 378 passés, 0 échec, 2 ignorés, 168 fichiers,
  sur une base `artisan_test_*` isolée.
- Éditeur : `npm test -- --run --maxWorkers=4 --reporter=dot` — 3 025 passés, 413 fichiers ;
  `npm run build` réussi.
- Plugin : `gradlew.bat test shadowJar` — 1 112 tests, 0 échec, 6 ignorés ; JAR produit.
- Docs : build Astro et vérification des liens — 28 pages vérifiées.
- Playwright : 2 smoke tests passent, dont l’entrée du workspace de démo.
- Smoke isolé Paper 1.21.4 : liaison d’un serveur, deux projets hébergés, publication puis
  déploiement de `default` avec reçus d’écriture durable et d’activation réussis. Après arrêt du
  backend, une première reconnexion a révélé la recréation conflictuelle du projet `default`.
  Le correctif est couvert par un test de régression ; la reconnexion suivante a réussi, sans
  doublon, et le changement local de menu est resté sur disque.

Des tests automatisés couvrent déjà la reprise après ACK perdu et entre processus. Le test
`hostedBackup.integration.test.ts` exerce aussi un dump PostgreSQL et la restauration du volume
hébergé complet (contenu binaire, drafts, révisions retenues et projets démo), mais il est
conditionné à `HOSTED_BACKUP_DOCKER`. Il n’a pas été exécuté ici : variable absente et accès au
daemon Docker refusé. Restent à vérifier avant une bascule opérationnelle : import local avec
comparaison et application en full-stack, actions réelles entre projets, assets/langues et add-on
tardif en jeu, panne physique de stockage et révocation pendant une opération. Le smoke Paper
isolé confirme le déploiement et la reconnexion, mais ne valide pas ces scénarios. Aucun test n’a
touché aux données du serveur de développement. Le lint global Biome reste rouge dans l’arbre
courant (782 erreurs et 320 avertissements sur 1 007 fichiers) ; les fichiers ajoutés passent
leurs contrôles ciblés.
