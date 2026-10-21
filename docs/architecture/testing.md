# Tests — couverture par couche

Zones couvertes, pas liste de fichiers — `glob **/*.test.*` donne la liste exacte et à jour.

| Couche | Lancer | Zones couvertes |
|---|---|---|
| Backend (~47 fichiers) | `cd backend && bun run test` | hub WS, bundles, server-keys, ws-ticket, auth (signup/login/Discord/session), networks + branches + commits + merge engine, custom items, resource pack (builder / font json / asset index / space offsets / storage), assets (PATCH height, duplicate), version-conflict guard, project import, miroir du Snapshot (store, validité, lecture, branchement hub). |
| Plugin (~45 fichiers) | `cd plugin && ./gradlew test` | bundle hash/download, conflict detection, full-sync intégration (MockWebServer), action parse/exec (incl. `show_title`), title parser/compiler + offset encoder, asset catalog, resource pack manager/delegator, config, project deleter, local push, empreintes du Snapshot au `hello`. |
| Éditeur (≥120 fichiers) | `cd editor && npm test` | expr DSL (lexer/parser/eval/template), canvas + édition de Document, export (transform/validate/zip), i18n, custom items & assets Library, title composer v3, merge/conflits, auth UI, networks/setup/account routes. |
| E2E éditeur | `cd editor && npx playwright test` | `smoke.spec.ts` — canvas charge, sidebar visible (1 test). |
| E2E client | `e2e/client/run.sh` (workflow `e2e-client.yml`) | Vrai client Minecraft contre un vrai Paper : menus en paquets, cf. ci-dessous. |

E2E cross-stack (éditeur → backend → plugin de bout en bout) : **non automatisé**, test manuel via
Docker.

## Backend — `bun run test`, jamais `bun test`

Le wrapper `scripts/test.ts` redirige `DATABASE_URL` vers la DB `artisan_test` (auto-create +
migrate) avant de spawner vitest. `bun test` direct bypasse le wrapper, et les `beforeEach(clearAll)`
des tests vident alors la DB **dev** `artisan` — incident réel le 2026-06-01, toutes les données dev
wipées. Si tu vois `bun test src/...` dans un terminal d'agent, c'est un bug.

Garde mécanique : `db/index.ts` throw si `NODE_ENV=test` et que le nom de la DB ne contient pas
`test`.

Override l'URL admin via `ADMIN_DATABASE_URL` si Postgres n'est pas sur
`postgres/postgres@localhost:5432`.

## Vecteurs de conformance cross-langage

Trois vecteurs partagés verrouillent une égalité entre implémentations Kotlin et TS. Changer l'algo
= mettre à jour les deux côtés **et** régénérer le vecteur.

| Vecteur | Asservi par |
|---|---|
| `testdata/project-hash-conformance.json` | `BundleHashConformanceTest` (plugin) + `hashUtils.test.ts` (backend) |
| `testdata/lang-tree-conformance.json` | `LangFlattener` (plugin) + `langTree.ts` (éditeur) |
| `testdata/i18n-address-conformance.json` | `I18nAddresses.kt` (plugin) + sites i18n éditeur |

## Menus en paquets — checklist manuelle

Le contenu des menus n'existe que côté client (cf. `invariants.md`) : les tests plugin verrouillent
le contrat (`MenuSlotsContractTest`, faux `ClientSlotSink`) mais pas le comportement du client
Minecraft réel. Mineflayer a été écarté (réimplémente le protocole, donc indisponible à la sortie
d'une nouvelle version de Minecraft, précisément quand le risque est là).

**Automatisé** — `e2e/client/` : un mod Fabric client (`mod/`, Mojang names, sans Fabric API)
déroule un scénario au tick et écrit `ok`/`FAIL` par contrôle dans un fichier résultat ;
`run.sh` monte un Paper jetable (`online-mode=false`, plugin + `fixtures/projects/`, joueur
`Offline` op via `ops.json`) puis lance le client via HeadlessMC (`-lwjgl --offline` : ni écran, ni
compte). Pas de backend : le projet est lu sur le disque. Le workflow `e2e-client.yml` ne tourne que
sur les fichiers ci-dessous (et à la main), avec et sans le plugin PacketEvents autonome. Couvert
aujourd'hui : les cases marquées *Automatisé* ; les cases visuelles (textures, glyphs, pack refusé)
demandent un rendu réel et restent manuelles.
Nouvelle version de Minecraft : monter `MC_VERSION` du workflow et `minecraft_version` du mod.

**Déclencheurs** : mise à jour de Minecraft ou de PacketEvents, toute modification de
`PacketEventsMenuPackets.kt` / `MenuWindows.kt` / `MenuSlots.kt`. Aussi dans la checklist de release
(`versioning.md` §11.1).

Sur `./gradlew deploy`, avec un menu `player_inventory: hidden` qui pose de la pierre sur toutes les
positions (haut et bas) et un menu `visible` :

- [x] Pierre partout en haut et en bas (`hidden`). *Automatisé.*
- [x] Clic, shift-clic, double-clic, touche numérique, touche F : rien ne bouge, rien n'est récupéré. *Automatisé.*
- [x] Ramasser un objet au sol menu ouvert : le bas reste celui du menu. *Automatisé.*
- [x] Passer d'un menu A à un menu B (bouton `open_menu`) : B s'affiche entier, sans reste de A. *Automatisé.*
- [x] Retour : `A → B → C` puis bouton `open_previous_menu` deux fois ramène à A (jamais de va-et-vient C↔B) ; sans historique, le placeholder `{has_previous_menu}` est faux et le retour ne fait rien. *Automatisé.*
- [x] Fermeture : le vrai inventaire revient intact. *Automatisé (menu `hidden`).*
- [x] `/data get entity @s Inventory` menu ouvert = le vrai inventaire (rien côté serveur). *Automatisé.*
- [x] `visible` : le vrai inventaire s'affiche et n'est pas modifiable. *Automatisé.*
- [ ] `vanilla_texture: false` : fenêtre transparente (haut et bas), la glyph du menu s'affiche, les
  items restent au-dessus de la glyph.
- [ ] Même serveur : un vrai coffre, un tonneau, un ender chest et un double coffre gardent leur
  texture vanilla (réinjectée), titre à sa place ; idem juste après `/artisan reload`.
- [x] Joueur qui refuse le pack : coffres vanilla normaux, aucun caractère manquant dans les titres.
  *Automatisé (vrai coffre, avant et après `/artisan reload`) : le serveur croit les coffres
  transparents (`fixtures/cache/`), le client refuse le pack.*
- [ ] Menus entonnoir et dropper en `vanilla_texture: false` : fenêtres transparentes ; un vrai
  entonnoir, un distributeur et un dropper gardent leur texture (réinjectée), un vrai coffre n'est
  pas touché tant qu'aucun menu coffre n'est transparent.
- [ ] Avec le plugin PacketEvents installé à côté (copie relocalisée + plugin autonome) : démarrage
  sans erreur et tout ce qui précède tient. *Automatisé pour les cases automatisées (variante
  `standalone` du workflow) ; les cases visuelles restent à vérifier à la main.*
