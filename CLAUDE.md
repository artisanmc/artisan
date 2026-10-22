# Artisan — Instructions Claude

Ce fichier est un **routeur** : l'opérationnel (commandes, pièges) + où aller pour le détail.
Il reste court volontairement — le détail vit dans `docs/`, lu quand la tâche y touche.

## Agent skills

### Issue tracker

Les tickets et PRD vivent dans GitHub Issues. Voir `docs/agents/issue-tracker.md`.

### Triage labels

Les cinq statuts standards sont utilisés. Voir `docs/agents/triage-labels.md`.

### Domain docs

Dépôt à contexte unique : `CONTEXT.md` et `docs/decisions/`. Voir `docs/agents/domain.md`.

## Règle de mise à jour des docs

Quand tu modifies du code, mets à jour la doc correspondante. **Le mapping source-de-vérité est
`.claude/skills/sync-docs/doc-impact-map.yaml`** (quel fichier touché → quels docs mettre à jour) —
consulte-le, ne le devine pas.

- Update petit (une ou deux sections existantes, ≲30 lignes de diff doc) → **même commit** que le code.
- Update gros ou nécessitant des screenshots / refonte → skill `/sync-docs` en fin de feature, commit séparé.
- Jamais de merge avec dette doc non-listée.

Ne pas mettre à jour = la prochaine session ne saura pas que le code a changé.

## Docs de référence

| Doc | Contenu |
|---|---|
| `CONTEXT.md` | Glossaire domaine — **source de vérité des termes**. |
| `docs/architecture/invariants.md` | Les invariants critiques en détail (disque, CAS, exclusions, threads). |
| `docs/architecture/modules.md` | Modular monolith : abstraction module, data sources + commands, comment en ajouter un. |
| `docs/architecture/versioning.md` | Les disciplines (CHANGELOG, schemas versionnés, version du protocole, REST `/api/v1/`). |
| `docs/architecture/api-surface.md` | Surface API publique stable (`@Stable`/`@Beta`/`@Internal`/`@Sunset`). |
| `docs/architecture/ws-protocol.md` | Messages hub ↔ serveur (`/ws/plugin`) + `/ws/editor`. |
| `docs/architecture/rest-endpoints.md` | Index des routes du hub (quel `*Routes.kt` ouvrir) + conventions. |
| `docs/architecture/entities.md` | Ce qui persiste où (disque, base de la suite, mémoire du hub), auth, historique. |
| `docs/architecture/editor-internals.md` | Title composer, édition de Document, canvas, UI shell, design system. |
| `docs/architecture/project-files.md` | Structure d'un project sur disque, codec `lang/`, champ `title`. |
| `docs/architecture/plugin-commands.md` | Détail des sous-commandes `/artisan`. |
| `docs/architecture/testing.md` | Couverture des suites + vecteurs de conformance. |
| `docs/architecture/schemas-codegen.md` | Schémas JSON ↔ types éditeur/plugin. |
| `docs/decisions/` | ADRs (`editor-web-server` : le hub). `docs/specs/` : specs produit ; `docs/archive/specs/` : conceptions passées (voir son README). |

## Commandes

```bash
# Plugin (Kotlin 2.0 / Paper 1.21+, Folia, Leaf)
cd plugin
./gradlew test          # tous les modules (api, core, database, hub, paper)
./gradlew shadowJar     # → paper/build/libs/artisan-plugin-1.0.0-SNAPSHOT-all.jar
./gradlew shadowJar -PwithEditor   # idem, avec l'éditeur et les icônes 3D embarqués (npm requis)
./gradlew deploy        # compile + redémarre le container

# Éditeur (React 19 + Vite 6)
cd editor
npm run dev             # port 5173, /api et /ws relayés au hub (ARTISAN_HUB_URL, défaut :8765)
npm test
npm run build           # le build servi par le hub (appelé par -PwithEditor)
npm run build:site      # vitrine + wiki d'artisanmc.net (editor/Dockerfile)

# Serveur local
docker compose up       # Paper :25565 + éditeur du plugin :8765 + MySQL de la boutique
docker compose -f docker/network/compose.yml up   # réseau : un hub + une feuille
```

**Commandes plugin** — `/artisan menu|reload|sync|editor|dump-title`, détail dans
`docs/architecture/plugin-commands.md`.

**Assets MC** — `cd tools/minecraft-assets && bun gen-items.ts [version]` → `gen-icons.ts` → `pack-icons.ts`
(→ `items/<version>.json` + `icons/icons-<version>.zip`, **à committer** ; le hub les embarque dans le
jar). Détail : `tools/minecraft-assets/README.md`.

## Architecture

```
editor/          React 19 + Vite + Konva — servi par le plugin (hub)
plugin/          Kotlin 2.0 + Paper : api · core · database · hub (Jetty 12) · paper
docker/          Serveurs Minecraft locaux (itzg/minecraft-server), réseau dans docker/network/
tools/minecraft-assets/  Générateurs Bun des assets MC vanilla (items, icônes 3D, largeurs de glyphes)
docs/site/       Docs user publiques (EN, Markdown Starlight) — assemblées par artisanmc.net
docs-site/       Build Astro Starlight de docs/site/, servi sur artisanmc.net/wiki
docs/            architecture/ · archive/ · decisions/ · specs/ · schema/
```

**Pas de backend** — le plugin sert l'éditeur, l'API `/api/v1/…` et les WebSockets sur `web.port`
(8765). Connexion par le lien de `/artisan editor`. Réseau : un serveur `web.role: hub`, les autres
`leaf` reliés à son `/ws/plugin` par un secret partagé. ADR `editor-web-server`.

**Plugin en modules Gradle** — `plugin/api` (surface add-ons, **en Java** : API 2.0.0), `plugin/core` (domaine, sans Bukkit),
`plugin/database`, `plugin/hub` (serveur web, sans Bukkit), `plugin/runtime` (moteur d'actions, conditions, items,
traductions), `plugin/paper` (menus, présence, jar). Un import
`org.bukkit` hors de `paper`, `runtime` ou `api` ne compile pas. Détail : `plugin/README.md`, ADR `plugin-gradle-modules`,
`runtime-library`.

**Modular monolith** — chaque module vit en 2 layers symétriques :
`plugin/…/modules/{id}/` (impl `ArtisanModule`) et `editor/src/modules/{id}/` (`FrontendModule`).
Communication cross-module via `DataSourceRegistry` et `CommandRegistry` uniquement — aucune dépendance
directe. **Un `ArtisanModule` n'importe que depuis `net.artisanmc.modules.api.*`**, jamais depuis
`net.artisanmc.plugin.*` (implicitement `@Internal`). Ajouter un module : `docs/architecture/modules.md`.

## Pièges à conséquence

Les trois qu'on ne peut pas se permettre de découvrir après coup. Le reste — et le détail de
ceux-ci — dans **`docs/architecture/invariants.md`**.

1. **Le contenu publié vit sur le disque du serveur, le reste dans la base de la suite** — seul
   le serveur écrit ses fichiers (`project_write` ou publication d'un brouillon, compare-and-swap).
   La base garde ce que chaque serveur a chargé (`artisan_servers`, Versions,
   `artisan_server_state`) et les brouillons privés (`artisan_drafts`, un jeu par UUID de joueur,
   autosave) : le hub lit et édite depuis la base, serveur éteint compris ; seules les écritures et
   les données live vont au serveur (ADR `server-identity-and-versions`).
2. **`.artisan*` en premier segment = métadonnée** — hors hash, invisible au scan disque. L'éditeur
   possède `.artisan/editor.yaml` (il peut l'écrire) ; `.artisan/history/`, `.artisan/drafts/`, `.artisan/project-id`, `.artisan/origins.yaml`,
   `.artisan-trash/` et `.artisan-sync.yaml` lui restent invisibles **et** interdits en écriture.
3. **Threads : Paper, Folia, Leaf** — jamais `Bukkit.getScheduler()` : tout passe par le port
   `Scheduler`. Jetty répond sur ses propres threads ; tout accès au jeu depuis le hub repasse par
   le scheduler.

## Design system éditeur

Tout nouveau développement UI passe **en priorité** par le design system (spécimen sur `/design`) :

1. Composants `editor/src/components/ui/` ou classes utilitaires de `globals.css` (`.btn*`, `.input`,
   `.card`, `.chip`, `.badge*`, `.tab`, `.eyebrow`, `.field-label`…) d'abord.
2. Composant manquant → le créer dans `components/ui/` + ajouter son spécimen à `/design`
   dans le même commit. Pas de styling ad-hoc dupliqué.
3. Couleurs uniquement via `var(--token)`, jamais de hex/rgba en dur. Exception : canvas Konva.

Les strings UI passent par react-i18next (`en.ts` + `fr.ts` dans le même commit) — jamais de
français/anglais en dur dans le JSX.
