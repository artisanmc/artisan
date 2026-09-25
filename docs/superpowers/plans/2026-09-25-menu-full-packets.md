# Menus « full packets » — contenu des menus côté client uniquement

Statut : plan validé, non implémenté. Point de départ : le prototype « slots joueur » de la
branche `claude/sweet-gates-hil1xw` (`render/PlayerSlots.kt`, `PlayerSlotOverlayStore.kt`,
`PacketEventsPlayerSlots.kt`, `place()` dans `MenuRenderer`, libération à la fermeture dans
`MenuListener`, option `menus.player-inventory-slots`). Jamais compilé : la session qui l'a
écrit n'avait accès ni à `repo.papermc.io` ni à `repo.codemc.io`. Seuls les tests purs
`PlayerSlotsTest` ont tourné. La nouvelle architecture le remplace en partie ; reprendre ce
qui sert.

## Objectif

- Les 36 slots de la partie joueur d'un menu (27 d'inventaire principal + 9 de barre
  rapide) peuvent servir de boutons comme ceux du haut, ou rester vides.
- Le haut et le bas passent par le même chemin : tout le contenu est envoyé au client par
  paquets, rien n'existe côté serveur, donc rien à dupliquer.

## Décisions (ne pas rouvrir)

- **PacketEvents est intégré au jar** (dépendance obligatoire, plus de softdepend).
  Contrepartie acceptée : chaque version majeure de Minecraft impose de mettre à jour
  PacketEvents. Une version récente de PacketEvents ne casse pas les anciennes versions de
  Minecraft ; c'est une version ancienne qui ne connaît pas les nouvelles.
- **Variante « ancre »** : on ouvre toujours un vrai `createInventory(ArtisanMenuHolder…)`,
  mais vide. Il fournit l'id de fenêtre, les événements Bukkit (click, close, drag) et la
  présence du joueur dans un menu pour les autres plugins. Tout le contenu (haut + 36 slots
  joueur) est réécrit dans les paquets sortants.
  Écartée : la fenêtre 100 % virtuelle (OPEN_SCREEN envoyé soi-même, clics interceptés en
  réception), qui fait perdre les événements Bukkit et sort le routage des clics des tests.
- **Adressage unique par rawSlot du protocole** : `0..size-1` = menu,
  `size..size+26` = inventaire principal, `size+27..size+35` = barre rapide.
- **Réglage par menu** `player_inventory: visible | hidden`, `visible` par défaut pour ne
  rien changer aux menus existants.
  - `visible` : le bas montre le vrai inventaire ; les positions `≥ size` sont refusées.
  - `hidden` : le bas n'affiche que les boutons du menu, vide ailleurs.
- **Slots de dépôt : prévus dans le contrat, pas implémentés maintenant.** `MenuSlots`
  distingue `DISPLAY` (contenu par paquets, ancre vide, clics annulés) et `INPUT` (objet réel
  dans l'ancre, paquets laissés intacts par le listener, clics autorisés). Seul `DISPLAY`
  existe pour l'instant, mais le listener teste déjà le type de slot avant de réécrire, pour
  qu'ajouter `INPUT` ne demande pas de refonte.
- **Pas de bot client (Mineflayer)** : trop cher pour un risque ponctuel, et indisponible
  au moment de la sortie d'une nouvelle version de Minecraft. Remplacé par une checklist
  manuelle déclenchée (étape 6).
- Rendre le bas totalement invisible (fond `generic_54.png` transparent) reste hors
  périmètre : cette texture est partagée par tous les conteneurs de type coffre du jeu.

## Architecture cible

- `MenuSlots` (`render/`) : `get(rawSlot)`, `set(rawSlot, item)`, `kind(rawSlot)`, taille
  `size + 36`. Seul point d'écriture du contenu. Menu ouvert, `set` pousse au client via le
  sink.
- `ClientSlotSink` : `sendAll(player, windowId, items)`,
  `sendSlot(player, windowId, rawSlot, item)`. Implémentation PacketEvents fine, sans
  logique ; faux sink qui enregistre les appels dans les tests.
- Listener PacketEvents :
  - `OPEN_WINDOW` → capture du windowId ;
  - `WINDOW_ITEMS` et `SET_SLOT` pour ce windowId → slots `DISPLAY` remplacés par
    `MenuSlots` (haut toujours ; bas seulement si `hidden`) ;
  - `SET_PLAYER_INVENTORY` (1.21.2+) si le bas est `hidden`. Index joueur vers rawSlot :
    `0..8` → `size+27+i`, `9..35` → `size+(i-9)`.
  - Généraliser au haut la logique pure de `PlayerSlots` (`rewriteContent`/`rewriteSlot`).
- `MenuSession` porte `slots: MenuSlots`. `MenuListener` : clics via `rawSlot` (inchangé) ;
  à la fermeture, libérer seulement si c'est la bonne ancre (cas A → B) puis
  `updateInventory()` au tick suivant ; au `PlayerQuit`, nettoyer.

## Étapes

1. **Intégrer PacketEvents**
   - `plugin/build.gradle.kts` :
     `implementation("com.github.retrooper:packetevents-spigot:2.14.0")`
     (dépôt `https://repo.codemc.io/repository/maven-releases/`).
   - Dans `shadowJar` :
     `relocate("com.github.retrooper.packetevents", "net.artisanmc.shaded.packetevents.api")`
     et
     `relocate("io.github.retrooper.packetevents", "net.artisanmc.shaded.packetevents.impl")`.
   - `ArtisanPlugin` :
     - `onLoad` → `PacketEvents.setAPI(SpigotPacketEventsBuilder.build(this))`, réglages
       (update check et bStats désactivés ; noms exacts à vérifier dans la 2.14.0), puis
       `load()` ;
     - `onEnable` → `init()` en premier ;
     - `onDisable` → `terminate()`.
   - Retirer `packetevents` du softdepend de `plugin.yml`, l'option
     `menus.player-inventory-slots` (`config.yml`, `PluginConfig`, `install-admin.md`) et le
     test `getPlugin("packetevents")`.
   - Vérifier : `unzip -l build/libs/*-all.jar | grep -c com/github/retrooper` = 0.
2. **`MenuSlots` + `ClientSlotSink`**
   - `MenuRenderer` remplit `MenuSlots` ; l'ancre reste vide.
   - Supprimer `PlayerSlotOverlayStore`, ou le fusionner dans un store de sessions de
     fenêtre par joueur (ancre, windowId, slots).
3. **Schéma et éditeur**
   - Ajouter `player_inventory` et autoriser les positions jusqu'à `size+35` dans le schéma
     menu versionné (`docs/architecture/versioning.md`, `schemas-codegen.md`, types éditeur
     et plugin régénérés).
   - Éditeur : 4 lignes sous le menu quand `hidden`
     (`editor/src/features/canvas/menuLayout.ts`, `MenuGroup.tsx`) ; chaînes UI en
     `en.ts` + `fr.ts`.
4. **Migrer les tests** : 12 fichiers lisent `topInventory` (environ 40 occurrences, surtout
   `MenuRenderer*Test`) → `session.slots[i]`. Critère : `./gradlew test` vert ;
   `topInventory.getItem` ne reste que dans les tests qui vérifient que l'ancre est vide.
5. **Tests de contrat** avec le faux sink, sur un slot haut (0) et un slot bas (27) :
   - poser, lire, mettre à jour menu ouvert, vider → même résultat dans les deux cas ;
   - passer d'un menu A à un menu B garde l'overlay de B ;
   - la fermeture déclenche la resynchro ;
   - une fenêtre étrangère est ignorée ;
   - un slot `INPUT` n'est jamais réécrit par `rewriteContent` ni par `rewriteSlot`.
6. **Checklist manuelle** dans `docs/architecture/testing.md`, section
   « Menus en paquets » :
   - pierre partout en haut et en bas (`hidden`) ;
   - clic, shift-clic, double-clic, touche numérique, touche F ;
   - ramasser un objet menu ouvert ;
   - passer d'un menu A à un menu B ;
   - fermeture : vrai inventaire intact ;
   - `/data get entity @s Inventory` menu ouvert = vrai inventaire ;
   - `visible` : le vrai inventaire s'affiche et n'est pas modifiable.

   Déclencheurs : mise à jour de Minecraft ou de PacketEvents, et toute modification de
   l'adaptateur ou du listener PacketEvents. À ajouter à la checklist de release.
7. **Documentation** :
   - `invariants.md` : le contenu des menus n'existe que côté client, l'ancre est vide ; les
     positions `≥ size` désignent les slots joueur ;
   - `editor-internals.md`, `CHANGELOG.md` ;
   - ce que demande `.claude/skills/sync-docs/doc-impact-map.yaml`.

## Validation finale

- `./gradlew test shadowJar` vert.
- Checklist de l'étape 6 passée en jeu après `./gradlew deploy`.
- Éditeur : `npm test` et `npm run build`.

## Plus tard : slots de dépôt (`INPUT`)

Fonctionnalité séparée (menus de vente, craft, dépôt). Points à traiter :

- **Shift-clic depuis l'inventaire du joueur** : le serveur rangerait l'objet dans le
  premier slot vide de l'ancre, donc dans un slot d'affichage. Annuler et déplacer
  soi-même vers les slots `INPUT`.
- **Glisser** : annuler si un slot d'affichage fait partie du glissé.
- **Touche numérique, touche F, double-clic** : les autoriser seulement si tous les slots
  concernés sont `INPUT`.
- **Bas visible obligatoire** : un menu avec slots `INPUT` impose `player_inventory: visible`.
- **Fermeture** : rendre au joueur les objets restés dans les slots `INPUT`, ou les jeter
  au sol si son inventaire est plein.
- **Crash serveur** : l'ancre n'existe qu'en mémoire. Consommer l'objet dans l'action
  (vente, craft) plutôt que de le laisser dormir dans le menu.
