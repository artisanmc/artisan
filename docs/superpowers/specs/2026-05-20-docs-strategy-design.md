# Docs Strategy — Design

**Date** : 2026-05-20
**Status** : Approuvé, prêt pour plan d'implémentation
**Auteur** : Iban + Claude (brainstorming)

## Contexte

Le projet n'a aujourd'hui aucune documentation utilisateur publique. Côté
AI, la fondation existe (`CLAUDE.md`, `CONTEXT.md`, `docs/decisions/`,
`docs/specs/`, `docs/superpowers/specs/+plans/`, `docs/schema/`) et
fonctionne — Claude est productif. Le besoin :

1. Démarrer une doc utilisateur publique, en anglais.
2. Garantir que doc utilisateur et doc AI restent à jour quand Claude
   exécute des tâches sur le code.

Audiences cibles, par priorité :
1. **Admins serveur** — installation, config, troubleshooting.
2. **Créateurs de menus** — usage de l'éditeur web (couvert plus tard).
3. **Contributeurs/forkers** — archi, comment développer (couvert plus tard).

Audience explicitement exclue : devs qui self-hostent leur propre backend.

## Décisions clés

| Sujet | Décision |
|---|---|
| Outil site doc | Astro Starlight |
| Langue | Anglais uniquement (FR ouvert plus tard via Starlight i18n) |
| Localisation site | `/docs-site/` à la racine du repo |
| Maintenance | Combo règles CLAUDE.md + skill local `/sync-docs` |
| Scope MVP | 1 quickstart admin riche + stubs `editor/` et `contributing/` + skill `/sync-docs` |
| Hébergement | Non décidé (portable Astro, décidable au moment du deploy) |

## Architecture — Layout du repo

```
Artisan/
├── CLAUDE.md                      étendu — règles maintenance doc
├── CONTEXT.md                     inchangé
├── docs/                          inchangé — archive AI/design
│   ├── decisions/
│   ├── specs/
│   ├── schema/
│   └── superpowers/specs/+plans/
├── docs-site/                     NOUVEAU — Astro Starlight, EN
│   ├── astro.config.mjs
│   ├── package.json
│   ├── src/
│   │   ├── content/
│   │   │   └── docs/
│   │   │       ├── index.md
│   │   │       ├── getting-started/
│   │   │       │   └── install-admin.md
│   │   │       ├── editor/
│   │   │       │   └── index.md           stub
│   │   │       └── contributing/
│   │   │           └── index.md           stub
│   │   └── assets/
│   └── public/
└── .claude/
    └── skills/
        └── sync-docs/
            ├── SKILL.md
            └── doc-impact-map.yaml
```

Justifications :

- **`docs-site/` à la racine** : sous-projet Node distinct, mérite sa
  racine au même titre que `editor/` et `backend/`. Pas dans `docs/`
  parce que `docs/` est le territoire des artefacts AI/design (specs,
  plans, ADRs, schemas) — séparer les deux territoires garde les rôles
  clairs.
- **`docs/` existant inchangé** : c'est ce qui marche aujourd'hui, ne
  pas y toucher.
- **Stubs visibles** pour `editor/` et `contributing/` : signalent aux
  visiteurs que c'est en chantier, et créent une pression sur toi pour
  les remplir.

## Contenu MVP — `install-admin.md`

Une seule page riche. Sections :

1. **Prerequisites** — Paper 1.21.4+, Java 21, compte Artisan
   (self-hosting backend hors scope MVP, ouvre la voie via Contributing
   plus tard).
2. **Download** — lien GitHub Releases, drop jar, restart pour générer
   `config.yml`.
3. **Link your server** — récupérer server_key depuis dashboard,
   coller dans `config.yml`, `/artisan reload`.
4. **Open the editor** — `/artisan editor`, click trust link.
5. **Create your first menu** — un paragraphe, lien vers `/editor`
   (stub) ou GIF court.
6. **Troubleshooting** — 3-5 problèmes courants : backend unreachable,
   invalid server_key, resource pack not loading.
7. **Resource pack distribution (advanced)** — decision tree 3 modes
   (default / Nexo zip / dir mode), chacun avec 4 lignes de config
   snippet.
8. **Reference: config.yml** — config annotée (manuel pour MVP, possible
   automatisation step 2).

Hors v1 : section commandes exhaustive, permissions Bukkit, FAQ étendue.
Ces sections naissent quand des questions réelles arrivent.

Format : Markdown vanilla, screenshots dans `docs-site/src/assets/install/`.

## CLAUDE.md — Changements

Une seule modification : étendre le tableau "Règles de mise à jour des
docs" avec 4 lignes pour `docs-site/`, et ajouter une règle de
comportement explicite juste après.

### Lignes ajoutées au tableau

| Tu touches | Tu mets à jour |
|---|---|
| Config plugin (`config.yml`, defaults) | `docs-site/getting-started/install-admin.md` (sections Config / Reference) |
| Commande user-visible (`/artisan editor`, `/artisan reload`) | `docs-site/getting-started/install-admin.md` |
| Resource pack distribution modes | `docs-site/getting-started/install-admin.md` (section Resource pack) |
| UI éditeur (nouveau bouton/flow visible user) | `docs-site/editor/<feature>.md` (créer si nécessaire) |

### Règle de comportement (ajoutée juste après le tableau)

> Quand un commit touche du code marqué dans le tableau, la doc
> correspondante doit être mise à jour dans le même commit si l'update
> reste petit (changement ciblé d'une ou deux sections existantes,
> typiquement ≤30 lignes diff de doc). Si l'update doc dépasse ce
> volume ou nécessite des screenshots/refonte, invoquer le skill
> `/sync-docs` à la fin de la feature pour traiter la dette doc en un
> commit séparé. Ne jamais merger une PR avec dette doc non-listée.

### Non-changements

- CLAUDE.md reste monolithique (pas de split en sous-fichiers).
- CONTEXT.md inchangé.
- `docs/specs/`, `docs/decisions/`, `docs/superpowers/` inchangés.

## Skill `/sync-docs`

Localisation : `.claude/skills/sync-docs/`.

### `doc-impact-map.yaml`

Source de vérité unique du mapping `pattern → docs à vérifier`. La
table de CLAUDE.md devient un résumé humain de ce YAML.

**Syntaxe des patterns** : globs style minimatch (`**` = wildcard
récursif, `*` = wildcard simple, chemins exacts autorisés). Le skill
match chaque `touches` contre chaque fichier changé via cette syntaxe.

```yaml
mappings:
  - touches: "plugin/src/main/resources/config.yml"
    updates:
      - "docs-site/src/content/docs/getting-started/install-admin.md"
    reason: "User-visible plugin config"

  - touches: "plugin/src/main/kotlin/**/ArtisanCommand.kt"
    updates:
      - "docs-site/src/content/docs/getting-started/install-admin.md"
      - "CLAUDE.md"
    reason: "User-visible commands"

  - touches: "plugin/src/main/kotlin/**/ResourcePackDelegator.kt"
    updates:
      - "docs-site/src/content/docs/getting-started/install-admin.md"
      - "CLAUDE.md"
    reason: "RP distribution mode"

  - touches: "backend/src/lib/hub.ts"
    updates:
      - "CLAUDE.md"
    reason: "WS protocol (AI-facing only)"

  - touches: "editor/src/features/canvas/**"
    updates:
      - "docs-site/src/content/docs/editor/"
      - "CLAUDE.md"
    reason: "User-visible editor UX"
```

Mappings additionnelles à ajouter au fil des features. Quand on ajoute
une mapping, on update le YAML et la table CLAUDE.md dans le même commit.

### `SKILL.md` — Process

1. `git diff main...HEAD --name-only` pour les fichiers changés.
2. Lire `doc-impact-map.yaml`.
3. Pour chaque mapping où un `touches` match :
   - Lister les `updates` paths et le `reason`.
   - Lire chaque `updates` path pour comprendre l'état actuel.
   - Lire les fichiers source changés pour comprendre ce qui a changé.
   - Proposer un patch concret (Edit) par doc — jamais auto-appliqué.
4. Présenter un checklist au user. User choisit skip / edit / apply pour
   chaque update.
5. Après application, proposer un commit séparé `docs: sync to <feature>`.
6. Si un fichier changé matche AUCUNE mapping ET ressemble à du
   user-facing (touche UI éditeur, commande plugin, config, endpoint
   public), warn l'user — possible mapping à ajouter.

### Anti-patterns du skill

- Ne pas update une doc juste parce qu'un fichier a changé cosmétiquement
  (rename, whitespace, refacto interne). Vérifier que le comportement
  observable ou la surface API a bougé.
- Ne pas écrire de doc pour ce que l'user ne peut pas voir (invariants
  internes → CLAUDE.md, pas docs-site).
- Ne pas générer de sections neuves exhaustives. Le skill maintient
  l'existant, n'étend pas le scope.

### Invocation

- Manuelle : tu tapes `/sync-docs` en fin de feature.
- Auto-suggestion : Claude le mentionne dans son end-of-turn quand il
  sent une dette doc.
- Hors boucle critique — pas un hook bloquant.

## Process quotidien

1. Tu donnes une tâche à Claude (feature, fix, refacto).
2. Claude lit CLAUDE.md → voit la table → met à jour les docs concernées
   **dans le même commit** quand l'update est trivial (1-2 lignes).
3. En fin de feature, tu tapes `/sync-docs` → balayage diff complet →
   patches proposés → tu valides → commit séparé `docs: sync …`.
4. PR mergeable sans dette doc.

## Garde-fous

- **CLAUDE.md** : règle "ne jamais merger avec dette doc non-listée".
- **Skill warning** : signale les fichiers user-facing non mappés.
- **Self-audit ad-hoc** : tous les ~10 features, `/sync-docs` avec
  `git diff <ancien-tag>..HEAD` pour rattraper.

## Ce qu'on NE fait PAS

- **Pas de hook git** — trop bloquant pour le rythme solo actuel.
- **Pas de CI check** — discipline interne suffit tant qu'Iban est seul
  committer. À ajouter si contributeurs externes.
- **Pas de versioning de la doc** — une seule version "latest" en MVP.
- **Pas d'i18n** — English only, FR ouvert plus tard via Starlight i18n.

## Validation après livraison

- **Doc** : `cd docs-site && npm run dev`, suivre `install-admin.md`
  sur un Paper neuf, ça doit marcher sans deviner.
- **Skill** : après prochaine feature, `/sync-docs` doit lister des
  updates pertinents (pas de bruit sur refactors internes), au moins
  une mapping fire si la feature touche du user-facing. Si manque
  évident, ajouter la mapping manquante.
- **CLAUDE.md** : prochaine session, Claude mentionne spontanément la
  doc en présentant son plan ("je vais aussi mettre à jour
  install-admin.md").

## Out of scope explicite

- Choix de l'hébergeur (Vercel / GitHub Pages / Cloudflare).
- Branding / theme Starlight custom.
- Génération automatique de `Reference: config.yml` depuis source.
- Contenu des sections `editor/` et `contributing/` au-delà des stubs.
- Doc FR.

## Next steps

Plan d'implémentation à écrire via skill `writing-plans`. Étapes
attendues :
1. Bootstrap `docs-site/` (Astro Starlight init, config, structure).
2. Écrire `install-admin.md` complet.
3. Écrire stubs `editor/index.md` et `contributing/index.md`.
4. Étendre `CLAUDE.md` (tableau + règle de comportement).
5. Créer `.claude/skills/sync-docs/` (SKILL.md + doc-impact-map.yaml
   initial).
6. Premier test du skill sur la branche courante pour valider.
