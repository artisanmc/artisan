# Docs Strategy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Mettre en place une doc utilisateur publique (Astro Starlight, anglais, MVP = quickstart admin) + une discipline de maintenance (règles CLAUDE.md + skill local `/sync-docs`) qui survit aux features futures.

**Architecture:** Nouveau `docs-site/` à la racine (Astro Starlight 0.30, EN). `docs/` existant (specs, plans, ADRs) inchangé. CLAUDE.md étendu avec table mise à jour. Skill `.claude/skills/sync-docs/` piloté par un YAML mapping fichiers source → docs à toucher.

**Tech Stack:** Astro 5, Starlight 0.30, Markdown, YAML, Node 20.

**Spec source :** `docs/superpowers/specs/2026-05-20-docs-strategy-design.md`.

---

## Files créés / modifiés (vue d'ensemble)

**Créés :**
- `docs-site/package.json`
- `docs-site/astro.config.mjs`
- `docs-site/tsconfig.json`
- `docs-site/.gitignore`
- `docs-site/src/content.config.ts`
- `docs-site/src/content/docs/index.md`
- `docs-site/src/content/docs/getting-started/install-admin.md`
- `docs-site/src/content/docs/editor/index.md`
- `docs-site/src/content/docs/contributing/index.md`
- `.claude/skills/sync-docs/SKILL.md`
- `.claude/skills/sync-docs/doc-impact-map.yaml`

**Modifiés :**
- `CLAUDE.md` (table de maintenance étendue + règle de comportement)
- `.gitignore` racine (si nécessaire, pour exclure `docs-site/node_modules`)

---

## Task 1: Scaffolder docs-site/ (Astro Starlight)

**Files:**
- Create: `docs-site/package.json`
- Create: `docs-site/astro.config.mjs`
- Create: `docs-site/tsconfig.json`
- Create: `docs-site/.gitignore`
- Create: `docs-site/src/content.config.ts`

- [ ] **Step 1: Créer `docs-site/package.json`**

```json
{
  "name": "docs-site",
  "type": "module",
  "version": "0.0.1",
  "private": true,
  "scripts": {
    "dev": "astro dev",
    "build": "astro build",
    "preview": "astro preview"
  },
  "dependencies": {
    "@astrojs/starlight": "^0.30.0",
    "astro": "^5.0.0",
    "sharp": "^0.33.0"
  }
}
```

- [ ] **Step 2: Créer `docs-site/astro.config.mjs`**

```js
import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';

export default defineConfig({
  integrations: [
    starlight({
      title: 'Artisan',
      description: 'Build beautiful Minecraft inventory menus with a visual editor.',
      sidebar: [
        {
          label: 'Getting started',
          items: [
            { label: 'Install on a Paper server', slug: 'getting-started/install-admin' },
          ],
        },
        {
          label: 'Editor',
          items: [
            { label: 'Overview', slug: 'editor' },
          ],
        },
        {
          label: 'Contributing',
          items: [
            { label: 'Overview', slug: 'contributing' },
          ],
        },
      ],
    }),
  ],
});
```

- [ ] **Step 3: Créer `docs-site/tsconfig.json`**

```json
{
  "extends": "astro/tsconfigs/strict",
  "include": [".astro/types.d.ts", "**/*"],
  "exclude": ["dist"]
}
```

- [ ] **Step 4: Créer `docs-site/.gitignore`**

```
node_modules/
.astro/
dist/
.env
.env.*
*.log
```

- [ ] **Step 5: Créer `docs-site/src/content.config.ts`**

```ts
import { defineCollection } from 'astro:content';
import { docsLoader } from '@astrojs/starlight/loaders';
import { docsSchema } from '@astrojs/starlight/schema';

export const collections = {
  docs: defineCollection({ loader: docsLoader(), schema: docsSchema() }),
};
```

- [ ] **Step 6: Installer les deps**

Run dans `docs-site/`:
```bash
npm install
```

Expected: `node_modules/` créé, aucune erreur fatale. Warnings de peer deps OK.

- [ ] **Step 7: Commit (scaffold sans content)**

```bash
git add docs-site/package.json docs-site/astro.config.mjs docs-site/tsconfig.json docs-site/.gitignore docs-site/src/content.config.ts docs-site/package-lock.json
git commit -m "chore(docs-site): scaffold Astro Starlight project"
```

---

## Task 2: Pages de contenu de base (landing + stubs)

**Files:**
- Create: `docs-site/src/content/docs/index.md`
- Create: `docs-site/src/content/docs/editor/index.md`
- Create: `docs-site/src/content/docs/contributing/index.md`

- [ ] **Step 1: Créer la landing `docs-site/src/content/docs/index.md`**

```markdown
---
title: Artisan
description: Build beautiful Minecraft inventory menus with a visual editor.
template: splash
hero:
  title: Artisan
  tagline: Design Minecraft inventory menus visually. Live-sync from web to server.
  actions:
    - text: Install on a Paper server
      link: /getting-started/install-admin/
      icon: right-arrow
      variant: primary
---
```

- [ ] **Step 2: Créer le stub `docs-site/src/content/docs/editor/index.md`**

```markdown
---
title: Editor
description: Documentation for menu and pack creators using the Artisan web editor.
---

The editor guide is under construction. For now, the editor is best learned
by opening it (`/artisan editor` in-game) and experimenting — basic operations
are discoverable.

Sections planned:
- Creating your first pack and menu
- Slots, glyphs, and titles
- Click handlers and actions
- Dialogs and commands
- Importing custom items (Nexo / Oraxen / ItemsAdder)
```

- [ ] **Step 3: Créer le stub `docs-site/src/content/docs/contributing/index.md`**

```markdown
---
title: Contributing
description: Architecture and development guide for contributors and forkers.
---

The contributing guide is under construction.

Sections planned:
- Repo layout (editor / backend / plugin)
- Running the stack locally (Docker Compose)
- Self-hosting your own backend
- WebSocket protocol and bundle format
- Adding a new feature end-to-end
```

- [ ] **Step 4: Vérifier que le dev server boote et rend les pages**

Run dans `docs-site/`:
```bash
npm run dev
```

Expected: serveur listen sur `http://localhost:4321/`. Vérifier dans un browser :
- `/` → landing avec hero "Artisan".
- `/editor/` → page stub.
- `/contributing/` → page stub.
- Sidebar montre les 3 sections.

Arrêter le serveur (Ctrl+C).

- [ ] **Step 5: Vérifier que `npm run build` passe**

Run dans `docs-site/`:
```bash
npm run build
```

Expected: build success, sortie dans `docs-site/dist/`. Aucune erreur.

- [ ] **Step 6: Commit**

```bash
git add docs-site/src/content/docs/index.md docs-site/src/content/docs/editor/index.md docs-site/src/content/docs/contributing/index.md
git commit -m "docs(site): landing + editor/contributing stubs"
```

---

## Task 3: Page MVP — install-admin.md

**Files:**
- Create: `docs-site/src/content/docs/getting-started/install-admin.md`

**Contexte préparé :** la config plugin actuelle et les commandes `/artisan` sont déjà connues du plan (config.yml lu, ArtisanCommand lu). Si tu exécutes cette task et la doc plugin a changé entre-temps, relire :
- `plugin/src/main/resources/config.yml`
- `plugin/src/main/kotlin/net/artisanmc/plugin/command/ArtisanCommand.kt`

- [ ] **Step 1: Créer `docs-site/src/content/docs/getting-started/install-admin.md`**

```markdown
---
title: Install on a Paper server
description: Get Artisan running on your Paper server in five minutes.
---

This guide walks you through installing the Artisan plugin on a Paper
server and linking it to the Artisan backend so you can design menus
from the web editor.

> **Prerequisites**
> - Paper 1.21.4 or newer
> - Java 21
> - An Artisan account (self-hosting the backend is out of scope for this guide)

## 1. Download the plugin

Download the latest `artisan-plugin-*.jar` from the Artisan GitHub
Releases page, then drop it into your server's `plugins/` folder.

Restart the server once. A default `plugins/Artisan/config.yml` is
generated. The plugin will log `Artisan enabled — no server_key set,
running in offline mode`.

## 2. Link your server

Get a `server_key` from your Artisan dashboard. Open
`plugins/Artisan/config.yml` and paste it:

```yaml
server_key: "sk_live_..."
ws_url: "wss://editor.artisanmc.net/ws/plugin"
```

Run `/artisan reload` (or restart). The log should show:

```
Artisan enabled — connected to backend, pack synced
```

## 3. Open the editor

In-game, run:

```
/artisan editor
```

A trust link appears in chat. Click it to open the editor in your browser.
The editor is now paired with your server — any change you save is
live-synced to your players' next menu open.

To revoke the active editor session at any time:

```
/artisan editor revoke
```

## 4. Useful commands

| Command | Description |
|---|---|
| `/artisan menu <id>` | Open a menu by id (in-game). |
| `/artisan reload` | Reload menus from disk. |
| `/artisan sync status` | Show the last sync status. |
| `/artisan sync reject` | Reload from disk and reconnect to the backend. |
| `/artisan editor` | Open the editor (paired with this server). |
| `/artisan editor revoke` | Revoke the active editor session. |

## 5. Troubleshooting

**"Connection refused" or backend unreachable**
The plugin can't reach `ws_url`. Check that your server has outbound
internet, and that no firewall blocks WebSocket on port 443.

**"Invalid server_key"**
The key was rotated or revoked. Get a fresh one from your Artisan
dashboard and re-paste it into `config.yml`, then `/artisan reload`.

**Resource pack not loading**
By default the plugin sends its own resource pack on join. If a
competing plugin (Oraxen, Nexo, ItemsAdder) also sends one, players
see two prompts at login. See _Resource pack distribution_ below.

## 6. Resource pack distribution (advanced)

Three modes, controlled by `resource-pack.delegate-to-dir` in
`config.yml`.

**Default — Artisan pushes its own pack**

Leave `delegate-to-dir` empty. Artisan pushes its pack to each player
using the 1.20.3+ multi-pack stack, coexisting with other RP plugins
side by side. Two login prompts when a host plugin also pushes one.

**Delegation to a directory** — for Oraxen / ItemsAdder

```yaml
resource-pack:
  delegate-to-dir: "plugins/Oraxen/pack/external_packs/artisan"
  delegate-reload-command: "oraxen reload pack"
```

Artisan writes its pack contents under `<path>/assets/artisan/`
on every update, and skips player push. Set
`delegate-reload-command` so the host plugin reloads its pack
automatically.

**Delegation to a zip** — for Nexo

```yaml
resource-pack:
  delegate-to-dir: "plugins/Nexo/pack/external_packs/artisan.zip"
  delegate-reload-command: "n reload"
```

Same idea, but written as a single zip file. Required for Nexo because
its directory scanner skips PNGs for non-vanilla namespaces — only the
zip-merger picks them up.

## 7. Reference: `config.yml`

```yaml
# Set to connect this server to the Artisan editor backend for live sync.
# Leave empty to run offline using only locally exported packs.
server_key: ""
ws_url: "wss://editor.artisanmc.net/ws/plugin"

# Language for plugin system messages (en, fr). Defaults to en.
# Place custom lang files in plugins/Artisan/lang/<code>.yml to override.
language: "en"

# When true, plugin messages are sent in each player's client language when
# a matching lang file is available. Falls back to 'language' if not.
per_player_language: false

# Editor access settings.
editor:
  # Set to true to restrict /artisan editor to console only (no in-game players).
  console_only: false

# Resource pack pushed by Artisan (independent from Oraxen/Nexo/ItemsAdder
# packs; uses the 1.20.3+ pack stack so it coexists with other packs side-by-side).
resource-pack:
  enabled: true
  prompt: "<gold>Pack Artisan</gold>"
  send-on-join: true
  send-delay-ticks: 20
  # See "Resource pack distribution" section above.
  delegate-to-dir: ""
  # Command dispatched on the console after each pack update (e.g. "n reload",
  # "oraxen reload pack"). Empty = no auto-reload.
  delegate-reload-command: ""
```
```

- [ ] **Step 2: Vérifier le rendu**

Run dans `docs-site/`:
```bash
npm run dev
```

Naviguer vers `http://localhost:4321/getting-started/install-admin/`. Vérifier :
- Toutes les sections présentes.
- Blocs YAML colorés.
- Liens internes (none in this page) OK.
- Pas de warnings dans la console Astro.

Arrêter (Ctrl+C).

- [ ] **Step 3: Vérifier le build**

```bash
npm run build
```

Expected: succès.

- [ ] **Step 4: Commit**

```bash
git add docs-site/src/content/docs/getting-started/install-admin.md
git commit -m "docs(site): write install-admin.md (MVP quickstart)"
```

---

## Task 4: Étendre CLAUDE.md

**Files:**
- Modify: `CLAUDE.md` (section "Règles de mise à jour des docs")

- [ ] **Step 1: Localiser le tableau existant**

Le tableau actuel se trouve juste après `## Règles de mise à jour des docs`. Il liste 6 lignes (Protocole WS, Stack, Termes du domaine, Commandes plugin, Variables d'env, Endpoints API). Modifier ce tableau en ajoutant 4 lignes pour `docs-site/`.

- [ ] **Step 2: Remplacer le tableau actuel par sa version étendue**

Trouver dans `CLAUDE.md` :

```markdown
| Tu touches | Tu mets à jour |
|---|---|
| Protocole WS (`hub.ts`, `protocol.ts`, `WsClient.kt`) | `docs/specs/` section protocole |
| Stack / dépendances | `docs/decisions/stack.md` + tableau "Pivots" si c'est un changement de choix |
| Termes du domaine (Pack, Menu, Element…) | `CONTEXT.md` |
| Commandes plugin (`ArtisanCommand.kt`) | Ce fichier, section Plugin ci-dessous |
| Variables d'environnement | `.env.example` + ce fichier |
| Endpoints API | Ce fichier, section Backend |
```

Remplacer par :

```markdown
| Tu touches | Tu mets à jour |
|---|---|
| Protocole WS (`hub.ts`, `protocol.ts`, `WsClient.kt`) | `docs/specs/` section protocole |
| Stack / dépendances | `docs/decisions/stack.md` + tableau "Pivots" si c'est un changement de choix |
| Termes du domaine (Pack, Menu, Element…) | `CONTEXT.md` |
| Commandes plugin (`ArtisanCommand.kt`) | Ce fichier, section Plugin ci-dessous + `docs-site/src/content/docs/getting-started/install-admin.md` (table commandes) |
| Variables d'environnement | `.env.example` + ce fichier |
| Endpoints API | Ce fichier, section Backend |
| Config plugin (`config.yml`, defaults) | `docs-site/src/content/docs/getting-started/install-admin.md` (sections Config / Reference) |
| Resource pack distribution modes (`ResourcePackDelegator.kt`) | `docs-site/src/content/docs/getting-started/install-admin.md` (section Resource pack) + ce fichier |
| UI éditeur visible user (nouveau bouton/flow user-facing) | `docs-site/src/content/docs/editor/<feature>.md` (créer si nécessaire) |
```

- [ ] **Step 3: Ajouter la règle de comportement juste après le tableau**

Trouver la ligne `Ne pas mettre à jour = la prochaine session ne saura pas que le code a changé.` Insérer un nouveau paragraphe juste après cette ligne (avant le `---` de séparation) :

```markdown
**Discipline same-commit vs `/sync-docs`** — Quand un commit touche du code marqué dans le tableau, la doc correspondante doit être mise à jour dans le même commit si l'update reste petit (changement ciblé d'une ou deux sections existantes, typiquement ≤30 lignes diff de doc). Si l'update doc dépasse ce volume ou nécessite des screenshots / refonte, invoquer le skill `/sync-docs` à la fin de la feature pour traiter la dette doc en un commit séparé. Ne jamais merger une PR avec dette doc non-listée. La source de vérité fine du mapping est `.claude/skills/sync-docs/doc-impact-map.yaml` ; la table ci-dessus en est un résumé humain.
```

- [ ] **Step 4: Vérifier le diff**

```bash
git diff CLAUDE.md
```

Expected: 3 lignes ajoutées au tableau, 1 ligne du tableau modifiée (commandes plugin), 1 paragraphe ajouté après "Ne pas mettre à jour = …".

- [ ] **Step 5: Commit**

```bash
git add CLAUDE.md
git commit -m "docs(claude-md): extend doc-update table + same-commit/sync-docs rule"
```

---

## Task 5: Créer le skill `/sync-docs`

**Files:**
- Create: `.claude/skills/sync-docs/SKILL.md`
- Create: `.claude/skills/sync-docs/doc-impact-map.yaml`

- [ ] **Step 1: Créer `.claude/skills/sync-docs/doc-impact-map.yaml`**

```yaml
# doc-impact-map.yaml — source of truth for which docs to update
# when which source files change. Used by the /sync-docs skill.
#
# Patterns: minimatch-style globs. ** = recursive wildcard.

mappings:
  - touches: "plugin/src/main/resources/config.yml"
    updates:
      - "docs-site/src/content/docs/getting-started/install-admin.md"
    reason: "User-visible plugin config (Reference + Config sections)"

  - touches: "plugin/src/main/kotlin/**/ArtisanCommand.kt"
    updates:
      - "docs-site/src/content/docs/getting-started/install-admin.md"
      - "CLAUDE.md"
    reason: "User-visible commands (table in install-admin + plugin section in CLAUDE.md)"

  - touches: "plugin/src/main/kotlin/**/ResourcePackDelegator.kt"
    updates:
      - "docs-site/src/content/docs/getting-started/install-admin.md"
      - "CLAUDE.md"
    reason: "Resource pack distribution mode (Resource pack section)"

  - touches: "plugin/src/main/kotlin/**/PluginConfig.kt"
    updates:
      - "docs-site/src/content/docs/getting-started/install-admin.md"
    reason: "Plugin config schema / defaults"

  - touches: "backend/src/lib/hub.ts"
    updates:
      - "CLAUDE.md"
    reason: "WS protocol (AI-facing only — no user-visible surface)"

  - touches: "backend/src/db/schema.ts"
    updates:
      - "CONTEXT.md"
      - "CLAUDE.md"
    reason: "Domain entities — may shift glossary or AI architecture notes"

  - touches: "editor/src/features/canvas/**"
    updates:
      - "docs-site/src/content/docs/editor/"
      - "CLAUDE.md"
    reason: "User-visible editor UX (editor section + CLAUDE.md ops/UI notes)"

  - touches: ".env.example"
    updates:
      - "CLAUDE.md"
    reason: "Environment variables table"

  - touches: "docker-compose.yml"
    updates:
      - "CLAUDE.md"
      - "docs-site/src/content/docs/contributing/"
    reason: "Stack layout (contributing guide when filled, CLAUDE.md commands section)"
```

- [ ] **Step 2: Créer `.claude/skills/sync-docs/SKILL.md`**

```markdown
---
name: sync-docs
description: Use when finishing a feature or before merging — audit and apply documentation updates that match the diff against doc-impact-map.yaml. Proposes patches for review, never auto-applies.
---

# Sync docs to the diff

Scan the current branch's diff against `main`, match touched source
files against `doc-impact-map.yaml`, and propose concrete documentation
patches for review.

## Process

1. **Get the diff.** Run:
   ```bash
   git diff main...HEAD --name-only
   ```
   If no main branch exists or the user names another base, use that.

2. **Load the map.** Read `.claude/skills/sync-docs/doc-impact-map.yaml`.

3. **Match.** For each mapping, check if any `touches` glob matches any
   changed file (minimatch semantics: `**` = recursive, `*` = single
   segment, exact paths supported).

4. **For every matched mapping**:
   - Read each `updates` path to understand the current state.
   - Read the changed source files to understand what changed.
   - Draft a concrete patch (Edit tool call args) — do not apply yet.

5. **Show the user a checklist** of proposed updates, one bullet per
   doc path, with:
   - The reason (from the YAML).
   - A 1-line summary of the proposed change.
   - "Apply / Skip / Edit-then-apply" choices.

6. **Apply chosen updates** with the Edit tool.

7. **Propose a single commit** separate from the feature commit:
   ```bash
   git add <touched docs>
   git commit -m "docs: sync to <feature-name>"
   ```

8. **Warn on unmapped user-facing changes.** If a changed file matches
   no mapping AND looks user-facing (heuristic: touches editor UI,
   plugin command, config, public endpoint), tell the user — possible
   mapping to add to `doc-impact-map.yaml`.

## Anti-patterns

- **Do not** propose updates for cosmetic changes (rename only,
  whitespace, internal refactor). Check that the user-observable
  behavior or public surface area actually shifted before flagging.
- **Do not** write documentation for things the user can't see.
  Internal invariants → `CLAUDE.md`. User-facing prose →
  `docs-site/`.
- **Do not** generate new sections beyond what the current docs
  contain. This skill maintains existing pages — it doesn't expand
  scope. If a new section is needed, surface the gap and let the
  user decide.

## Output format

Final summary, one block:

```
Proposed doc updates:
[x] docs-site/.../install-admin.md
    Why: Resource pack distribution mode
    Change: update Nexo recipe to mention new delegate-reload-command
[x] CLAUDE.md
    Why: Resource pack distribution mode
    Change: refresh table snippet
[ ] (warning) plugin/src/.../NewThing.kt is user-facing but unmapped.
    Suggest adding to doc-impact-map.yaml.

Commit when applied: docs: sync to <feature-name>
```
```

- [ ] **Step 3: Vérifier la structure**

```bash
ls .claude/skills/sync-docs/
```

Expected: `SKILL.md` et `doc-impact-map.yaml`.

- [ ] **Step 4: Commit**

```bash
git add .claude/skills/sync-docs/SKILL.md .claude/skills/sync-docs/doc-impact-map.yaml
git commit -m "feat(skill): add /sync-docs — audit doc updates from diff via doc-impact-map.yaml"
```

---

## Task 6: Smoke-test du système complet

**Files:** aucun fichier modifié (validation seulement).

- [ ] **Step 1: Build du site complet**

Run dans `docs-site/`:
```bash
npm run build
```

Expected: build success, no warnings about broken links. Sortie dans `dist/`.

- [ ] **Step 2: Dev server end-to-end**

Run dans `docs-site/`:
```bash
npm run dev
```

Naviguer dans le browser à `http://localhost:4321/` et vérifier :
- Landing → bouton "Install on a Paper server" cliquable.
- `/getting-started/install-admin/` → toutes sections présentes, blocs YAML colorés, table commandes rendue.
- `/editor/` → stub.
- `/contributing/` → stub.
- Sidebar contient les 3 groupes.

Arrêter (Ctrl+C).

- [ ] **Step 3: Invocation manuelle du skill `/sync-docs`**

Demander à Claude (toi, en mode exécution) :
> "Invoque le skill /sync-docs sur la branche courante."

Le skill doit :
- Lire `doc-impact-map.yaml`.
- Lister les fichiers changés sur la branche.
- Comme la branche actuelle contient justement les fichiers du système doc, il devrait soit (a) ne rien proposer (les fichiers touchés ne sont pas dans le mapping — c'est le system bootstrap lui-même), soit (b) signaler que `docs-site/` est nouveau.
- Vérifier que le skill ne crash pas, qu'il produit une output lisible.

- [ ] **Step 4: Vérifier le `git status` propre**

```bash
git status
```

Expected: working tree clean (tous les commits faits).

- [ ] **Step 5: Mettre à jour CLAUDE.md tests count si nécessaire**

CLAUDE.md a une section "Tests — ce qui est couvert" avec des counts. Cette task n'ajoute pas de tests automatisés → pas de count à toucher.

Cependant, ajouter une mention courte de docs-site dans la section Architecture de CLAUDE.md si elle ne mentionne pas le nouveau dossier — c'est une dette doc créée par ce plan lui-même.

Localiser la section `## Architecture` dans CLAUDE.md, dans le bloc :

```
editor/          React 19 + Vite + Konva
backend/         Bun + Hono + PostgreSQL (Drizzle)
plugin/          Kotlin 2.0 + Paper 1.21.4 + OkHttp
docker/          Config serveur Minecraft (itzg/minecraft-server, Paper géré par l'image)
docker-compose.yml
docs/
  decisions/             ← ADRs (stack, state model)
  specs/                 ← specs produit et éditeur (web-editor.md, main-spec.md)
  schema/                ← JSON schemas menu/pack/command/translations
  superpowers/specs/     ← design docs data-sources, expression DSL
  superpowers/plans/     ← plans actifs (archive/ = plans complétés)
CONTEXT.md               ← glossaire domaine (source de vérité pour les termes)
```

Insérer une ligne pour `docs-site/` après `docker-compose.yml` :

```
docs-site/       Astro Starlight — public user docs (EN)
```

- [ ] **Step 6: Commit final**

```bash
git add CLAUDE.md
git commit -m "docs(claude-md): mention docs-site/ in architecture section"
```

---

## Task 7: Push & cleanup

**Files:** aucun.

- [ ] **Step 1: Lister les commits ajoutés**

```bash
git log --oneline main..HEAD
```

Expected: 6 commits (scaffold, stubs, install-admin, CLAUDE.md table, sync-docs skill, architecture mention).

- [ ] **Step 2: Lancer le build final pour confirmer no regression**

```bash
cd docs-site && npm run build
```

Expected: success.

- [ ] **Step 3: Vérifier `git status` propre**

```bash
git status
```

Expected: working tree clean.

- [ ] **Step 4: Demander à Iban la suite (push, PR, ou continuer en local)**

L'agent stoppe ici et demande à l'utilisateur :
> "Plan terminé. 6 commits sur main. Tu veux push, créer une PR, ou rester en local pour itérer ?"

---

## Notes pour l'agent qui exécute

- **Pas de TDD strict** sur ce plan : c'est tooling + docs, pas de logique applicative à tester. Les vérifications sont `npm run build` et inspection du dev server.
- **Windows + PowerShell** : Iban est sous Windows. Les commandes `npm`, `git`, `cd` fonctionnent identiquement. Si tu utilises le tool Bash, c'est aussi OK.
- **Pas de URL GitHub** : aucun remote n'est encore configuré sur ce repo. Les références à "GitHub Releases" dans install-admin.md restent du texte sans lien — Iban filera l'URL plus tard quand le repo sera publié.
- **Iban est seul committer** : pas de CI check, pas de hook git. La discipline `/sync-docs` est manuelle, et c'est intentionnel.
