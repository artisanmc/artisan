# Feature IA — sous-plan 4b : UI du panel assistant (éditeur)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps en checkbox (`- [ ]`).

**Goal:** Le panel chat utilisable dans l'éditeur : `Sheet` droite (mobile-friendly), transcript, composer avec **drag-drop de fichiers** zmenu/DeluxeMenus, boucle `streamAssistant` (4a) qui rend le texte et **applique** `menu_written` (`applyAssistantMenu`) / `menu_deleted` (`deleteFromPack`) au canvas, cartes « menu créé/modifié », ouvert par un bouton top-bar. → **feature utilisable end-to-end** (avec une clé provider configurée backend).

**Architecture:** Côté éditeur (`editor/`):
- `state/uiStore.ts` — flag `assistantPanelOpen` + `setAssistantPanelOpen`.
- `features/assistant/AssistantPanel.tsx` — le composant (consomme 4a + stores).
- `components/WorkspaceTopBarControls.tsx` — bouton « ✨ » qui ouvre le panel.
- Montage du `<AssistantPanel packId>` dans la route workspace.
- `locales/{en,fr}.ts` — namespace `assistant.*`.

**Tech Stack:** React 19, Vitest + testing-library, `sonner` (toasts), `Sheet` (`editor/src/components/ui/sheet.tsx`), react-i18next.

**Prérequis:** 4a mergé (`packToMenuV1`, `streamAssistant`/`openConversation`, `applyAssistantMenu`).

> **Note UX** : approche overlay (Sheet + bouton top-bar) plutôt qu'une entrée sidebar route (cf. cartographie éditeur). Mobile : le `Sheet` couvre l'écran sur petit viewport (pas d'affordance hover-only — préférence projet). Toutes les strings via i18n.

> **Concurrence (spec)** : chaque message renvoie `menus: packToMenuV1(pack)` + `attachments` → le backend **re-seed** la working-copy (last-writer) ⇒ reste synchro avec l'éditeur même si l'admin édite à la main.

---

### Task 1 : flag `uiStore` + i18n — TDD léger

**Files:**
- Modify: `editor/src/state/uiStore.ts`
- Modify: `editor/src/locales/en.ts`, `editor/src/locales/fr.ts`

- [ ] **Step 1 : `uiStore`** — ajouter au state (suivre le pattern existant du store) :
```ts
  assistantPanelOpen: boolean;
  setAssistantPanelOpen: (open: boolean) => void;
```
impl : `assistantPanelOpen: false, setAssistantPanelOpen: (open) => set({ assistantPanelOpen: open }),`. (Ne PAS persister ce flag s'il y a un `partialize` — c'est transitoire.)

- [ ] **Step 2 : i18n** — ajouter le même namespace dans `en.ts` ET `fr.ts` :
```ts
  assistant: {
    title: "AI Assistant",            // fr: "Assistant IA"
    open: "AI Assistant",             // fr: "Assistant IA"
    placeholder: "Describe a menu, or drop a zmenu/DeluxeMenus file…", // fr: "Décris un menu, ou dépose un fichier zmenu/DeluxeMenus…"
    send: "Send",                     // fr: "Envoyer"
    thinking: "Thinking…",            // fr: "Réflexion…"
    menuCreated: "Created / updated: {{id}}",  // fr: "Créé / modifié : {{id}}"
    menuDeleted: "Deleted: {{id}}",   // fr: "Supprimé : {{id}}"
    dropHint: "Drop files to attach", // fr: "Dépose des fichiers pour les joindre"
    errorGeneric: "Something went wrong. Try again.", // fr: "Une erreur est survenue. Réessaie."
    disabled: "Assistant not configured.",            // fr: "Assistant non configuré."
    attach: "{{count}} file(s) attached",             // fr: "{{count}} fichier(s) joint(s)"
  },
```

- [ ] **Step 3 : Run** la suite uiStore + i18n existantes restent vertes (`npx vitest run src/state/uiStore.test.ts` si présent). Commit `feat(assistant): uiStore panel flag + i18n strings`.

---

### Task 2 : `AssistantPanel` — composant + tests

**Files:**
- Create: `editor/src/features/assistant/AssistantPanel.tsx`
- Create: `editor/src/features/assistant/AssistantPanel.test.tsx`

- [ ] **Step 1 : Composant** — (réconcilier l'API exacte de `Sheet`/`SheetContent` en lisant `editor/src/components/ui/sheet.tsx`) :
```tsx
import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Sheet, SheetContent } from "@/components/ui/sheet"; // adapter aux exports réels
import { useUiStore } from "@/state/uiStore";
import { useSessionStore } from "@/state/sessionStore";
import { useAccountStore } from "@/state/accountStore";
import { openConversation, streamAssistant } from "@/lib/api/assistant";
import { packToMenuV1 } from "@/features/export/transform";
import type { PackId } from "@/domain/types";

type Entry =
  | { role: "user" | "assistant"; text: string }
  | { role: "card"; kind: "written" | "deleted"; id: string };

export function AssistantPanel({ packId }: { packId: PackId }) {
  const { t } = useTranslation();
  const open = useUiStore((s) => s.assistantPanelOpen);
  const setOpen = useUiStore((s) => s.setAssistantPanelOpen);
  const token = useSessionStore((s) => s.accessToken);

  const [entries, setEntries] = useState<Entry[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [attachments, setAttachments] = useState<Record<string, string>>({});
  const convId = useRef<string | null>(null);

  function appendAssistant(chunk: string) {
    setEntries((e) => {
      const copy = [...e];
      for (let i = copy.length - 1; i >= 0; i--) {
        if (copy[i].role === "assistant") { copy[i] = { role: "assistant", text: (copy[i] as { text: string }).text + chunk }; return copy; }
        if (copy[i].role === "user") break;
      }
      return [...copy, { role: "assistant", text: chunk }];
    });
  }

  async function send() {
    const text = input.trim();
    if (!token || !text || busy) return;
    setInput("");
    setEntries((e) => [...e, { role: "user", text }]);
    setBusy(true);
    try {
      const pack = useAccountStore.getState().account.packs.find((p) => p.id === packId);
      const lang = pack?.defaultLang ?? "en";
      const menus = pack ? packToMenuV1(pack) : [];
      if (!convId.current) convId.current = await openConversation(token, { menus, attachments });
      for await (const ev of streamAssistant(token, convId.current, { text, menus, attachments })) {
        if (ev.type === "text") appendAssistant(String(ev.text ?? ""));
        else if (ev.type === "menu_written") {
          const menu = ev.menu as Record<string, unknown>;
          useAccountStore.getState().applyAssistantMenu({ packId, menuV1: menu, lang });
          setEntries((e) => [...e, { role: "card", kind: "written", id: String(menu.id) }]);
        } else if (ev.type === "menu_deleted") {
          useAccountStore.getState().deleteFromPack({ packId, nodeIds: [String(ev.id)] });
          setEntries((e) => [...e, { role: "card", kind: "deleted", id: String(ev.id) }]);
        } else if (ev.type === "error") {
          toast.error(String(ev.message ?? t("assistant.errorGeneric")));
        }
      }
    } catch {
      toast.error(t("assistant.errorGeneric"));
    } finally {
      setBusy(false);
    }
  }

  async function onDrop(e: React.DragEvent) {
    e.preventDefault();
    const next: Record<string, string> = { ...attachments };
    for (const file of Array.from(e.dataTransfer.files)) next[file.name] = await file.text();
    setAttachments(next);
  }

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetContent side="right" /* adapter props */>
        <div data-testid="assistant-panel" className="flex h-full flex-col" onDragOver={(e) => e.preventDefault()} onDrop={onDrop}>
          <header className="text-sm font-medium">{t("assistant.title")}</header>
          <div className="flex-1 overflow-y-auto" data-testid="assistant-transcript">
            {entries.map((en, i) =>
              en.role === "card" ? (
                <div key={i} className="text-xs text-[var(--ink-faint)]">
                  {t(en.kind === "written" ? "assistant.menuCreated" : "assistant.menuDeleted", { id: en.id })}
                </div>
              ) : (
                <div key={i} data-role={en.role}>{en.text}</div>
              ),
            )}
            {busy && <div data-testid="assistant-thinking">{t("assistant.thinking")}</div>}
          </div>
          {Object.keys(attachments).length > 0 && (
            <div className="text-xs">{t("assistant.attach", { count: Object.keys(attachments).length })}</div>
          )}
          <div className="flex gap-2">
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void send(); } }}
              placeholder={t("assistant.placeholder")}
              aria-label={t("assistant.title")}
            />
            <button type="button" disabled={busy} onClick={() => void send()}>{t("assistant.send")}</button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
```

- [ ] **Step 2 : Tests** — `AssistantPanel.test.tsx` (mock le client SSE + ouvrir le panel via le store) :
```tsx
import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AssistantPanel } from "./AssistantPanel";
import { useUiStore } from "@/state/uiStore";
import { useSessionStore } from "@/state/sessionStore";
import { useAccountStore } from "@/state/accountStore";
import { packId } from "@/domain/ids";

vi.mock("@/lib/api/assistant", () => ({
  openConversation: vi.fn(async () => "c1"),
  streamAssistant: vi.fn(async function* () {
    yield { type: "text", text: "Voici " };
    yield { type: "text", text: "le menu." };
    yield { type: "menu_written", menu: { schema: "menu/v1", id: "shop", title: [{ kind: "plain", value: { key: "k" } }], size: 27, layers: [{ id: "l1", name: "d", elements: [{ id: "e1", positions: "0", appearances: [{ material: "STONE" }] }] }] } };
    yield { type: "done", stopReason: "end_turn" };
  }),
}));

function setup() {
  useSessionStore.setState({ accessToken: "tok" } as never);
  useAccountStore.getState().setAccount({ id: "a" as never, packs: [], packOrder: [] });
  useAccountStore.getState().createPack({ id: "p" });
  useUiStore.getState().setAssistantPanelOpen(true);
}
afterEach(() => vi.clearAllMocks());

describe("AssistantPanel", () => {
  it("streams assistant text and applies a written menu to the pack", async () => {
    setup();
    render(<AssistantPanel packId={packId("p")} />);
    const input = screen.getByLabelText(/assistant/i);
    await userEvent.type(input, "fais un shop");
    await userEvent.click(screen.getByText(/send|envoyer/i));
    await waitFor(() => expect(screen.getByTestId("assistant-transcript").textContent).toMatch(/Voici le menu\./));
    await waitFor(() => {
      const pack = useAccountStore.getState().account.packs.find((p) => p.id === packId("p"))!;
      expect(pack.menus.find((m) => m.id === "shop")).toBeTruthy();
    });
    expect(screen.getByText(/shop/)).toBeTruthy(); // the "created" card
  });

  it("attaching a dropped file shows the attachment count", async () => {
    setup();
    render(<AssistantPanel packId={packId("p")} />);
    const panel = screen.getByTestId("assistant-panel");
    const file = new File(["name: '&8Menu'\nsize: 54"], "menu.yml", { type: "text/yaml" });
    fireEvent.drop(panel, { dataTransfer: { files: [file] } });
    await waitFor(() => expect(screen.getByText(/1 file|1 fichier/i)).toBeTruthy());
  });
});
```
(Adapter les sélecteurs si l'API `Sheet` n'ouvre pas le contenu par défaut en test ; si `SheetContent` est portalisé/conditionné par `open`, vérifier que `open=true` rend bien le contenu en jsdom — sinon rendre le contenu inconditionnellement et n'utiliser `Sheet` que pour le chrome.)

- [ ] **Step 3 : Run (PASS) + commit** `feat(assistant): AssistantPanel (chat + file-drop + SSE apply)`.

---

### Task 3 : bouton top-bar + montage workspace + module + docs

**Files:**
- Modify: `editor/src/components/WorkspaceTopBarControls.tsx`
- Modify: la route workspace (`editor/src/routes/networks.$networkId.servers.$serverId.workspaces.$workspaceId.tsx`)
- Create: `editor/src/modules/assistant/index.ts` (+ `registerModule` dans `main.tsx`) — *optionnel* (overlay, pas de route) ; si la sidebar n'a pas de sens, **skip** et juste câbler bouton + montage.
- Modify: `CHANGELOG.md`, `docs/architecture/editor-internals.md`, `docs-site/.../editor/assistant.md` (user doc, créer).

- [ ] **Step 1 : Bouton top-bar** — dans `WorkspaceTopBarControls`, ajouter un bouton « ✨ » (icône `lucide-react` `Sparkles`, `aria-label={t("assistant.open")}`) qui appelle `useUiStore.getState().setAssistantPanelOpen(true)` (ou via hook). Suivre le style des boutons existants (undo/redo/lang).

- [ ] **Step 2 : Montage** — dans la route workspace, rendre `<AssistantPanel packId={activePackId} />` (à côté des autres overlays comme `<DeletePackDialog>`). Le panel se gère via le flag uiStore.

- [ ] **Step 3 : Run** — la suite éditeur ne régresse pas (`npx vitest run src/features/assistant src/components`), build TS du dossier OK.

- [ ] **Step 4 : Docs** — `CHANGELOG.md` `[Unreleased]` : panel assistant (chat + file-drop + application live). `editor-internals.md` : section panel. `docs-site/src/content/docs/editor/assistant.md` : courte doc user (à quoi sert le panel, NL + drop de fichiers, nécessite un provider configuré). Commit `feat(assistant): wire panel into top-bar + workspace + docs`.

---

## Self-review

- **End-to-end** : bouton → Sheet → message → `streamAssistant` → texte + `applyAssistantMenu`/`deleteFromPack` → canvas live. Testé (SSE mocké, apply réel sur le store). ✓
- **Mobile-first** : `Sheet` couvre le petit viewport ; pas de hover-only. ✓
- **i18n** : toutes les strings via `t(...)` (en+fr même commit). ✓
- **Re-seed à chaque message** (menus+attachments) = synchro working-copy/éditeur (last-writer, spec). ✓
- **Réversibilité v1** = undo zundo (les applies sont capturés). Checkpoint commit = raffinement ultérieur. ✓
- **Crédits** : sub-plan 3 (le backend émet déjà `usage`) ; ici, `error`/503 affiché.
- **Polish design** : fonctionnel + on-spec ; passer `/design-review` + QA `/browse` en suivi pour le rendu visuel.

## Suite

- **3 — crédits** : ledger + débit sur `usage` + pré-check/blocage + octroi admin. Brancher l'état « plus de crédits » dans le panel.
- **Polish** : design-review du panel, QA browse (dev server), streaming UX (auto-scroll, markdown), cartes menu cliquables vers le canvas.
- **Réversibilité avancée** : checkpoint commit « avant modifs IA » + bandeau Annuler (History).
