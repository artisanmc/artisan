# Assistant IA — génération de menus en langage naturel + migration zmenu/DeluxeMenus

**Statut :** design approuvé — **DÉPARQUÉ** (P1 canonicalisation `menu/v1` terminée : P1.0 schéma + P1.1 éditeur + P1.2 plugin, mergées). Le contrat émis par l'IA = `menu/v1` **canonique** ; le gate = `ajv(menu/v1/schema.json)` (cf. `editor/src/schema/validateMenuV1.ts`) + checks cross-field. Sous-plans séquentiels : **(1) convertisseur `menu/v1 → domain`** — réduit par la P1 au pont i18n + un-snake + `size`/`rows` + `pagination_*`→`paginate` (plan `2026-06-08-ai-converter-menuv1-to-domain.md`) ; (2) moteur backend ; (3) crédits ; (4) panel éditeur. **Le sous-plan (3) crédits est réalisé — étendu en système de modèles complet — par `2026-07-02-ai-model-system-design.md` (plans `2026-07-02-ai-models-1..4`).**
**Auteur :** brainstorm 2026-06-08
**Code lié (à créer) :** `backend/src/modules/assistant/`, `editor/src/modules/assistant/`
**Code lié (réutilisé) :** `docs/schema/menu/v1/{schema.json,types.ts}` (validation), pipeline export domain→menu/v1 de l'éditeur, modèle commits (`pack_commits`, onglet History/Restore), `editor/src/state/accountStore.ts`.

## Contexte

Aujourd'hui un admin construit ses menus à la main dans l'éditeur web. Deux frictions :

1. **Onboarding** — les admins arrivent avec des configs existantes (zmenu, DeluxeMenus). Les retaper à la main est un mur d'entrée.
2. **Vélocité** — décrire un menu en langage naturel et le voir apparaître est plus rapide qu'un placement manuel pour les cas courants.

Ce spec couvre une **feature produit long-terme** : un assistant IA persistant dans la plateforme avec **deux portes d'entrée sur un moteur commun** — (1) décrire un menu en langage naturel, (2) drop un fichier zmenu/DeluxeMenus à convertir. Driver immédiat : migrer les menus zmenu de prod de l'auteur pour valider la stack de bout en bout.

## Décisions du brainstorm

| Question | Choix |
|---|---|
| Intention | Feature produit long-terme (pas un outil de migration jetable) |
| Scope des portes d'entrée v1 | **Les deux** (NL + migration) sur un moteur commun |
| Forme d'interaction | **Chat multi-tours, édition incluse** (l'IA crée ET modifie des menus existants) |
| Coût / clé | **Toi tu fournis la clé** (provider pas forcément Anthropic) ; les users dépensent des **crédits** |
| Scope facturation v1 | **Consommation seule** (ledger + métering + débit + blocage à zéro, octroi manuel pour tester). Acquisition (Stripe/abonnements) = projet séparé. |
| Moteur | **A — Agent à tool-use hébergé par nous** (Claude API + tool use, boucle manuelle). Pas Managed Agents. |

## Goals

- Une surface chat unique où l'utilisateur **écrit en langage naturel OU drop des fichiers** zmenu/DeluxeMenus.
- L'IA **crée et modifie** des menus du pack courant de façon **fiable** : tout menu produit est structurellement valide (jamais de menu cassé silencieux).
- **Réversible** : l'édition en place n'est pas effrayante (checkpoint commit + undo).
- **Provider-agnostique** : aucune dépendance hard à Anthropic dans l'architecture.
- **Métré** : chaque opération consomme des crédits ; blocage propre à zéro.

## Non-goals (v1)

- Génération de **commands / dialogs / translations** (les sources de migration sont des plugins de menus → cut sur les menus ; extension ultérieure).
- **Acquisition de crédits** (paiement Stripe, abonnements, achat) — projet séparé. V1 = octroi manuel/admin.
- Persistance durable du **transcript** de chat à travers les reloads / redémarrages backend (l'état conversation est en mémoire serveur, re-seedable — cf. §4).
- Création automatique de la **commande d'ouverture** d'un menu migré (`open_command` zmenu / DeluxeMenus) — notée dans les `notes` du menu, création différée.
- Multi-pack / multi-network dans une même conversation (une conversation = un (network, pack)).
- Édition concurrente fine (modèle **last-writer** simple ; cf. §4).

## Architecture

Nouveau module **`assistant`** suivant le pattern modular monolith (`docs/architecture/modules.md`), **2 layers** (pas de layer plugin — c'est éditeur ↔ backend) :

- **Backend** `backend/src/modules/assistant/` — exporte un `BackendModule`, register dans `app.ts` (`mountModules`). Contient : endpoints, moteur (boucle agentique), tools, grounding, `LLMProvider`, métering.
- **Éditeur** `editor/src/modules/assistant/` — exporte un `FrontendModule`, `registerModule(...)` dans `main.tsx`. Contient : panel chat, file-drop, client SSE, convertisseur `menu/v1 → domain`, application des writes.

```
[Panel chat éditeur]                                              [Module assistant backend]
   │ 1. open conversation (seed working-copy = pack en menu/v1)        │
   │    POST /api/v1/assistant/conversations                           │
   │ 2. POST .../conversations/:id/messages  (SSE)  ───────────────▶   ├─ LLMProvider (Claude défaut, swappable)
   │       { text, attachmentIds[] }                                   ├─ boucle agentique manuelle (@anthropic-ai/sdk)
   ◀── SSE: text_delta · tool_use · menu_written(menu/v1) ·            ├─ tools sur la working-copy (menu/v1 only)
   │        menu_deleted · credits · error · done                      ├─ gate: ajv(schema.json) + validateMenuLayout
   │ 3. importe menu/v1 → domain, applique à accountStore (undo)       ├─ débit ledger crédits
   │ 4. checkpoint commit avant 1er write (réversibilité)              └─ grounding (préfixe système caché)
```

### Décision structurante : le backend reste en `menu/v1`

Le backend **ne connaît jamais le domain model de l'éditeur**. Toute la conversion vit côté client :

- **domain → menu/v1** (seed de la working-copy) : *existe déjà* (pipeline export de l'éditeur). Réutilisé tel quel.
- **menu/v1 → domain** (application des writes) : **construit** (sous-plan (1), 2026-06-09) — `editor/src/schema/menuV1ToDomain.ts` (placé dans `schema/` à côté de `validateMenuV1.ts` car réutilisable hors IA ; le futur module assistant l'importe depuis là). Fonction pure `menuV1ToDomain(src, opts) → { menu, i18nKeys, unsupported }` — aucune mutation de pack, retourne les clés i18n allouées. Couverture : tests unitaires (`menuV1ToDomain.test.ts`) + oracle round-trip domain↔menu/v1 (`menuV1ToDomain.roundtrip.test.ts`). C'est le plus gros morceau de code déterministe du projet, et il est réutilisable (import de fichiers `menu/v1` en général). Il fait :
  - **pont i18n** : un champ texte `menu/v1` est un `string` qui est soit un littéral, soit une réf inline `{i18n:KEY}`. Cas littéral → **allouer une clé**, ranger le littéral sous la langue active dans `pack.i18nKeys`, produire un `LText { key }`. Cas `{i18n:KEY}` → `LText { key: KEY }` + importer les valeurs depuis le `translations/v1` accompagnant dans `pack.i18nKeys`. (Côté domain le texte est **toujours** un `LText`, jamais un littéral inline.)
  - **structure** : monte les step-trees depuis les `actions[]` plats, construit `MenuTitleLayer[]` depuis le `title`, convertit `size` → `rows`.
- **Côté IA** : elle émet du **texte littéral lisible** (MiniMessage + placeholders PAPI préservés) ; c'est le convertisseur qui gère le keying i18n. L'IA ne manipule jamais de clés.
- **Validation** côté backend : `ajv` contre `docs/schema/menu/v1/schema.json` + `validateMenuLayout` (importé de `docs/schema/menu/v1/types.ts`, TS framework-agnostic). **Exactement le même validateur que l'éditeur** → cohérence garantie.

Conséquence : la working-copy serveur est un objet `menu/v1`, les tools lisent/écrivent du `menu/v1`, la validation tourne sur du `menu/v1`. Aucun convertisseur côté serveur.

## Moteur (boucle agentique)

### `LLMProvider` (abstraction provider)

Interface neutre, dans `backend/src/modules/assistant/provider/`:

```ts
interface LlmUsage { inputTokens: number; outputTokens: number; cachedInputTokens?: number; }
type LlmStreamEvent =
  | { type: "text"; text: string }
  | { type: "tool_use"; id: string; name: string; input: unknown }
  | { type: "usage"; usage: LlmUsage }
  | { type: "done"; stopReason: string };

type LlmMessage =
  | { role: "system"; content: string }
  | { role: "user"; content: string }
  | { role: "assistant"; content: string | null; toolCalls?: { id: string; name: string; arguments: string }[] }
  | { role: "tool"; toolCallId: string; content: string };
interface ToolDef { name: string; description: string; parameters: object; } // JSON Schema des params

interface LlmProvider {
  /** Un tour : messages (le system est le 1er message) + tools → flux d'events. Le caller exécute les tools et renvoie les tool results (role "tool") au tour suivant. */
  streamTurn(args: { messages: LlmMessage[]; tools: ToolDef[]; model: string }): AsyncIterable<LlmStreamEvent>;
}
```

- Impl **unique `OpenAICompatibleProvider`** (SDK `openai`) — **décision 2026-06-09 : provider-agnostique via le protocole OpenAI-compatible, pas Anthropic-only.**
  - Configurée par **`baseURL` + `model` + `apiKey`** → couvre **OpenAI, DeepSeek, Mistral, OpenRouter, Ollama local…**. Preset sélectionné par env (`ASSISTANT_PROVIDER`) ou override explicite (`ASSISTANT_BASE_URL`/`ASSISTANT_MODEL`/`ASSISTANT_API_KEY`). **Changer de provider = changer la conf, pas le code.**
  - Tool calling via le function-calling OpenAI (`tools`/`tool_calls`) ; streaming `stream:true` avec accumulation des deltas `tool_calls` (`id`/`name`/`arguments`) → normalisé en `LlmStreamEvent`.
  - Prompt caching : **transparent côté provider** (OpenAI auto-cache, DeepSeek context cache) — aucune config client ; `cachedInputTokens` remonté dans l'usage si le provider le fournit.
  - Anthropic/Claude **non inclus** comme adaptateur natif en v1 — joignable via son endpoint OpenAI-compat ou OpenRouter si besoin. (Le skill `claude-api` ne s'applique donc pas à ce moteur.)
- L'interface reste neutre : un éventuel adaptateur natif (Anthropic, Google…) s'insère plus tard sans toucher la boucle/tools/grounding.

### Tools (exécutés serveur, sur la working-copy `menu/v1`)

| Tool | Effet |
|---|---|
| `list_menus()` | `[{ id, title, size, summary }]` — vue compacte (l'IA fetch le détail à la demande, garde le contexte léger). |
| `get_menu(id)` | renvoie le `menu/v1` complet du menu. |
| `upsert_menu(menu)` | **le gate** — valide ; OK → écrit dans la working-copy + émet SSE `menu_written` ; ERREUR → `tool_result` `is_error` avec la liste d'erreurs → l'IA s'auto-corrige. |
| `delete_menu(id)` | supprime de la working-copy + émet SSE `menu_deleted` (édition incluse). |
| `read_attachment(file_id)` | renvoie le texte brut d'un fichier zmenu/DeluxeMenus dropé. |

`upsert_menu` valide : `ajv(schema.json)` (structure) **puis** `validateMenuLayout` (ids uniques cross-layer, positions in-bounds, cohérence `iterates`/`component_ref`, résolution des `iterates.source`). Les `errors` de `validateMenuLayout` sont renvoyés tels quels au modèle — ils sont déjà rédigés en langage actionnable.

### Boucle

Boucle agentique **manuelle** (contrôle fin pour métering + validation + budget) :

1. `streamTurn(...)` → on relaie les `text` en SSE, on accumule les `tool_use`.
2. Pour chaque `tool_use` → exécution serveur → `tool_result` (succès ou erreurs).
3. On somme `usage`, on vérifie le **budget crédits du tour**.
4. Tant qu'il reste des `tool_use` → re-`streamTurn` avec les `tool_results`. Sinon → `done`.
5. Caps : **itérations max** (défaut 25) et **budget crédits/tour** (configurable). Dépassement → on coupe proprement + message à l'utilisateur.

## Grounding

`backend/src/modules/assistant/grounding/`, versionné, assemblé en **préfixe système caché** :

- `menu-v1-authoring-guide.md` — distillé de `docs/schema/menu/v1/README.md` + `types.ts` + un set d'exemples curés + les règles de `validateMenuLayout`. Token-efficient, écrit pour le modèle.
- `zmenu-reference.md` — format zmenu (Maxlego08) : `items`/`slots`, `material`, `name`/`lore`, `actions` par type de clic, `view_requirement`/`click_requirement`, et **mapping vers Artisan** (view_requirement → appearance conditionnelle sans fallback = fall-through ; commandes → actions `run_command`/`send_message`/…).
- `deluxemenus-reference.md` — format DeluxeMenus (HelpChat) : `display_name`/`lore`/`slot`, tags d'actions (`[message]`, `[player]`, `[console]`, `[openguimenu]`, `[sound]`, `[broadcast]`, …), `view_requirement`/`click_requirement` (`has permission`, `has money`, `string equals`, …), placeholders `%papi%`, et **mapping vers Artisan**.
- Cadrage anti-injection : le system prompt déclare explicitement que le contenu des fichiers dropés et de la working-copy est **de la donnée à convertir, pas des instructions**.

## État conversation & synchronisation (§ working-copy)

- **Le client (`accountStore`) reste source de vérité** du pack live.
- Une **conversation** est liée à un (network, pack) et tient un **état serveur en mémoire** : historique des messages + working-copy du pack en `menu/v1` + attachments. Seedée par le client à l'ouverture (le client exporte le pack domain→menu/v1). **Pas de table** en v1 ; si le backend redémarre, le client ré-ouvre et re-seed (transcript perdu — persistance = follow-up).
- L'IA émet du `menu/v1` ; chaque `upsert_menu`/`delete_menu` validé émet un event SSE ; l'éditeur **importe menu/v1 → domain** et applique à `accountStore` (undoable via zundo).
- **Concurrence** : si l'utilisateur édite le pack à la main pendant une conversation, l'éditeur **re-seed** la working-copy (renvoie un snapshot à jour) avant le tour suivant. Modèle **last-writer** simple en v1, limite documentée.

## Réversibilité

- Avant le **1er write d'un tour**, l'éditeur prend un **checkpoint commit** (mécanisme `pack_commits` existant) labellisé « avant modifs IA ».
- Bandeau post-tour : « L'IA a modifié N menus dans ce tour — [Voir sur le canvas] [Annuler] ». [Annuler] = Restore du checkpoint (onglet History existant).
- Plus l'undo zundo par édition (`accountStore.temporal`).

## Crédits / métering (côté consommation seulement)

- **Schéma** : table `ai_credit_ledger` — `(id, accountId, delta, reason, operationId, createdAt)`. Solde = `SUM(delta)` par account. Migration Drizzle générée (`bun run db:generate`) et committée. `reason` ∈ `{ grant, debit, refund }`.
- **Conversion tokens → crédits** : formule paramétrable par env —
  `crédits = ceil((in·wIn + out·wOut + cacheRead·wCacheRead + cacheWrite·wCacheWrite) / DIVISOR)`
  où les poids reflètent le coût provider × marge. Tous configurables, **calibrés à l'implémentation** contre le pricing réel du provider (cf. table modèles : `claude-opus-4-8` $5/$25 par 1M in/out, cache read ~0.1×, cache write ~1.25×).
- **Débit** : à la fin de chaque tour, somme `usage` de tous les appels modèle → 1 entrée `debit`. **Pré-check du solde** avant un tour ; **cap de budget par tour**. Solde ≤ 0 → refus du tour (message clair).
- **Pas de débit** si le provider n'a rien renvoyé (échec terminal) — on ne facture que les tokens réellement consommés/retournés.
- **Octroi** : endpoint admin `POST /api/v1/assistant/admin/credits { accountId, amount, reason }` (auth admin) + script CLI pour tester. C'est l'unique point d'entrée que le futur projet Stripe réutilisera (insère des entrées `grant`).

## API REST (sous `/api/v1/assistant/`)

| Méthode | Route | Rôle |
|---|---|---|
| `POST` | `/api/v1/assistant/conversations` | Ouvre une conversation (auth editor-session) ; body = pack snapshot en `menu/v1` ; renvoie `conversationId`. |
| `POST` | `/api/v1/assistant/conversations/:id/attachments` | Upload d'un fichier zmenu/DeluxeMenus dropé ; renvoie `fileId`. |
| `POST` | `/api/v1/assistant/conversations/:id/messages` | Envoie un message `{ text, attachmentIds[], packSnapshot? }` ; **réponse SSE** (cf. events). `packSnapshot` optionnel = re-seed concurrence. |
| `GET` | `/api/v1/assistant/credits` | Solde de l'account courant. |
| `POST` | `/api/v1/assistant/admin/credits` | Octroi (admin). |

**Events SSE** : `text_delta` · `tool_use` (menu en cours d'écriture, pour feedback) · `menu_written` (`menu/v1` payload) · `menu_deleted` (`{id}`) · `credits` (`{ debited, balance }`) · `error` (`{ message }`) · `done`.

Toutes les routes (sauf admin) sont sous l'auth editor-session existante ; les crédits sont liés à l'account authentifié.

## UX éditeur

- **Panel assistant** : drawer droit ≥lg ; sheet plein écran <lg (mobile-first — pas d'affordance hover-only, cf. préférence projet). Transcript + composer avec **drag-drop** de fichiers zmenu/DeluxeMenus (dropzone sur le composer). Tokens en streaming.
- Quand l'IA écrit/supprime un menu → carte dans le transcript « Créé / Modifié / Supprimé : *menu X* » linkant vers le menu sur le canvas ; **le canvas se met à jour live** (via l'import → accountStore).
- **Solde crédits** visible dans le panel ; état « plus de crédits » (CTA top-up = placeholder pour le projet Stripe futur).
- **Entrée** : item sidebar du `FrontendModule` `assistant` + bouton « ✨ » dans `WorkspaceTopBarControls`.
- **Strings i18n** : toutes via react-i18next (clés ajoutées dans `en.ts` + `fr.ts` dans le même commit — pas de hardcode FR/EN).

## Sécurité

- Clé provider **serveur only** (env), jamais exposée au client.
- Endpoints sous l'auth editor-session ; crédits liés à l'account.
- Fichiers dropés & working-copy **traités comme data, pas instructions** (cadrage system prompt anti-injection).
- **Rate-limit** par account en plus des crédits (anti-abus).

## Gestion d'erreurs

| Cas | Comportement |
|---|---|
| Provider 429/5xx | Retries SDK ; échec terminal → SSE `error` « réessaie » ; **pas de débit**. |
| Validation jamais OK après N itérations | Résultat partiel + explication ; **jamais de menu invalide écrit**. |
| Solde ≤ 0 (pré-check ou cap atteint) | Refus / coupure propre + message clair. |
| Fichier dropé non-parsable | L'IA le signale dans le chat (donnée illisible), pas de crash. |
| Pack édité à la main pendant la conversation | Re-seed au tour suivant (last-writer). |

## Variables d'environnement (backend)

| Variable | Défaut | Usage |
|---|---|---|
| `ASSISTANT_PROVIDER` | `openai` | Preset OpenAI-compatible : `openai` / `deepseek` / `mistral` / `openrouter` / `local` (résout `baseURL`). Vide/override possible via `ASSISTANT_BASE_URL`. |
| `ASSISTANT_BASE_URL` | (selon preset) | Override explicite de l'URL OpenAI-compatible (ex: `http://localhost:11434/v1`). |
| `ASSISTANT_API_KEY` | (vide) | Clé du provider. Vide → feature désactivée. |
| `ASSISTANT_MODEL` | (selon preset) | Modèle (ex: `gpt-4.1-mini`, `deepseek-chat`, `mistral-large-latest`). |
| `ASSISTANT_CREDIT_DIVISOR` + `ASSISTANT_CREDIT_W_*` | calibrés à l'impl | Poids/diviseur de conversion tokens→crédits (selon pricing provider). |
| `ASSISTANT_MAX_ITERATIONS` | `25` | Cap d'itérations par tour. |
| `ASSISTANT_TURN_BUDGET` | calibré à l'impl | Cap de crédits par tour (selon coût moyen d'une migration menu). |

## Scope v1

- **Entités générées : menus uniquement** (+ i18n / actions / conditions qu'ils contiennent). Commands / dialogs / translations = extension ultérieure (même moteur, grounding + importer étendus).
- L'`open_command` zmenu/DeluxeMenus → noté dans `menu.notes` ; création de la commande Artisan différée.

## Tests (TDD)

| Couche | Couverture |
|---|---|
| Backend — provider | `LlmProvider` mocké (provider scripté). |
| Backend — tools | `upsert_menu` accepte un `menu/v1` valide / rejette un invalide avec erreurs réinjectées ; `get_menu`/`list_menus`/`delete_menu`. |
| Backend — boucle | provider scripté → converge ; **auto-correction** sur menu invalide (1 rejet → 2e essai OK). |
| Backend — métering | math tokens→crédits ; débit ; pré-check + cap ; blocage à zéro ; pas de débit sur échec. |
| Backend — grounding | les fichiers de grounding chargent et s'assemblent. |
| Éditeur — convertisseur | **menu/v1 → domain** : round-trip avec l'export domain→menu/v1 existant ; alloc i18nKeys ; step-trees ; `MenuTitleLayer[]`. |
| Éditeur — panel | rendu SSE ; drag-drop ; application des `menu_written`/`menu_deleted` à accountStore ; checkpoint + undo ; état « plus de crédits ». |
| Fidélité migration | **corpus** d'échantillons zmenu + DeluxeMenus → menus valides + assertions de mapping (material/slot/name/lore ; clics → actions ; view_requirement → appearance conditionnelle ; placeholders préservés). |

## Docs à mettre à jour (mapping `CLAUDE.md` / `doc-impact-map.yaml`)

- `docs/architecture/modules.md` — section « Module assistant ».
- `docs/architecture/rest-endpoints.md` — routes `/api/v1/assistant/*`.
- `docs/architecture/entities.md` — table `ai_credit_ledger` + migration.
- `docs/architecture/editor-internals.md` — panel assistant + convertisseur menu/v1→domain.
- `CHANGELOG.md` `[Unreleased]`.
- `.env.example` + `CLAUDE.md` (vars `ASSISTANT_*`).
- `docs-site/src/content/docs/editor/assistant.md` (user docs, créer).

## Découpage en sous-projets (suite)

1. **Ce spec** — assistant IA, côté consommation des crédits, menus only.
2. **Facturation acquisition** (séparé) — Stripe, plans d'abonnement, achat de crédits → insère des entrées `grant` dans `ai_credit_ledger`.
3. **Extension entités** (séparé) — génération commands / dialogs / translations.
4. **Persistance transcript** (séparé) — historique de chat durable + reprise.

## Limites connues (assumées en v1)

- Concurrence édition manuelle ↔ IA = last-writer (re-seed).
- Transcript non durable (mémoire serveur).
- Fidélité de migration best-effort : ce qui ne mappe pas proprement est signalé dans le chat, pas inventé.
