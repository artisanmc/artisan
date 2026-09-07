# Migration zMenu progressive et reprenable

Statut : approuvé, implémentation en cours. Phase 1 terminée et vérifiée.

## Objectif

Sélectionner les 35 fichiers liés une seule fois, conserver une vue commune de
leurs dépendances et migrer progressivement sans recommencer les résultats déjà
validés après une coupure. Ne pas augmenter aveuglément les limites du chat.

V1 : sources serveur zMenu, dans le Project et la conversation courants. Le chat
et les uploads locaux gardent leur fonctionnement actuel. Pas de reconnaissance
automatique silencieuse qui déclencherait plusieurs tours facturés : action
explicite « Migrer cette sélection », progression et budget global visibles.

## Phase 0 — Découverte réalisée

Sources vérifiées sur disque (le graphe de code contient quelques entrées anciennes) :

- `backend/src/modules/assistant/loop.ts` : `runTurn({provider, model,
  messages, wc, maxIterations?, system?})`. La limite de 25 concerne les appels
  au modèle, pas les outils. Une réponse peut demander plusieurs lectures.
  Le garde actuel impose de lire toutes les pièces du tour avant toute écriture.
- `backend/src/modules/assistant/routes.ts` : préflight autorisé, puis traitement
  directement dans le POST SSE. Pas de job, heartbeat, checkpoint ou reprise.
- `backend/src/modules/assistant/provider/types.ts` et
  `provider/openaiCompatible.ts` : aucun signal d'annulation ou budget de sortie
  explicite dans l'interface actuelle ; les appels d'outils ne sont émis qu'à la
  fin de la réponse fournisseur. Ne pas supposer ces capacités déjà présentes.
- `backend/src/modules/assistant/conversationRepo.ts` :
  `createConversation(ownerKey, projectId)`, `getConversation(id)`,
  `saveConversation(id, messages, title)`. Le transcript est durable, pas la WC.
- `backend/src/modules/assistant/serverAttachments.ts` :
  `resolveServerAttachments(serverKeyId, raw, read?)` ; résultats bruts serveur
  expurgés par `redactServerAttachmentToolResults` avant persistance.
- `backend/src/modules/ai/usageRepo.ts` : `recordDebitedTurn(input)` réalise
  log et débit dans une transaction, mais sans clé d'idempotence par lot.
- `backend/src/modules/ai/settings.ts` : `maxCreditsPerTurn`, éventuellement
  absent ; aucun budget global de migration.
- `editor/src/features/assistant/AssistantChat.tsx` : snapshot de relance en
  mémoire, application immédiate des événements aux stores ; pas d'ID de résultat.
- `editor/src/features/project/useDraftSync.ts`,
  `editor/src/state/projectDraftStore.ts` : brouillon navigateur existant.
- `editor/src/features/project/saveProjectToDisk.ts` :
  `saveProjectToDisk(project, networkId, serverId)` reste le seul geste de
  publication explicite, avec contrôle de conflit.
- `backend/src/modules/assistant/grounding/zmenu-reference.md` : référence
  existante pour navigation et conversions ; pas de parseur zMenu dédié trouvé.
- `docs/decisions/server-disk-only-storage.md`, y compris révisions août :
  serveur autoritaire, brouillon navigateur autorisé, pas de copie WC backend.
- `docs/superpowers/specs/2026-09-04-assistant-server-import-sources-design.md` :
  pas de copie brute des sources ; résultats dérivés de l'assistant autorisés.

La coupure réellement rencontrée avec DeepSeek n'est pas diagnostiquée sans
trace. Les longues périodes SSE silencieuses sont une faiblesse observée du code,
pas une preuve de cause en production. Ne pas attribuer une limite de contexte
à ce modèle sans vérifier sa configuration et sa documentation fournisseur.

## Décisions proposées

### Un contexte commun, des unités de travail bornées

1. Lire la sélection via les contrôles existants. Produire un manifeste stable :
   source, chemin, taille, empreinte du contenu et identifiant de menu cible.
2. Construire un index partagé des menus et des références statiques reconnues.
   Les références dynamiques, ambiguës ou hors sélection sont signalées ; elles
   ne deviennent pas des liens inventés. Les sources restent des données non fiables.
3. Réserver les identifiants cibles avant génération pour garder des liens stables.
   Une collision avec un menu existant nécessite un choix explicite.
4. Pour chaque unité, fournir le fichier à convertir, les fragments nécessaires
   de fichiers communs et les interfaces/résumés bornés des menus liés. Le modèle
   peut demander une dépendance supplémentaire, sous le même budget.
5. Valider chaque proposition avant de la déclarer générée. Réaliser ensuite une
   validation globale des liens, identifiants et limitations de conversion.

Une composante cyclique contenant 35 menus NE doit PAS redevenir un lot de 35
fichiers bruts. Les identifiants réservés et l'index permettent de convertir ses
menus successivement. Une dépendance de contenu nécessaire trop volumineuse
déclenche un découpage explicite ou un état bloqué, jamais une troncature cachée.

Le budget tient compte du prompt, des outils, des sources et de la sortie
réservée. Prévoir une configuration validée du budget de contexte ; les limites
de transfert actuelles (200 fichiers, 1 Mio/fichier, 8 Mio total) ne constituent
pas un budget de tokens. Ne pas envoyer tous les fichiers à chaque appel.

### Progression durable, transport remplaçable

Nouveaux concepts à implémenter, non des API existantes : `MigrationRun`,
`MigrationStep`, `MigrationEvent` et `MigrationProposal`.

- Run lié à owner/conversation/Project/serveur, sélection, modèle, manifeste,
  budget, révision et état. États : analyse, prêt, en cours, en pause, bloqué,
  terminé, annulé.
- Chaque étape possède une clé stable, ses entrées/version, un résultat dérivé
  validé et une consommation. Un seul exécuteur possède son bail en base.
- Les propositions sont des résultats dérivés de l'assistant, comme les sorties
  déjà persistées en conversation ; elles ne sont pas une copie du Project.
  Stocker seulement les sorties de migration nécessaires au replay, avec une
  politique de rétention alignée sur la conversation. Aucune WC complète durable.
- Les contenus zMenu bruts restent en mémoire. À la reprise, relire et vérifier
  leurs empreintes. Une source modifiée bloque les unités affectées et demande
  une nouvelle analyse ; ne pas mélanger deux versions sans l'indiquer.
- L'exécution d'une étape ne dépend pas du succès des écritures SSE. Un journal
  durable à séquence monotone permet de se reconnecter et de récupérer le statut.
- Au redémarrage backend, une étape avec bail expiré devient interrompue. Sa
  reprise est explicite ; les étapes terminées ne sont pas réexécutées.
- Un appel fournisseur interrompu peut avoir consommé des tokens sans résultat
  disponible. Ne pas promettre une exécution exactement une fois chez le fournisseur.

### Crédits et contrôle utilisateur

Un lancement autorise des étapes successives dans un budget global affiché et
accepté. Pause entre étapes et annulation disponibles ; pas d'augmentation
automatique du budget. Reconnexion au suivi ne déclenche aucun nouvel appel.

Débit interne idempotent par tentative/étape, résultat et comptabilisation
enregistrés de manière cohérente. Réutiliser les règles de tarification actuelles.
Un plafond contrôlé après retour d'usage peut être dépassé par l'appel en vol :
documenter cette limite et borner aussi sa sortie, sans prétendre à un plafond
monétaire strict faute de réservation et de comptage fournisseur fiables.

### Application des résultats

La progression distingue « généré », « appliqué au brouillon » et « à vérifier ».
Un ID stable de proposition et son empreinte évitent une double application.
Les résultats sont réappliquables après reconnexion, sans nouvel appel IA.

Avant application, comparer la cible à sa base et à la proposition : résultat
déjà présent = acquittement, cible modifiée par l'utilisateur = conflit explicite.
Ne pas se fier seulement à un compteur local susceptible d'être perdu au refresh.
Le brouillon navigateur existant conserve le travail. **Enregistrer** reste le
seul geste qui écrit les menus Artisan sur le serveur ; aucune écriture zMenu.

## Phase 1 — Transport et diagnostics

Fichiers : `backend/src/modules/assistant/routes.ts`, `provider/types.ts`,
`provider/openaiCompatible.ts`, `editor/src/lib/api/assistant.ts` et tests associés.

- Copier le framing SSE existant ; ajouter heartbeat sans faire passer un ping
  pour une réponse IA, et garantir nettoyage des timers.
- Distinguer timeout fournisseur, fermeture réseau et erreur moteur avec ID de
  corrélation sans contenu source dans les logs. Ajouter signal d'annulation au
  contrat fournisseur seulement après vérification du SDK installé.
- Tester un fournisseur silencieux contrôlé, une fermeture SSE et une erreur
  fournisseur. Vérifier que le heartbeat entretient le flux mais ne prétend pas
  résoudre toutes les limites d'un proxy externe.
- Ne pas relancer la requête payante sur simple reconnexion.

## Phase 2 — Inventaire, dépendances et budget

Nouveaux modules proposés : `backend/src/modules/assistant/migration/manifest.ts`,
`zmenuDependencies.ts`, `contextBudget.ts` et tests/fixtures voisins.

- Copier l'accès sécurisé de `serverAttachments.ts`, pas un lecteur disque backend.
- Créer des fixtures de 35 menus cycliques, menus avec fichiers communs, cibles
  absentes, références dynamiques et collisions. Vérifier les constructions zMenu
  effectivement prises en charge contre la référence et les documents officiels
  avant d'implémenter l'extracteur ; aucune heuristique prétendument exhaustive.
- Parser le YAML avec limites de profondeur/alias et valider les sorties d'analyse.
  Empreintes stables ; mapping d'IDs indépendant de l'ordre des fichiers.
- Produire des unités bornées en taille, pas seulement en nombre de fichiers.
- Tests : graphe cyclique ne force pas tout le brut dans un prompt, dépendance
  manquante visible, budget dépassé refusé avant appel, références stables.

## Phase 3 — État durable et facturation idempotente

Fichiers : `backend/src/db/schema.ts`, migration générée `backend/drizzle/`,
nouveaux `migration/repository.ts` et `migration/routes.ts`,
`backend/src/modules/ai/usageRepo.ts` et tests associés.

- Copier les conventions Drizzle de `assistant_conversations` et les contrôles
  ownership + `resolveProjectAccess` sur chaque endpoint et chaque reprise.
- Contrats proposés sous `/api/v1/assistant/conversations/:id/migrations` : créer,
  lire état/événements/propositions, démarrer, pause, reprendre, annuler. Définir
  corps typés, codes d'erreur et révisions avant UI ; ne pas monter des routes
  sans tests d'autorisation.
- Transactions/CAS de révision, bail à expiration et clé d'idempotence. Pas de
  simple verrou JS global, insuffisant après restart ou avec plusieurs instances.
- Politique explicite de suppression avec conversation et bornes de stockage
  pour propositions/événements. Aucun payload source ou transcript brut de lecture.
- Tests : deux clics/deux workers, résultat durable avant SSE, relecture sans
  débit, crash avant/après débit, séparation tenants, source devenue inaccessible.

## Phase 4 — Exécuteur progressif et checkpoints

Nouveaux `migration/runner.ts`, `migration/planner.ts`, `migration/validation.ts`.
Réutiliser les outils/schema validators existants de `tools.ts`, pas un second
format de menu. Garder le chat ordinaire compatible.

- Un appel de migration possède une phase et un ensemble précis de sources à
  lire. Ne pas brancher les 35 fichiers sur le garde global du chat à chaque étape.
- Analyse sans outils mutateurs ; conversion vers propositions ; validation
  avant checkpoint. Réserver les IDs pour résoudre liens entre menus pas encore générés.
- Reconstitution de contexte bornée à partir du manifeste et résultats dérivés,
  jamais croissance illimitée du transcript complet entre étapes.
- À la coupure de transport, persister résultat/progression même sans lecteur SSE.
  À la panne fournisseur, arrêter l'étape, exposer raison et reprise explicite.
- Tests faux fournisseur : 35 menus, analyse découpée, dépendances cycliques,
  arrêt après 7 résultats, reprise à l'étape restante, absence de doubles débits,
  sources modifiées, pause/budget, résultat incompatible avec schéma.

## Phase 5 — UI et application au brouillon

Nouveaux `editor/src/features/assistant/MigrationPanel.tsx` et client typé
`editor/src/lib/api/assistantMigration.ts`; intégration `AssistantChat.tsx` et
`AssistantBody.tsx`, stores de brouillon si besoin, traductions EN/FR.

- Réutiliser `ServerImportSourceDialog`, composants DS et la sélection existante.
  Afficher analyse, progression réelle par menus, budget et éléments à vérifier.
- Boutons Lancer/Pause/Reprendre/Annuler ; attacher le suivi au run durable plutôt
  qu'au snapshot React Retry. Reconnexion GET suivi, pas répétition POST création.
- Appliquer propositions par IDs stables via `applyAssistantMenu` et équivalents,
  en comparant base/résultat/cible avant de modifier le brouillon.
- Tests : refresh après application avant ack, résultat reçu après déconnexion,
  nouveau brouillon utilisateur, changement Project/conversation, stockage local
  indisponible, progression généré/appliqué distincte et serveur hors ligne.

## Phase 6 — Documentation et vérification finale

- Mettre à jour `docs/architecture/rest-endpoints.md`, `entities.md`,
  `editor-internals.md`, `CHANGELOG.md`, guide utilisateur assistant et décision
  précisant que propositions durables ne constituent pas un store Project.
  Si protocole WS/config changent, docs correspondantes dans le même commit.
- Tests backend exclusivement `bun run test ...` (jamais `bun test` direct).
  Générer et tester la migration DB, tests ciblés puis suites/build/lint pertinents.
- Playwright avec fournisseur simulé : 35 fichiers liés, coupure, reconnexion,
  reprise, réception de tous résultats sans doublons, aucune publication automatique.
- Smoke réel sur serveur de développement avec petit budget explicite et modèle
  configuré avant d'annoncer DeepSeek validé. Capturer la raison de coupure réelle
  si elle subsiste ; ne pas annoncer tests simulés comme validation production.
- Audit `sync-docs`, revue sécurité/idempotence/conflits ; préserver toutes les
  modifications utilisateur parallèles hors assistant.

## Critères de sortie

1. Une sélection de 35 fichiers liés reste disponible pour toute la migration.
2. Les dépendances reconnues conservent leurs cibles ; les autres sont signalées.
3. Après coupure, une reconnexion retrouve progression et propositions validées.
4. Une reprise ne régénère ni ne refacture les étapes déjà validées.
5. Aucun contenu zMenu brut n'est mis en cache permanent ; Enregistrer reste explicite.
6. Un dépassement de budget/contexte ou une source changée produit un état explicite.
7. Le chat classique, les uploads locaux et leur bouton Retry restent compatibles.
