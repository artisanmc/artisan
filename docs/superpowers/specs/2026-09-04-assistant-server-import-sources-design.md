# Sources d’import serveur pour l’assistant

**Statut :** design approuvé le 2026-09-04, non implémenté.

## Problème

L’assistant Artisan accepte aujourd’hui des fichiers déposés depuis le navigateur.
L’éditeur lit leur texte, puis l’envoie dans `attachments` au backend avec le tour
de conversation. Ce flux fonctionne quand l’administrateur possède les fichiers
sur sa machine, mais il oblige à télécharger puis redéposer des menus déjà présents
sur le serveur Minecraft — notamment les configurations zMenu et DeluxeMenus à
migrer.

Le backend ne peut pas lire ces fichiers lui-même : il peut vivre dans un autre
conteneur ou sur une autre machine. Le plugin Artisan est le seul composant qui
dispose d’une vue fiable du disque du serveur. L’accès doit néanmoins rester bien
plus étroit qu’un explorateur de fichiers général, car les dossiers de plugins
peuvent contenir des secrets.

## Décision

Ajouter à l’assistant une seconde origine de pièces jointes, **Depuis le serveur**,
en complément de l’upload **Depuis mon appareil**.

Les dossiers accessibles sont des **sources d’import nommées**, déclarées dans le
`config.yml` du plugin. Le plugin liste et lit leur contenu à la demande par le
relais WebSocket existant. Le backend ne conserve aucun miroir des fichiers. Une
sélection serveur rejoint la working copy actuelle de l’assistant et suit ensuite
exactement le même flux de conversion que les pièces jointes locales.

## Objectifs

- Joindre un fichier ou un dossier déjà présent sur le serveur sans transfert
  manuel par le poste de l’utilisateur.
- Préserver les chemins relatifs lors d’une sélection récursive afin que
  l’assistant puisse comprendre les références entre menus.
- Autoriser plusieurs racines configurables, avec des exemples prêts à l’emploi
  pour zMenu et DeluxeMenus.
- Garder le plugin maître de son disque et ne transporter que les fichiers
  explicitement sélectionnés.
- Réutiliser le moteur de pièces jointes et de migration de l’assistant.
- Conserver l’upload local comme solution pour les fichiers du poste ou lorsque
  le serveur est hors ligne.

## Hors périmètre

- Explorer arbitrairement le système de fichiers du serveur.
- Modifier, supprimer ou déplacer les fichiers sources.
- Synchroniser ou sauvegarder ces sources dans le backend.
- Créer un assistant de migration distinct du chat existant.
- Supporter les fichiers binaires ; cette première version lit uniquement du
  texte UTF-8 filtré par extension.

## Configuration du plugin

Le plugin charge une map de sources sous `assistant.import-sources`. L’id est un
slug stable utilisé sur le wire ; il n’est jamais interprété comme un chemin.

```yaml
assistant:
  import-sources:
    zmenu:
      enabled: true
      label: "zMenu"
      path: "plugins/zMenu/menus"
      extensions: [".yml", ".yaml"]
    deluxe-menus:
      enabled: true
      label: "DeluxeMenus"
      path: "plugins/DeluxeMenus/gui_menus"
      extensions: [".yml", ".yaml"]
```

Les deux sources connues sont présentes dans le `config.yml` distribué. Un
administrateur peut les désactiver, changer leur chemin ou ajouter autant de
sources nommées que nécessaire. Un chemin relatif part du répertoire de travail
du serveur ; un chemin absolu est accepté uniquement parce qu’il a été déclaré
explicitement par l’administrateur dans ce fichier local.

Une source invalide, absente ou illisible est omise du listing et produit un WARN
précis dans la console du serveur. Elle n’empêche pas les autres sources de
fonctionner.

## Expérience utilisateur

Le bouton trombone ouvre un `DropdownMenu` avec deux choix :

- **Depuis mon appareil**, qui déclenche l’input fichier actuel ;
- **Depuis le serveur**, qui ouvre un `Dialog` de sélection.

Le sélecteur serveur contient :

- le choix de la source configurée ;
- une arborescence reconstruite depuis les chemins relatifs ;
- des cases à cocher, avec état intermédiaire pour les dossiers ;
- la sélection récursive d’un dossier ;
- une recherche par nom ou chemin ;
- le nombre de fichiers et leur taille cumulée estimée ;
- les actions **Actualiser**, **Annuler** et **Joindre**.

Le listing renvoie une liste plate de fichiers `{path, size}`. Le navigateur
reconstruit les dossiers et transforme toute sélection de dossier en chemins de
fichiers explicites. Un fichier ajouté sur le disque après le listing ne rejoint
donc pas implicitement le message.

Après validation, chaque sélection apparaît comme un groupe de pièces jointes,
par exemple `zMenu · 12 fichiers`. Le groupe peut être développé ou retiré. Des
pièces jointes locales et serveur peuvent coexister dans le même tour.

Si le serveur est hors ligne, **Depuis le serveur** reste visible mais désactivé
avec une explication. **Depuis mon appareil** reste disponible.

## Architecture et flux de données

### Listing

1. L’éditeur appelle une route REST scellée par le Network, le Server et le
   Project actuellement ouvert.
2. Le backend vérifie la session, l’appartenance au Network et que le Project
   appartient bien au Server demandé.
3. Le backend envoie `import_sources_list` au plugin connecté, avec un
   `request_id`.
4. Le plugin parcourt chaque source active sans lire le contenu et répond avec
   les métadonnées autorisées.
5. Le backend relaie le résultat sans le persister.

Route proposée :

```text
GET /api/v1/networks/:networkId/servers/:serverId/projects/:projectId/import-sources
```

Réponse nominale :

```json
{
  "sources": [
    {
      "id": "zmenu",
      "label": "zMenu",
      "files": [
        { "path": "shop.yml", "size": 1842 },
        { "path": "categories/blocks.yml", "size": 921 }
      ]
    }
  ]
}
```

### Envoi d’un tour

Le contrat existant `attachments: Record<string, string>` reste inchangé pour
les uploads locaux. Le corps d’un tour accepte en plus :

```json
{
  "serverAttachments": [
    {
      "sourceId": "zmenu",
      "paths": ["shop.yml", "categories/blocks.yml"]
    }
  ]
}
```

1. L’éditeur envoie les références, jamais le contenu serveur.
2. Le backend refait les contrôles d’accès à la conversation et au Project.
3. Avant de lancer le modèle, il envoie `import_sources_read` au plugin.
4. Le plugin résout la source par son id, revalide chaque chemin et lit un
   instantané UTF-8.
5. Le backend fusionne ces fichiers dans les attachments de la `WorkingCopy`
   sous des ids `server:<sourceId>/<path>` afin d’éviter toute collision avec un
   nom local ou une autre source.
6. La note système existante énumère ces ids ; `read_attachment` lit leur contenu
   comme pour un upload local.
7. Le tour IA démarre seulement après une réponse complète et valide du plugin.

Les contenus ne sont pas ajoutés à une table ou un cache permanent. La politique
actuelle de persistance des conversations et des pièces jointes reste inchangée.

## Protocole WebSocket

Les messages suivent le pattern corrélé `request_id` déjà utilisé par
`project_read` et `data_source_fetch`.

### `import_sources_list` — backend vers plugin

```json
{ "type": "import_sources_list", "request_id": "uuid" }
```

### `import_sources_list_result` — plugin vers backend

```json
{
  "type": "import_sources_list_result",
  "request_id": "uuid",
  "ok": true,
  "sources": [
    {
      "id": "zmenu",
      "label": "zMenu",
      "files": [{ "path": "shop.yml", "size": 1842 }]
    }
  ]
}
```

### `import_sources_read` — backend vers plugin

```json
{
  "type": "import_sources_read",
  "request_id": "uuid",
  "selections": [
    { "source_id": "zmenu", "paths": ["shop.yml"] }
  ]
}
```

### `import_sources_read_result` — plugin vers backend

```json
{
  "type": "import_sources_read_result",
  "request_id": "uuid",
  "ok": true,
  "files": [
    {
      "source_id": "zmenu",
      "path": "shop.yml",
      "content": "name: '&8Shop'\n"
    }
  ]
}
```

Le timeout nominal est de 5 secondes pour le listing et de 10 secondes pour la
lecture. Les plugins antérieurs ignorent les types inconnus : le backend expire
alors proprement et présente la source comme indisponible.

## Sécurité

La frontière de sécurité est appliquée dans le plugin, jamais déléguée à
l’éditeur ou au backend :

1. `source_id` doit correspondre à une source active chargée depuis
   `config.yml`.
2. Les chemins sont relatifs, non vides, sans segment `..`, et ne commencent pas
   par un séparateur.
3. La racine et chaque cible sont canonicalisées ; la cible doit rester sous la
   racine canonique.
4. Les liens symboliques sont rejetés, y compris lorsqu’un segment intermédiaire
   est un lien.
5. Tout segment caché (`.` en préfixe), tout dossier et toute extension absente
   de l’allowlist sont rejetés lors de la lecture.
6. Les fichiers doivent être réguliers, lisibles et décodables en UTF-8 strict.
7. Le résultat est en lecture seule : aucun message, endpoint ou outil d’écriture
   n’est créé pour ces sources.

Le backend exige une session authentifiée et le même accès qui permet déjà à un
membre de modifier le Project. Il vérifie aussi la relation Network → Server →
Project avant le listing et avant chaque tour. La configuration des racines reste
une action locale de l’administrateur du serveur.

Comme pour les uploads actuels, le prompt système rappelle que le contenu des
fichiers est une donnée non fiable à convertir, jamais une instruction à suivre.

## Limites et atomicité

Constantes initiales côté plugin :

| Limite | Valeur | Comportement |
|---|---:|---|
| Entrées listées par source | 5 000 | Source signalée `too_many_entries`, aucun listing partiel |
| Fichiers lus par tour | 200 | Rejet du lot |
| Taille d’un fichier | 1 Mio | Rejet du lot |
| Taille cumulée | 8 Mio | Rejet du lot |

L’éditeur prévient les dépassements connus depuis les métadonnées, mais le plugin
reste autoritaire et recompte au moment de lire.

La lecture d’un tour est tout ou rien. Si une source ou un fichier est absent,
interdit, modifié en dossier, illisible ou trop grand, `ok` vaut `false`, aucun
contenu partiel n’est remis à l’assistant et aucun crédit IA n’est consommé.
L’utilisateur actualise la sélection ou retire les fichiers en erreur.

Codes d’erreur du protocole :

- `unknown_source` ;
- `invalid_path` ;
- `unsupported_file` ;
- `not_found` ;
- `too_many_files` ;
- `file_too_large` ;
- `too_large` ;
- `invalid_utf8` ;
- `read_error`.

Le backend traduit également l’absence de connexion en `503 server_offline` et
les expirations en `504 fetch_timeout`.

## Composants concernés

### Plugin

- Parsing et validation de `assistant.import-sources` dans la configuration.
- Un composant isolé `ImportSourceReader` responsable du listing et de la lecture
  sûre ; le handler WebSocket ne contient pas la logique de fichiers.
- Handlers des quatre messages dans `SyncedMenuProvider`, exécutés sur
  l’executor HTTP et jamais sur le callback OkHttp.

### Backend

- Types du protocole et deux relais corrélés dans `hub.ts`.
- Résolution des réponses plugin et nettoyage systématique des pending requests.
- Route de listing dans `userNetworks.ts`.
- Résolution de `serverAttachments` dans la route assistant avant `runTurn` et
  avant toute consommation de crédit.
- Extension de la `WorkingCopy` uniquement par fusion des attachments résolus.

### Éditeur

- Client API pour le listing des sources.
- `DropdownMenu` du trombone et `Dialog` de sélection, construits avec le design
  system existant.
- État séparé pour les uploads locaux et les références serveur.
- Sérialisation `serverAttachments` lors de l’envoi du tour.
- Groupes de pièces jointes serveur dans le composer.

## Gestion des erreurs

- Source absente au listing : elle est omise, avec WARN serveur.
- Aucune source valide : état vide expliquant la configuration attendue.
- Serveur hors ligne : choix serveur désactivé ; upload local inchangé.
- Timeout de listing : erreur récupérable dans le Dialog avec **Réessayer**.
- Erreur de lecture à l’envoi : le message reste dans le composer, le tour ne
  rejoint pas le transcript et l’utilisateur peut corriger la sélection.
- Plugin trop ancien : même présentation qu’un timeout/une fonctionnalité
  indisponible, sans faire croire que le dossier est vide.

## Stratégie de tests

### Plugin

- Parse les sources actives, désactivées, relatives et absolues.
- Liste récursivement avec chemins normalisés et triés.
- Exclut extensions non autorisées, fichiers/dossiers cachés et symlinks.
- Rejette traversal, préfixe voisin (`root-other`) et symlink intermédiaire.
- Applique les quatre limites et ne renvoie jamais de lot partiel.
- Répond correctement aux deux opérations WS hors du callback OkHttp.

### Backend

- Route de listing : non authentifié, non-membre, mauvais Network/Server/Project,
  offline, timeout, résultat nominal et erreur plugin.
- Corrélation et nettoyage des pending requests pour les deux messages.
- Tour assistant : mélange local/serveur, ids sans collision, source inconnue,
  lecture partielle refusée et aucun appel modèle/crédit en cas d’échec.
- Compatibilité d’un client qui n’envoie que `attachments`.

### Éditeur

- Le trombone conserve l’upload local et propose le serveur.
- Le Dialog reconstruit l’arbre, recherche, sélectionne récursivement et calcule
  le résumé.
- Les groupes peuvent être développés et retirés.
- Le payload contient les chemins explicites et mélange les deux origines.
- Les états vide, hors ligne, timeout et dépassement sont compréhensibles.

## Documentation à mettre à jour avec l’implémentation

- `docs/architecture/ws-protocol.md` — quatre nouveaux messages.
- `docs/architecture/rest-endpoints.md` — route de listing.
- `docs-site/src/content/docs/getting-started/install-admin.md` — configuration
  `assistant.import-sources` et règles de sécurité.
- Un guide utilisateur sous `docs-site/src/content/docs/editor/` pour joindre et
  migrer des fichiers serveur.
- `docs/architecture/editor-internals.md` si le composer ou un composant du
  design system change structurellement.
- `CHANGELOG.md` `[Unreleased]` pour le nouvel endpoint REST.

## Critères d’acceptation

1. Un membre ouvrant un Project en ligne peut sélectionner un dossier zMenu et
   demander sa migration sans télécharger les fichiers sur son poste.
2. L’assistant reçoit tous les fichiers compatibles sélectionnés avec leurs
   chemins relatifs et peut les lire via `read_attachment`.
3. Aucun chemin non déclaré, caché, traversant ou atteint par symlink ne peut être
   lu, même avec une requête forgée.
4. Une erreur sur un seul fichier empêche entièrement le tour et sa facturation.
5. Un serveur hors ligne ou un ancien plugin n’altère pas l’upload local.
6. Le backend ne persiste aucune copie des sources importées.

## Alternatives rejetées

- **Miroir des sources dans le backend.** Navigation hors ligne, mais copie
  persistante, risque de fuite et données périmées.
- **Lecture directe par le backend.** Ne fonctionne pas lorsque le backend et le
  serveur Minecraft ne partagent pas le même disque.
- **Explorateur générique du serveur.** Surface d’exposition disproportionnée et
  inutile pour le besoin de migration.
- **Parcours “Migrer depuis le serveur” séparé.** Duplique le moteur de pièces
  jointes, les erreurs et l’interface sans ajouter de capacité.
