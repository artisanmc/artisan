# AI Models — Plan 4/4 : UI user (sélecteur de modèle + solde de credits dans le panneau assistant)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dans le panneau assistant : un sélecteur de modèle (nom, badge, description, estimation de coût par action) mémorisé et changeable en cours de conversation ; une pastille de solde du network mise à jour après chaque tour ; l'état « plus de credits » (composer désactivé + CTA vers une page placeholder d'achat) sur refus 402.

**Architecture:** Frontend React 19. Consomme `GET /api/v1/ai/models`, `GET /api/v1/ai/balance?projectId`, `PUT /api/v1/ai/preferred-model` (shippés plans 1-2) + l'événement SSE `credits` et le refus 402 déjà émis par le backend. Le `modelId` choisi part avec chaque message. Client dual-auth (bearer `sk:` OU cookie `user:`) comme le reste de l'assistant. Design-system-first, i18n en+fr, mobile-friendly (pas d'affordance hover-only).

**Tech Stack:** React 19, TanStack Router, Zustand, lucide-react, sonner, vitest + @testing-library/react + user-event.

## Global Constraints

- **Emplacements** : `src/lib/api/aiUser.ts` (client) ; panneau assistant sous `src/features/assistant/` ; locales `src/locales/{en,fr}.ts` ; `src/lib/format.ts` (formatteurs — créé au plan 3 Task 1 ; **si ce fichier n'existe pas encore** parce que le plan 3 n'a pas tourné, le créer ici avec `formatCredits`/`formatUsdFromMicro`/`formatTokens` — voir plan 3 Task 1 pour le contenu exact).
- **Auth dual** : réutiliser le pattern `authHeaders(token)` de `src/lib/api/assistant.ts` (bearer si `token`, sinon cookie ; `credentials: "include"` toujours). Le token vient de `useSessionStore(s => s.accessToken)`.
- **`projectId` suffit** pour le solde : `GET /ai/balance?projectId=` résout le network côté serveur. `AssistantChat` reçoit déjà `projectId` en prop — ne PAS threader `networkId`.
- **i18n** : clés dans les deux locales même commit (test `i18nKeys.test.ts`). Jamais de texte en dur dans le JSX.
- **Design-system-first** : primitives `components/ui/*` (DropdownMenu, Badge…) + classes utilitaires (`.chip`, `.badge*`, `.btn*`). Couleurs via `var(--token)`.
- **Mobile** : le sélecteur et la pastille fonctionnent dans le `Sheet` mobile comme dans la pane desktop — pas de `:hover`-only.
- **Tests** : `cd editor && npm test`. Mock du module client pour les composants ; `vi.stubGlobal("fetch")` pour le client. Labels bilingues.
- Commits conventional ; stage explicite ; `npm test` vert avant chaque commit.

## Contrats backend consommés (figés)

```ts
// GET /api/v1/ai/models (dual-auth) → { models: PublicAiModelDto[], defaultModelId: string|null, preferredModelId: string|null }
interface PublicAiModelDto {
  id: string; displayName: string; description: string;
  badge: "cheap" | "balanced" | "premium";
  creditsPerMInput: number; creditsPerMOutput: number;
  estimates: { chatMessage: number; menuMigration: number }; // credits
}
// GET /api/v1/ai/balance?projectId= → { balance: number } | 404 {error:"project_not_found"} | 403 {error:"forbidden"}
// PUT /api/v1/ai/preferred-model body { modelId } → { ok: true } | 403 {error:"user_session_required"} | 400 {error:"invalid_model"}

// POST /conversations/:id/messages :
//   - body accepte modelId?: string
//   - 402 { error: "insufficient_credits", balance } quand solde ≤ 0 (aucun tour)
//   - SSE event final `credits` : { debited: number, balance: number }
```

---

### Task 1: Client user (`src/lib/api/aiUser.ts`)

**Files:**
- Create: `editor/src/lib/api/aiUser.ts`
- Test: `editor/src/lib/api/aiUser.test.ts`
- Create if missing: `editor/src/lib/format.ts` (+ `format.test.ts`) — seulement si le plan 3 n'a pas déjà été exécuté (vérifier `git show HEAD:editor/src/lib/format.ts` ; s'il existe, ne rien faire ici).

**Interfaces:**
- Consumes: `authHeaders` pattern (répliqué), `useSessionStore` token (passé en argument).
- Produces:
  - `PublicAiModelDto`, `ModelsResponse = { models: PublicAiModelDto[]; defaultModelId: string | null; preferredModelId: string | null }`.
  - `getModels(token: string | null): Promise<ModelsResponse | null>`
  - `getBalance(token: string | null, projectId: string): Promise<number | null>` (null si 403/404/erreur)
  - `setPreferredModel(token: string | null, modelId: string): Promise<boolean>` (true si 200 ; false sinon — les sessions `sk:` renvoient 403, non bloquant).

- [ ] **Step 1: Test (stub fetch)**

`editor/src/lib/api/aiUser.test.ts` :

```ts
import { afterEach, describe, expect, it, vi } from "vitest";
import { getBalance, getModels, setPreferredModel } from "./aiUser";

afterEach(() => vi.unstubAllGlobals());
function stub(status: number, body: unknown) {
  const f = vi.fn(async () => new Response(JSON.stringify(body), { status }));
  vi.stubGlobal("fetch", f);
  return f;
}

describe("aiUser client", () => {
  it("getModels returns the payload; sends bearer when token present", async () => {
    const f = stub(200, { models: [{ id: "m1" }], defaultModelId: "m1", preferredModelId: null });
    const r = await getModels("tok123");
    expect(r?.defaultModelId).toBe("m1");
    expect((f.mock.calls[0][1] as RequestInit).headers).toMatchObject({ Authorization: "Bearer tok123" });
  });

  it("getModels uses cookie (no Authorization) when token is null", async () => {
    const f = stub(200, { models: [], defaultModelId: null, preferredModelId: null });
    await getModels(null);
    const init = f.mock.calls[0][1] as RequestInit;
    expect(init.credentials).toBe("include");
    expect((init.headers as Record<string, string>).Authorization).toBeUndefined();
  });

  it("getBalance returns the number", async () => {
    stub(200, { balance: 250 });
    expect(await getBalance("t", "proj1")).toBe(250);
  });

  it("getBalance returns null on 403", async () => {
    stub(403, { error: "forbidden" });
    expect(await getBalance("t", "proj1")).toBeNull();
  });

  it("setPreferredModel true on 200, false on 403", async () => {
    stub(200, { ok: true });
    expect(await setPreferredModel(null, "m1")).toBe(true);
    stub(403, { error: "user_session_required" });
    expect(await setPreferredModel("t", "m1")).toBe(false);
  });
});
```

- [ ] **Step 2: Run — expect FAIL**
Run: `cd editor && npm test -- src/lib/api/aiUser.test.ts` → FAIL.

- [ ] **Step 3: Implement `src/lib/api/aiUser.ts`**

```ts
const apiUrl = (): string =>
  (import.meta.env.VITE_API_URL as string | undefined) ?? "http://localhost:3001";

function authHeaders(token: string | null, json = false): HeadersInit {
  const h: Record<string, string> = {};
  if (token) h.Authorization = `Bearer ${token}`;
  if (json) h["Content-Type"] = "application/json";
  return h;
}

export interface PublicAiModelDto {
  id: string; displayName: string; description: string;
  badge: "cheap" | "balanced" | "premium";
  creditsPerMInput: number; creditsPerMOutput: number;
  estimates: { chatMessage: number; menuMigration: number };
}
export interface ModelsResponse {
  models: PublicAiModelDto[]; defaultModelId: string | null; preferredModelId: string | null;
}

export async function getModels(token: string | null): Promise<ModelsResponse | null> {
  const res = await fetch(`${apiUrl()}/api/v1/ai/models`, {
    credentials: "include", headers: authHeaders(token),
  });
  if (!res.ok) return null;
  return (await res.json()) as ModelsResponse;
}

export async function getBalance(token: string | null, projectId: string): Promise<number | null> {
  const res = await fetch(`${apiUrl()}/api/v1/ai/balance?projectId=${encodeURIComponent(projectId)}`, {
    credentials: "include", headers: authHeaders(token),
  });
  if (!res.ok) return null;
  return ((await res.json()) as { balance: number }).balance;
}

export async function setPreferredModel(token: string | null, modelId: string): Promise<boolean> {
  const res = await fetch(`${apiUrl()}/api/v1/ai/preferred-model`, {
    method: "PUT", credentials: "include", headers: authHeaders(token, true),
    body: JSON.stringify({ modelId }),
  });
  return res.ok;
}
```

- [ ] **Step 4: Run — expect PASS**
Run: `cd editor && npm test -- src/lib/api/aiUser.test.ts` → PASS.

- [ ] **Step 5: Commit**
```bash
git add editor/src/lib/api/aiUser.ts editor/src/lib/api/aiUser.test.ts
git commit -m "feat(editor): user ai client (models, balance, preferred-model)"
```

---

### Task 2: i18n — bloc `assistant.credits` + `assistant.model` (deux locales)

**Files:**
- Modify: `editor/src/locales/en.ts`, `editor/src/locales/fr.ts`

**Interfaces:**
- Produces (sous `assistant`) :
```
assistant.model.label        // "Model" / "Modèle"
assistant.model.pick         // aria-label du dropdown
assistant.model.estChat      // "~{{n}} cr / message" (interp n)
assistant.model.estMigration // "~{{n}} cr / menu migration"
assistant.model.badge.{cheap,balanced,premium}
assistant.balance.label      // "Balance" / "Solde"
assistant.balance.credits    // "{{n}} credits" / "{{n}} crédits"
assistant.outOfCredits.title // "Out of credits" / "Plus de crédits"
assistant.outOfCredits.body  // explication
assistant.outOfCredits.cta   // "Get credits" / "Obtenir des crédits"
assistant.outOfCredits.soon  // "Purchasing coming soon" / "Achat bientôt disponible"
```
Libellés EN + FR concrets pour chaque clé.

- [ ] **Step 1: Ajouter les clés (parité en/fr)**.
- [ ] **Step 2: Run** `cd editor && npm test -- src/lib/i18nKeys.test.ts` → PASS.
- [ ] **Step 3: Commit**
```bash
git add editor/src/locales/en.ts editor/src/locales/fr.ts
git commit -m "i18n(editor): assistant model selector + credits balance keys"
```

---

### Task 3: `credits` SSE event + `modelId` dans le body d'envoi (`assistant.ts` client)

**Files:**
- Modify: `editor/src/lib/api/assistant.ts`
- Test: `editor/src/lib/api/assistant.test.ts` (créer si absent, sinon étendre)

**Interfaces:**
- Modifie le type d'événement SSE de l'assistant pour inclure `{ type: "credits"; debited: number; balance: number }`, et le body de `streamAssistant` pour accepter `modelId?: string`.
- Produces: `AssistantEvent` union gagne le variant `credits` ; `StreamBody` (ou l'inline type) gagne `modelId?`.

- [ ] **Step 1: Test** — vérifier que `parseFrame` (ou l'équivalent) mappe une frame `event: credits\ndata: {"debited":700,"balance":300}` vers `{ type: "credits", debited: 700, balance: 300 }`, et que `streamAssistant(..., { text, modelId })` inclut `modelId` dans le JSON POST. Si le fichier n'a pas de test existant, écrire un test minimal qui appelle `streamAssistant` avec un `fetch` stubbé renvoyant un `ReadableStream` de deux frames (`text` puis `credits`) et collecte les events du générateur.

```ts
// minimal shape — adapt to the actual streamAssistant signature (token, convId, body)
it("yields a credits event and posts modelId", async () => {
  const body = new ReadableStream({
    start(c) {
      c.enqueue(new TextEncoder().encode('event: text\ndata: {"text":"hi"}\n\n'));
      c.enqueue(new TextEncoder().encode('event: credits\ndata: {"debited":700,"balance":300}\n\n'));
      c.close();
    },
  });
  const f = vi.fn(async () => new Response(body, { status: 200 }));
  vi.stubGlobal("fetch", f);
  const events = [];
  for await (const ev of streamAssistant("tok", "conv1", { text: "hi", modelId: "m1" })) events.push(ev);
  expect(events.some((e) => e.type === "credits" && e.balance === 300)).toBe(true);
  expect(JSON.parse((f.mock.calls[0][1] as RequestInit).body as string).modelId).toBe("m1");
});
```

- [ ] **Step 2: Run — expect FAIL** (type `credits` inconnu / modelId non transmis).
- [ ] **Step 3: Implement** — ajouter le variant `credits` à l'union `AssistantEvent` ; s'assurer que `parseFrame` passe déjà les champs data (généralement `{ type: eventName, ...JSON.parse(data) }` — vérifier). Ajouter `modelId?: string` au type du body et le laisser passer dans `JSON.stringify(body)` (probablement déjà spread — vérifier qu'aucun allowlist de champs ne le drop).
- [ ] **Step 4: Run — expect PASS**.
- [ ] **Step 5: Commit**
```bash
git add editor/src/lib/api/assistant.ts editor/src/lib/api/assistant.test.ts
git commit -m "feat(editor): assistant SSE credits event + modelId in send body"
```

---

### Task 4: Sélecteur de modèle + pastille solde dans le composer (`AssistantChat`)

**Files:**
- Create: `editor/src/features/assistant/ModelSelector.tsx`, `editor/src/features/assistant/BalanceChip.tsx`
- Modify: `editor/src/features/assistant/AssistantChat.tsx`
- Test: `editor/src/features/assistant/ModelSelector.test.tsx`, `editor/src/features/assistant/AssistantChat.credits.test.tsx`

**Interfaces:**
- Consumes: `getModels`, `getBalance`, `setPreferredModel` (Task 1), `formatCredits` (format.ts), `DropdownMenu`+`DropdownMenuRadioItem` (ou native select), `Badge`, i18n. Token via `useSessionStore(s => s.accessToken)`.
- Produces:
  - `ModelSelector` : `{ token; value: string | null; onChange: (id: string) => void; className? }`. Charge `getModels(token)` au mount ; affiche un `DropdownMenu` (trigger = nom du modèle courant + badge) listant chaque modèle actif (nom, `Badge` du badge, description, estimation `assistant.model.estChat`/`estMigration` via `formatCredits(estimates.*)`). Sélection → `onChange(id)` + `setPreferredModel(token, id)` (fire-and-forget). Présélection initiale : `preferredModelId ?? defaultModelId` (remonte au parent via un `onChange` initial ou un callback `onModelsLoaded`).
  - `BalanceChip` : `{ balance: number | null }` — `.chip` affichant `assistant.balance.credits` avec `formatCredits`. `null` = masqué (chargement).
  - `AssistantChat` : nouveau state `modelId: string | null` et `balance: number | null`. Au mount : `getBalance(token, projectId)` → `setBalance`. Le composer gagne une rangée (au-dessus du textarea, comme la rangée d'attachments) avec `<ModelSelector>` à gauche + `<BalanceChip>` à droite. Le `modelId` est passé dans le body de `streamAssistant` (Task 3). L'événement `credits` (déjà routé par le if/else grâce à Task 3) → `setBalance(ev.balance)`.

- [ ] **Step 1: Tests**
  - `ModelSelector.test.tsx` : mock `@/lib/api/aiUser`. Assert : liste les modèles + estimations, présélectionne le préféré, un clic appelle `onChange(id)` et `setPreferredModel`.
  - `AssistantChat.credits.test.tsx` : mock `@/lib/api/aiUser` (balance) + `@/lib/api/assistant` (`streamAssistant` renvoyant un générateur qui yield un `credits` event). Assert : la pastille affiche le solde initial ; après un envoi, le solde se met à jour depuis l'event `credits`. (Réutiliser le harness de rendu de tests AssistantChat existants s'il y en a ; sinon rendre `<AssistantChat projectId={"p" as ProjectId} />` avec les stores mockés.)

- [ ] **Step 2: Run — expect FAIL**.
- [ ] **Step 3: Implement** `ModelSelector`, `BalanceChip`, et le câblage dans `AssistantChat` (state + fetch balance au mount + rangée composer + `modelId` dans le body + handler `credits`).
- [ ] **Step 4: Run — expect PASS**
Run: `cd editor && npm test -- src/features/assistant/ModelSelector.test.tsx src/features/assistant/AssistantChat.credits.test.tsx`
Expected: PASS. (Vérifier aussi que les tests AssistantChat existants passent toujours : `npm test -- src/features/assistant`.)

- [ ] **Step 5: Commit**
```bash
git add editor/src/features/assistant/ModelSelector.tsx editor/src/features/assistant/BalanceChip.tsx editor/src/features/assistant/AssistantChat.tsx editor/src/features/assistant/ModelSelector.test.tsx editor/src/features/assistant/AssistantChat.credits.test.tsx
git commit -m "feat(editor): assistant model selector + balance chip in composer"
```

---

### Task 5: État « plus de credits » (402) + page placeholder d'achat

**Files:**
- Modify: `editor/src/features/assistant/AssistantChat.tsx` (gérer le 402)
- Create: `editor/src/features/assistant/OutOfCreditsNotice.tsx`
- Create: `editor/src/routes/credits.tsx` (page placeholder `/credits`)
- Test: `editor/src/features/assistant/AssistantChat.outofcredits.test.tsx`

**Interfaces:**
- Consumes: i18n (`assistant.outOfCredits.*`), `Button`, TanStack `Link`/`useNavigate`.
- Produces:
  - `AssistantChat` : quand l'envoi renvoie **402** (le `streamAssistant` doit exposer ce cas — soit il throw un objet reconnaissable, soit la première frame est une erreur ; vérifier comment le backend renvoie le 402 : c'est une **réponse JSON non-SSE** avec status 402 AVANT le stream). Donc `streamAssistant` doit détecter `res.status === 402` et signaler l'état. **Adapter** : `streamAssistant` — si `res.status === 402`, parser `{ balance }` et yield un event `{ type: "insufficient_credits", balance }` (ajouter ce variant à l'union + son type), puis return. `AssistantChat` route cet event → `setOutOfCredits(true)` + `setBalance(ev.balance)`.
  - Quand `outOfCredits` : le composer est remplacé (ou surmonté) par `<OutOfCreditsNotice/>` — titre + explication + `Button` "Obtenir des crédits" qui navigue vers `/credits`. Le textarea + bouton envoyer sont désactivés.
  - `OutOfCreditsNotice` : présentation pure `{ onGetCredits: () => void }`.
  - `/credits` route : page placeholder centrée — titre `assistant.outOfCredits.cta`, texte `assistant.outOfCredits.soon`, un lien retour. Pas de logique d'achat (hors scope V1).

- [ ] **Step 1: Test** — mock `streamAssistant` pour yield `{ type: "insufficient_credits", balance: 0 }`. Assert : après envoi, `OutOfCreditsNotice` visible, textarea désactivé, clic "Obtenir des crédits" navigue vers `/credits` (mock `useNavigate`). Ajouter un test unitaire du client `assistant.ts` : `res.status === 402` → yield `insufficient_credits` (étendre `assistant.test.ts`).

- [ ] **Step 2: Run — expect FAIL**.
- [ ] **Step 3: Implement** — variant `insufficient_credits` dans `assistant.ts` (détection 402 avant lecture du stream), `OutOfCreditsNotice`, gestion d'état dans `AssistantChat`, route `/credits`.
- [ ] **Step 4: Run — expect PASS + full assistant suite**
Run: `cd editor && npm test -- src/features/assistant src/lib/api/assistant.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**
```bash
git add editor/src/features/assistant/AssistantChat.tsx editor/src/features/assistant/OutOfCreditsNotice.tsx editor/src/routes/credits.tsx editor/src/features/assistant/AssistantChat.outofcredits.test.tsx editor/src/lib/api/assistant.test.ts
git commit -m "feat(editor): out-of-credits state (402) + purchase placeholder route"
```

---

### Task 6: Docs user-facing + build check

**Files:**
- Create: `docs-site/src/content/docs/editor/ai-assistant-credits.md` (ou étendre une page assistant existante si elle existe — vérifier `docs-site/src/content/docs/editor/`)
- Modify: `docs/architecture/editor-internals.md` (section assistant : sélecteur de modèle + solde)
- Modify: `CHANGELOG.md` (`[Unreleased]`)

- [ ] **Step 1: docs-site** — page user expliquant : choisir un modèle (badges cheap/balanced/premium, estimation de coût), le solde de credits, ce qui se passe à zéro (achat bientôt disponible). EN (docs-site est en anglais). Vérifier la frontmatter Starlight des pages voisines et matcher (title, description, sidebar).

- [ ] **Step 2: editor-internals** — courte note dans la section assistant : `ModelSelector`/`BalanceChip`, `modelId` par message, event SSE `credits`, état 402 → `/credits`.

- [ ] **Step 3: CHANGELOG** — `[Unreleased] ### Added` : "Assistant (éditeur) : sélecteur de modèle IA (badge + estimation de coût, choix mémorisé, changeable en cours de conversation), pastille de solde de credits mise à jour après chaque tour, état « plus de credits » (402) avec CTA vers `/credits` (placeholder)."

- [ ] **Step 4: Build check**
Run: `cd editor && npm run build`
Expected: succeeds.

- [ ] **Step 5: Commit**
```bash
git add docs-site/src/content/docs/editor/ai-assistant-credits.md docs/architecture/editor-internals.md CHANGELOG.md
git commit -m "docs: user-facing model selector + credits (docs-site, editor-internals, CHANGELOG)"
```
