# Triggers et variables — réagir aux événements de jeu, retenir des valeurs

**Status:** proposed (2026-10-24). Aucune ligne de code encore ; ce texte fixe le contrat avant le
premier lot.

**Nommage (Iban, 2026-10-24)** : le kind s'appelle **Trigger** (et non « Automation »). L'événement
qu'il écoute s'appelle donc **Game event**, pour ne pas dire « trigger » deux fois. C'est cohérent avec
`extensible-document-kinds` (décision 8), où un trigger est un slot de chaîne point d'entrée : un
Trigger est le Document dont le seul slot est ce point d'entrée. `api.events` (`ModuleEventBus`) reste
le bus des événements entre modules, distinct des Game events.

## Contexte

Une **Action chain** ne s'exécute aujourd'hui que sur quatre déclencheurs : le clic sur un
**Element**, l'invocation d'une **Command**, un bouton de **Dialog** et `run_actions` sur un champ
`actions` de **Data source**. Tous viennent d'un geste du joueur dans une interface Artisan. Le
moteur ne sait ni réagir à ce qui se passe dans le jeu (une mort, une connexion), ni retenir une
valeur au-delà d'une session de menu (`set_arg`) ou d'un cooldown.

Demande de référence (Iban, 2026-10-24) : *quand un joueur meurt, sauvegarder sa position, lui
envoyer un message avec cette position et un bouton pour s'y téléporter contre une somme d'argent.*
Décomposée sur `v2` :

| Besoin | État sur `v2` |
|---|---|
| Réagir à la mort | absent : aucun déclencheur d'événement |
| Sauvegarder la position | absent : aucune valeur persistante par joueur |
| Message avec la position | présent (`send_message`, MiniMessage, templates), dès qu'un contexte d'événement existe |
| Bouton cliquable dans le chat | partiel : `<click:run_command:…>` marche, mais la commande est publique, tapable et réutilisable |
| Payer | présent (`has_money`, `take_money`) |
| Téléporter à la position sauvée | partiel : `teleport` lit `x/y/z` comme des nombres (`Args.double` caste un `Number`), un template `"{var.x}"` devient **0 sans avertissement** |

C'est aussi le prérequis d'une génération de contenu par IA (étude du 2026-10-24) : une IA ne peut
pas produire ce que le vocabulaire ne sait pas exprimer, et elle ne doit pas le contourner par du
`run_command` ou du code.

Les fondations existent : `DocumentKindRegistry` et les **slots de chaînes** côté éditeur
(`extensible-document-kinds`, décisions 1 et 8, W5/W6), `ActionRegistry` (lot 3),
`ModuleActionsApi.run`, la base de la suite (`suite-foundation-database`) et le modèle de
`CooldownSync` (mémoire d'abord, un seul écrivain, relecture à la connexion).

## Décision

### 1. Un kind **Trigger** : un événement, une chaîne

Un **Trigger** est un Document (`triggers/<id>.yml`, `schema: trigger/v1`) qui associe
un **Game event** à une Action chain. Il est déclaré par un module core `triggers`
via `DocumentKindRegistry`, comme menus, commands et dialogs.

```yaml
schema: trigger/v1
on: player_death            # nom d'un événement déclaré (§2)
if:                         # optionnel : mêmes conditions qu'un `if:` de chaîne, AND implicite
  - not: { world_is: arene }
cooldown: 30s               # optionnel : par joueur, même store que `cooldown_passed`
enabled: true               # optionnel, true par défaut
do:
  - send_message: "Mort en {event.location.x} {event.location.y} {event.location.z}"
```

- Côté éditeur, `do` est le **slot de chaîne** du kind (`chainSlots`), donc le trigger devient un
  nœud-source sur la planche et les arêtes sortent des arguments `document_ref` sans code dédié.
- Côté plugin, le module `triggers` écoute les événements, filtre (`if`, `cooldown`, `enabled`)
  avec `ConditionsApi`, puis exécute `do` par le runtime d'actions, avec le contexte de l'événement
  lié sous `event` (§3).
- Plusieurs Triggers peuvent écouter le même événement ; ils s'exécutent dans l'ordre
  alphabétique de leur id qualifié, et l'échec de l'un n'empêche pas les autres.

### 2. Les Game events sont **déclarés**, comme les actions

Un Game event est une déclaration `GameEventDeclaration(name, context:
ModelField[])` (`@Beta`) dans un nouveau registre `api.getGameEvents()`, avec la même sémantique
d'ownership que `ActionRegistry` : nom core nu (`player_death`), nom de module namespacé
(`quests:completed`, `guilds:joined`), collision = erreur à l'enregistrement, retrait avec le
module. Un module **déclenche** son événement par `api.getGameEvents().fire(name, player, context)`.
La Presence rapporte `declared_game_events` (hello, `modules_changed`), comme `declared_actions` ;
l'éditeur en tire le sélecteur de `on:` et le formulaire du contexte disponible.

Catalogue core v1, volontairement court : uniquement des événements **discrets et liés à un
joueur**.

| Événement | Contexte (`{event.…}`) |
|---|---|
| `player_join` | `first` (booléen) |
| `player_first_join` | — |
| `player_quit` | — |
| `player_death` | `location`, `cause`, `killer` (nom du joueur tueur, absent sinon) |
| `player_respawn` | `location` |
| `player_change_world` | `from`, `to` (noms de monde) |
| `player_kill_entity` | `entity` (type), `location` |

### 3. Le contexte d'événement est une liaison typée, en lecture seule

Le contexte est lié comme une liaison de template sous `event` (`{event.location.x}`,
`{event.cause}`), au même titre que les arguments d'une Command. Il est typé par la déclaration
(`ModelField[]`), ce qui permet à l'éditeur de proposer les champs et de signaler une référence à
un champ inexistant. Une chaîne ne peut pas modifier l'événement : pas d'annulation, pas de
changement des drops. Un besoin de ce genre est une action de module, pas un effet du contexte.

### 4. Un nouveau type de champ `location`

`ModelFieldType.location()` : `{ world, x, y, z, yaw?, pitch? }`. Il sert au contexte
(`event.location`), aux variables (§5) et à `teleport`, qui gagne un argument primaire `location`.
Les arguments `world/x/y/z/yaw/pitch` restent lus (compatibilité du wire) ; l'éditeur écrit
`location`. La forme scalaire `teleport: "{var.derniere_mort}"` est donc valide.

### 5. Variables : déclarées, typées, persistantes

Une **Variable** est un Document (`variables/<id>.yml`, `schema: variable/v1`) qui déclare une
valeur nommée :

```yaml
schema: variable/v1
scope: player          # player | server
type: location         # string | number | boolean | location
default: null          # optionnel
expires: 10m           # optionnel : durée de vie après la dernière écriture
```

- **Déclarée plutôt qu'implicite** : une faute de frappe dans un nom est une référence morte
  détectée par l'éditeur, le renommage repointe les usages, et la planche dessine la variable comme
  un nœud relié à ses écrivains et à ses lecteurs (arêtes `document_ref`).
- **Actions** (module core `variables`) : `set_var { var, value }`, `add_var { var, amount }`
  (type `number` seulement), `clear_var: <var>`. L'argument `var` est un `document_ref(variable)`.
- **Lecture** : liaison `{var.<id>}` dans les templates et les `expression`, résolue
  paresseusement. Condition `has_var: <var>` (valeur présente et non expirée). Namespace de
  placeholders `artisan_var` exposé à PlaceholderAPI pour les scoreboards.
- **Stockage** : table `artisan_vars` de la base de la suite (`scope`, `owner` = UUID ou `server`,
  `name` = ref qualifiée `project/id`, `value` JSON, `expires_at`). Même schéma d'accès que
  `CooldownSync` : la mémoire décide, l'écriture part sur l'écrivain unique, les valeurs d'un joueur
  sont lues à sa connexion. Sans base, mémoire seule (perdue au redémarrage, avertissement au
  démarrage). Un réseau partage donc les variables joueur.
- Une valeur qui ne correspond plus au type déclaré (type changé dans l'éditeur) est lue comme
  absente et signalée une fois dans les logs, jamais convertie en silence.

### 6. Arguments résolus par template, échec explicite

Tout argument typé (`number`, `integer`, `boolean`, `location`) accepte une chaîne template.
`ActionDeclaration.bind` la résout puis la convertit **avant** le handler. Une valeur non résolue
ou non convertible **saute l'action** avec un avertissement qui nomme l'action, l'argument et le
Document. Un repli silencieux sur la valeur par défaut (cas de `teleport` aujourd'hui) n'est plus
permis. Les handlers continuent de recevoir des valeurs déjà typées.

### 7. `chat_button` : un clic à usage unique, lié au joueur

```yaml
- chat_button:
    text: "<gray>Mort en {event.location.x} {event.location.y} {event.location.z}."
    label: "<gold>[Y retourner : 100 $]"
    uses: 1          # défaut 1
    expires: 10m     # défaut 5m
    do:
      - if: [ { has_var: derniere_mort }, { has_money: 100 } ]
        do:
          - take_money: 100
          - teleport: "{var.derniere_mort}"
          - clear_var: derniere_mort
        else:
          - send_message: "<red>Il te faut 100 $."
```

Le bouton porte un jeton aléatoire, lié au joueur, consommé par une commande interne
(`/artisan:click <jeton>`, sans permission, invisible à la complétion). Un jeton inconnu, expiré,
épuisé ou présenté par un autre joueur ne fait rien. Les jetons vivent en mémoire et disparaissent
au redémarrage. La chaîne `do` s'exécute avec les liaisons du moment où le bouton a été envoyé
(`event` compris).

Écarté : `ClickEvent.callback` d'Adventure, qui fait la même chose mais n'existe pas sur Spigot,
cible encore supportée ; le jeton marche partout et se teste sans serveur.

### 8. Exécution : thread, réentrance, budget

- Une chaîne de Trigger s'exécute sur le thread qui possède le joueur (principal sur Paper,
  région du joueur sur Folia et Leaf), jamais sur le thread de l'événement s'il diffère.
  `player_quit` s'exécute avant que le joueur ne soit retiré.
- **Réentrance bornée** : une chaîne peut provoquer un autre événement (`teleport` peut provoquer
  `player_change_world`). Au-delà de 4 niveaux de Triggers imbriqués pour un même joueur, le
  déclenchement suivant est ignoré avec un avertissement.
- **Budget** : 1 000 actions au plus par exécution d'une chaîne de Trigger, `run_actions`
  compris. Au-delà, la chaîne s'arrête avec un avertissement.

### 9. La frontière : ce qu'on refuse d'ajouter

Le vocabulaire reste un langage de **règles**, sans boucle et à terminaison garantie. Sont exclus
de ce chantier, et de tout chantier qui ne rouvre pas cet ADR :

- les boucles (`for`, `while`, répétition) et les fonctions définies par l'admin au-delà de
  `run_actions` ;
- les événements continus ou à haute fréquence (`player_move`, chaque tick, interaction
  quelconque) ;
- les appels réseau sortants depuis une chaîne ;
- l'annulation ou la modification d'un événement Bukkit depuis une chaîne.

Un besoin au-delà de cette frontière s'écrit en module (Kotlin ou Java) qui déclare ses propres
actions et événements (§2). Un besoin récurrent qui tient dans la frontière rejoint le catalogue
core.

## Conséquences

- **CONTEXT.md** : termes **Trigger**, **Game event** et **Variable** ajoutés ; l'entrée
  **Action chain** liste le Trigger parmi ses déclencheurs une fois le kind livré.
- **API** : `GameEventDeclaration`, `GameEventRegistry`, `ModelFieldType.location()`, tous
  `@Beta`. Version mineure de l'API ; champ de Presence additif, protocole inchangé.
- **Schémas** : `trigger/v1` et `variable/v1` dans `docs/schema/`, `$defs.Action` gagne
  `set_var`, `add_var`, `clear_var`, `chat_button` et l'argument `location` de `teleport`.
- **Base** : une migration crée `artisan_vars` ; forward-only comme les autres
  (`docs/architecture/versioning.md`).
- **Transition** : aucune donnée existante ne change. Le seul changement de comportement est §6 :
  un `teleport` dont un argument ne se résout pas ne téléporte plus en 0,0,0, il ne fait rien et
  l'écrit dans les logs.
- **Assistant IA** : quand il revient dans `v2`, il gagne `upsert_trigger` et
  `upsert_variable` ; ce chantier ne dépend pas de lui.
- **Test d'acceptation** : la demande de référence, écrite à la main sous la forme ci-dessus
  (un Trigger `player_death`, une Variable `derniere_mort`), fonctionne en jeu sur Paper et sur
  Folia, y compris après un redémarrage du serveur pendant la durée de validité de la variable
  (le bouton, lui, est perdu : attendu).

## Ordre des lots

1. Type `location` et résolution des arguments par template (§4, §6), avec le vecteur
   `action-wire-conformance.json` étendu. Utile seul : corrige `teleport`.
2. Kind Variable, actions et stockage (§5).
3. Registre d'événements, kind Trigger, catalogue core (§1 à §3, §8).
4. `chat_button` (§7).
5. Éditeur : formulaires, sélecteur d'événement, nœuds de planche, champs de contexte proposés.

## Questions ouvertes

| # | Question | Recommandation |
|---|---|---|
| Q1 | Identité stockée d'une variable : ref qualifiée `project/id` (renommer le Project perd les valeurs) ou id stable généré à la création ? | Ref qualifiée en v1, comme le reste des refs ; un renommage de Project est rare et l'éditeur peut avertir. |
| Q2 | Déclencheurs sans joueur (`server_start`, horaire) : `ActionContext.getPlayer()` n'est jamais nul aujourd'hui. | Hors v1. Les rouvrir demande un contexte sans joueur et une liste d'actions qui le supportent. |
| Q3 | Une action `wait` (délai borné avant la suite de la chaîne) ? | Hors v1 : elle casse l'exécution synchrone et pose la question du joueur déconnecté pendant l'attente. |
| Q4 | `player_kill_entity` dans les fermes à mobs : fréquence élevée. | Garder, avec `cooldown` conseillé par l'éditeur ; mesurer avant d'ajouter un plafond global. |
