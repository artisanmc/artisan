# Artisan — Instructions Claude

Ce fichier est un **routeur** : l'opérationnel (commandes, pièges) + où aller pour le détail.
Il reste court volontairement — le détail vit dans `docs/`, lu quand la tâche y touche.

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
| `docs/architecture/invariants.md` | Les invariants critiques en détail (hash, sync, exclusions). |
| `docs/architecture/modules.md` | Modular monolith : abstraction module, data sources + commands, comment en ajouter un. |
| `docs/architecture/versioning.md` | Les 4 disciplines (CHANGELOG, schemas versionnés, DB forward-only, REST `/api/v1/`). |
| `docs/architecture/api-surface.md` | Surface API publique stable (`@Stable`/`@Beta`/`@Internal`/`@Sunset`). |
| `docs/architecture/ws-protocol.md` | Messages WS plugin ↔ backend + flux de données. |
| `docs/architecture/rest-endpoints.md` | Index des routes REST (quel fichier ouvrir) + conventions. |
| `docs/architecture/entities.md` | Modèle de données, auth, transferts, historique des phases. |
| `docs/architecture/editor-internals.md` | Title composer, édition de Document, canvas, `<SchemaForm>`, UI shell, design system. |
| `docs/architecture/project-files.md` | Structure d'un project sur disque, codec `lang/`, champ `title`. |
| `docs/architecture/plugin-commands.md` | Détail des sous-commandes `/artisan`. |
| `docs/architecture/testing.md` | Couverture des suites + vecteurs de conformance. |
| `docs/architecture/schemas-codegen.md` | Schémas JSON ↔ types éditeur/plugin. |
| `docs/decisions/` | ADRs. `docs/specs/`, `docs/superpowers/` : specs et plans. |
| `.env.example` | **Toutes** les variables d'environnement backend, documentées sur place. |

Auth Google/Discord : identités communes `oauth_accounts` (migration 0034, anciens liens Discord conservés). Variables `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI` requises ; Compose les transmet avec les variables Discord et `EDITOR_URL`. Callback local Google : `http://localhost:3001/api/v1/auth/google/callback`. Règles de liaison dans `docs/architecture/entities.md`, configuration dans `docs-site/src/content/docs/contributing/index.md`.

## Commandes

```bash
# Plugin (Kotlin 2.0 / Paper 1.21.4)
cd plugin
./gradlew test          # suite plugin (unit + intégration MockWebServer)
./gradlew shadowJar     # → build/libs/artisan-plugin-1.0.0-SNAPSHOT-all.jar
./gradlew deploy        # compile + redémarre le container

# Backend (Bun + Hono + PostgreSQL)
cd backend
bun run dev             # --watch sur port 3001
bun run test            # ⚠️ JAMAIS `bun test` direct — cf. plus bas
bun run db:push         # schéma Drizzle → DB. dev/test UNIQUEMENT
bun run db:generate     # génère drizzle/NNNN_<name>.sql — À COMMITTER
bun run db:migrate      # applique les migrations en ordre (prod + Docker au boot)

# Éditeur (React 19 + Vite 6)
cd editor
npm run dev             # port 5173
npm test
npm run build

# Stack complète
cp .env.example .env && docker compose up   # backend:3001 + editor:5173 + minecraft:25565
```

**Migrations** — tout merge dans `main` qui modifie `schema.ts` DOIT inclure la migration générée
(`db:generate`). Pas de `db:push` en prod.

**Commandes plugin** — `/artisan menu|reload|sync|link|editor|dump-title`, détail dans
`docs/architecture/plugin-commands.md`.

**Assets MC** — `bun backend/scripts/gen-items.ts [version]` → `gen-icons.ts` → `pack-icons.ts`
(→ `backend/assets-seed/icons-<version>.zip`, **à committer**). `backend/data/` est un volume en
prod : les icônes 3D ne se régénèrent jamais côté serveur, elles voyagent dans l'image et sont
déposées au boot par `lib/assetSeed.ts` (jamais d'écrasement — le volume est la vérité).

## Architecture

```
editor/          React 19 + Vite + Konva
backend/         Bun + Hono + PostgreSQL (Drizzle)
plugin/          Kotlin 2.0 + Paper 1.21.4 + OkHttp
docker/          Config serveur Minecraft (itzg/minecraft-server)
docs-site/       Astro Starlight — docs user publiques (EN)
docs/            architecture/ · decisions/ · specs/ · schema/ · superpowers/
```

**Modular monolith** — chaque module vit en 3 layers symétriques :
`plugin/…/modules/{id}/` (impl `ArtisanModule`), `backend/src/modules/{id}/` (`BackendModule`),
`editor/src/modules/{id}/` (`FrontendModule`). Communication cross-module via `DataSourceRegistry` et
`CommandRegistry` uniquement — aucune dépendance directe. **Un `ArtisanModule` n'importe que depuis
`net.artisanmc.modules.api.*`**, jamais depuis `net.artisanmc.plugin.*` (implicitement `@Internal`).
Ajouter un module : `docs/architecture/modules.md`.

## Pièges à conséquence

Les trois qu'on ne peut pas se permettre de découvrir après coup. Le reste — et le détail de
ceux-ci — dans **`docs/architecture/invariants.md`**.

1. **`bun run test`, jamais `bun test`** — le direct bypasse le wrapper et **vide la DB dev**
   `artisan` (incident 2026-06-01).
2. **Le contenu publié d'un Project vit sur le disque du serveur** — le backend stocke les
   brouillons privés (`project_drafts`, révision 2026-09-11 de `server-disk-only-storage`).
   L'éditeur sauvegarde automatiquement son brouillon ; publier reste explicite, via
   `project_write` et son compare-and-swap. Serveur hors ligne : brouillon ouvrable,
   publication impossible. Voir `docs/architecture/entities.md` et `rest-endpoints.md`.
3. **`.artisan*` en premier segment = métadonnée** — hors hash, invisible au scan disque. L'éditeur
   possède `.artisan/editor.yaml` (il peut l'écrire) ; `.artisan/history/` (corbeille),
   `.artisan-trash/` et `.artisan-sync.yaml` lui restent invisibles **et** interdits en écriture.

## Design system éditeur

Tout nouveau développement UI passe **en priorité** par le design system (spécimen sur
`/admin/design`, admin requis) :

1. Composants `editor/src/components/ui/` ou classes utilitaires de `globals.css` (`.btn*`, `.input`,
   `.card`, `.chip`, `.badge*`, `.tab`, `.eyebrow`, `.field-label`…) d'abord.
2. Composant manquant → le créer dans `components/ui/` + ajouter son spécimen à `/admin/design`
   dans le même commit. Pas de styling ad-hoc dupliqué.
3. Couleurs uniquement via `var(--token)`, jamais de hex/rgba en dur. Exception : canvas Konva.

Les strings UI passent par react-i18next (`en.ts` + `fr.ts` dans le même commit) — jamais de
français/anglais en dur dans le JSX.
