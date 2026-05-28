# Multi-Server Networks — Phase 1B Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refactor le data model pour que `Pack` devienne une entité first-class détenue par un `Network`, `Asset` soit scopé au pack, `server_key` appartienne à un Network, et le binding `(server_key ↔ pack)` passe par une nouvelle table `pack_bindings`. Le resource pack build merge les assets de tous les packs bindés à un server_key avec ré-allocation de codepoints à la volée.

**Architecture:**
- **Backend** (Bun + Hono + Postgres/Drizzle) : nouvelles tables `networks`, `memberships`, `packs`, `pack_bindings`. `pack_bundles` est supprimée (son contenu fusionne dans `packs`). `assets.serverKeyId` devient `assets.packId`. `server_keys` gagne `networkId`. Le routing assets passe sous `/api/editor-session/:token/packs/:packId/assets/*`.
- **Resource pack build** : `rebuildResourcePack(serverKeyId)` collecte les assets de **tous** les packs bindés au server_key, exécute un merger de codepoints (par order de pack stable, premier arrivé garde son codepoint, suivants se font ré-allouer en cas de collision), puis émet un asset-index.json reflétant le mapping final.
- **Editor** (React + Zustand) : `packApi.ts` ajoute le param `packId` sur toutes les API d'assets. `assetStore` devient pack-scoped (clear sur switch de pack). Aucune nouvelle UI (le setup flow est Plan 1C).
- **Plugin** : **aucun changement de code**. Le protocole WS est inchangé ; seule la source des `pack_hashes` côté backend bouge (de `pack_bundles` à `pack_bindings ⨝ packs`).

**Tech Stack:** TypeScript, Bun, Hono, Drizzle ORM (PostgreSQL), React 19, Vite 6, Zustand, Vitest, Jest.

**Hors scope (Plan 1C) :**
- Setup flow UI : login → pick/create Network → pick/create Pack → clone-or-new server_key → trust dance.
- Retrait des conflits éditeur ↔ disque (`ConflictBanner`, `ConflictResolutionModal`, `conflictsStore`, `pack_conflicts`, endpoints `/conflicts`, WS `pack_conflict_*`). Plan 1B les laisse **fonctionnels** ; Plan 1C les supprime.
- UI de gestion des Networks (créer/renommer/inviter membres). Plan 1B crée la table `memberships` et le service, mais aucune UI.
- Toute logique d'auth gating "voir d'autres packs du Network" (§4 du spec). Plan 1B conserve la sémantique actuelle "session anonyme = packs bindés au server_key".

**Migration strategy :** Iban accepte un wipe complet de son env de test. Plan inclut un script SQL de drop + recréation. Les tables Plan 1A (`users`, `user_sessions`, `discord_accounts`) sont **préservées**.

---

## File Structure

### Nouveaux fichiers (backend)

- `backend/src/lib/networkManager.ts` + `.test.ts` — création/lookup Networks
- `backend/src/lib/membershipManager.ts` + `.test.ts` — création/lookup Memberships
- `backend/src/lib/packStorage.ts` + `.test.ts` — CRUD packs (remplace les ops Drizzle inline sur `packBundles`)
- `backend/src/lib/packBindingManager.ts` + `.test.ts` — CRUD pack_bindings (createBinding, listPacksForServerKey, listServerKeysForPack)
- `backend/src/lib/rpCodepointMerger.ts` + `.test.ts` — algo de merge multi-pack avec ré-allocation de codepoints

### Fichiers modifiés (backend)

- `backend/src/db/schema.ts` — 4 nouvelles tables + `serverKeys.networkId` + `assets.packId`
- `backend/src/lib/codepointAllocator.ts` — scope par packId
- `backend/src/lib/assetStorage.ts` — chemins disque par packId
- `backend/src/lib/fontStorage.ts` — chemins disque par packId
- `backend/src/lib/resourcePack.ts` — multi-pack merge
- `backend/src/lib/resourcePackBuilder.ts` — input multi-pack (list de packs avec leurs assets)
- `backend/src/lib/assetIndexBuilder.ts` — input multi-pack
- `backend/src/lib/fontJsonBuilder.ts` — input multi-pack
- `backend/src/routes/assets.ts` — routes sous `/packs/:packId/assets`
- `backend/src/routes/textures.ts` — routes par packId
- `backend/src/routes/editorSession.ts` — routes packs scoped via packBindings
- `backend/src/routes/bundles.ts` — plugin push/pull, packs first-class
- `backend/src/routes/link.ts` — auto-Network à la création de server_key
- `backend/src/ws/hub.ts` — `pack_hashes` et `pushBundleAvailable` via packBindings

### Fichiers modifiés (editor)

- `editor/src/lib/packApi.ts` — endpoints assets pack-scopés
- `editor/src/features/assets/useAssetInit.ts` — passe `packId` du route param
- `editor/src/features/assets/assetStore.ts` — clear/reset sur switch de pack
- `editor/src/features/assets/AssetsTab.tsx` — lit `useParams().packId`
- `editor/src/lib/textures.ts` — URLs textures `/api/textures/asset/:packId/:assetId`

### Doc updates (Section H)

- `Artisan/CLAUDE.md` — table endpoints (toutes les routes assets), table protocole WS (inchangée), section variables d'env (inchangée)
- `.claude/skills/sync-docs/doc-impact-map.yaml` — ajouter les chemins refactorés

---

## Migration / wipe procedure

Iban a accepté un wipe complet du DB (sauf tables Plan 1A). Procedure exécutée **une seule fois** entre Task A8 (schéma final) et la suite :

```sql
-- À exécuter dans psql contre la DB locale (ou via `bun backend/scripts/wipe-phase-1b.ts`).
-- Préserve : users, user_sessions, discord_accounts.

BEGIN;

DROP TABLE IF EXISTS pack_conflicts CASCADE;
DROP TABLE IF EXISTS assets CASCADE;
DROP TABLE IF EXISTS pack_bundles CASCADE;
DROP TABLE IF EXISTS editor_sessions CASCADE;
DROP TABLE IF EXISTS link_codes CASCADE;
DROP TABLE IF EXISTS server_keys CASCADE;

COMMIT;
```

Puis :

```bash
cd backend
bun run db:push          # applique le nouveau schéma
```

État résultant : DB vide côté Phase 1B, users Phase 1A intacts. La prochaine fois qu'un plugin se link (`/artisan link`), Task B3 auto-crée un Network anonyme + binding → tout repart.

---

## Section A — Schéma foundation

### Task A1 : Table `networks`

**Files:**
- Modify: `backend/src/db/schema.ts`
- Test: pas de test dédié (le schéma est testé via les managers en Section B)

- [ ] **Step 1 : Ajouter la table `networks` à la fin de `schema.ts`**

```ts
// Ajouter après `discordAccounts` :
export const networks = pgTable("networks", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  tier: text("tier").notNull().default("free"),       // "free" | "paid" (Phase 4)
  subscriptionId: text("subscription_id"),            // null pour Phase 1B
  createdAt: timestamp("created_at").notNull(),
  updatedAt: timestamp("updated_at").notNull(),
});
```

- [ ] **Step 2 : Commit**

```bash
git add backend/src/db/schema.ts
git commit -m "feat(backend): table networks (Plan 1B foundation)"
```

---

### Task A2 : Table `memberships`

**Files:**
- Modify: `backend/src/db/schema.ts`

- [ ] **Step 1 : Ajouter la table `memberships` après `networks`**

```ts
export const memberships = pgTable("memberships", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  networkId: text("network_id").notNull().references(() => networks.id, { onDelete: "cascade" }),
  role: text("role").notNull(),                  // "owner" | "admin"
  createdAt: timestamp("created_at").notNull(),
}, (t) => [
  uniqueIndex("memberships_user_network_uniq").on(t.userId, t.networkId),
  index("memberships_network_idx").on(t.networkId),
]);
```

- [ ] **Step 2 : Commit**

```bash
git add backend/src/db/schema.ts
git commit -m "feat(backend): table memberships"
```

---

### Task A3 : Ajouter `networkId` à `server_keys`

**Files:**
- Modify: `backend/src/db/schema.ts`

- [ ] **Step 1 : Modifier `serverKeys` pour ajouter la FK `networkId`**

Remplacer le bloc `serverKeys` actuel par :

```ts
export const serverKeys = pgTable("server_keys", {
  id: text("id").primaryKey(),
  hash: text("hash").notNull(),
  label: text("label"),
  networkId: text("network_id").notNull().references(() => networks.id, { onDelete: "cascade" }),
  lastMcVersion: text("last_mc_version"),
  createdAt: timestamp("created_at").notNull(),
  resourcePackHash: text("resource_pack_hash"),
  resourcePackUpdatedAt: timestamp("resource_pack_updated_at"),
}, (t) => [
  index("server_keys_network_idx").on(t.networkId),
]);
```

- [ ] **Step 2 : Commit**

```bash
git add backend/src/db/schema.ts
git commit -m "feat(backend): server_keys.networkId FK"
```

---

### Task A4 : Table `packs` (first-class)

**Files:**
- Modify: `backend/src/db/schema.ts`

- [ ] **Step 1 : Ajouter `packs` après `memberships` (toujours pas de suppression de `packBundles` à ce stade — la table sera supprimée à A8)**

```ts
export const packs = pgTable("packs", {
  id: text("id").primaryKey(),
  networkId: text("network_id").notNull().references(() => networks.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  description: text("description"),
  hash: text("hash").notNull().default(""),
  filesJson: text("files_json").notNull().default("{}"),
  editorJson: text("editor_json"),
  deployedEditorJson: text("deployed_editor_json"),
  deletedAt: timestamp("deleted_at"),
  createdAt: timestamp("created_at").notNull(),
  updatedAt: timestamp("updated_at").notNull(),
}, (t) => [
  index("packs_network_idx").on(t.networkId),
  index("packs_network_deleted_idx").on(t.networkId, t.deletedAt),
]);
```

- [ ] **Step 2 : Commit**

```bash
git add backend/src/db/schema.ts
git commit -m "feat(backend): table packs (first-class)"
```

---

### Task A5 : Table `pack_bindings`

**Files:**
- Modify: `backend/src/db/schema.ts`

- [ ] **Step 1 : Ajouter `packBindings` après `packs`**

```ts
export const packBindings = pgTable("pack_bindings", {
  id: text("id").primaryKey(),
  serverKeyId: text("server_key_id").notNull().references(() => serverKeys.id, { onDelete: "cascade" }),
  packId: text("pack_id").notNull().references(() => packs.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at").notNull(),
}, (t) => [
  uniqueIndex("pack_bindings_uniq").on(t.serverKeyId, t.packId),
  index("pack_bindings_pack_idx").on(t.packId),
  index("pack_bindings_serverkey_idx").on(t.serverKeyId),
]);
```

> Note : pas de colonne `branch_name` dans le scope Plan 1B (Phase 2 ajoutera).

- [ ] **Step 2 : Commit**

```bash
git add backend/src/db/schema.ts
git commit -m "feat(backend): table pack_bindings"
```

---

### Task A6 : Re-scope `assets` à `packId`

**Files:**
- Modify: `backend/src/db/schema.ts`

- [ ] **Step 1 : Remplacer le bloc `assets` par la version pack-scopée**

```ts
export const assets = pgTable("assets", {
  id: text("id").primaryKey(),
  packId: text("pack_id").notNull().references(() => packs.id, { onDelete: "cascade" }),
  type: text("type").notNull(),                 // "texture" | "glyph" | "font"
  name: text("name").notNull(),
  width: integer("width").notNull(),
  height: integer("height").notNull(),
  ascent: integer("ascent"),
  codepoint: integer("codepoint"),
  contentWidth: integer("content_width"),
  fontMeta: jsonb("font_meta"),
  contentHash: text("content_hash").notNull(),
  createdAt: timestamp("created_at").notNull(),
  updatedAt: timestamp("updated_at").notNull(),
}, (t) => [
  uniqueIndex("assets_pack_name_type_uniq").on(t.packId, t.type, t.name),
  uniqueIndex("assets_pack_codepoint_uniq")
    .on(t.packId, t.codepoint)
    .where(sql`codepoint IS NOT NULL`),
  index("assets_pack_type_idx").on(t.packId, t.type),
]);
```

- [ ] **Step 2 : Commit**

```bash
git add backend/src/db/schema.ts
git commit -m "feat(backend): assets re-scope sous packId"
```

---

### Task A7 : `packConflicts` — packId reste text, supprimer `serverId.references`

**Files:**
- Modify: `backend/src/db/schema.ts`

**Note** : `packConflicts` est destinée à être supprimée en Plan 1C. Pour minimiser le churn, on laisse les colonnes en place mais le wipe SQL recrée la table avec son schéma actuel (sans changement structurel). Cette task ne fait rien côté code — elle existe pour cocher la box dans la check-list.

- [ ] **Step 1 : Confirmer que le bloc `packConflicts` est inchangé dans `schema.ts`**

Pas de modification. La FK `serverId.references(() => serverKeys.id, { onDelete: "cascade" })` est conservée.

- [ ] **Step 2 : Skip commit (no-op)**

---

### Task A8 : Wipe + apply schema

**Files:**
- Create: `backend/scripts/wipe-phase-1b.ts`

- [ ] **Step 1 : Écrire le script de wipe**

```ts
// backend/scripts/wipe-phase-1b.ts
import { db } from "../src/db/index";
import { sql } from "drizzle-orm";

async function main() {
  console.log("[wipe] Dropping Phase 1B tables (preserving Plan 1A users/sessions/discord)...");
  await db.execute(sql`DROP TABLE IF EXISTS pack_conflicts CASCADE`);
  await db.execute(sql`DROP TABLE IF EXISTS assets CASCADE`);
  await db.execute(sql`DROP TABLE IF EXISTS pack_bundles CASCADE`);
  await db.execute(sql`DROP TABLE IF EXISTS editor_sessions CASCADE`);
  await db.execute(sql`DROP TABLE IF EXISTS link_codes CASCADE`);
  await db.execute(sql`DROP TABLE IF EXISTS server_keys CASCADE`);
  console.log("[wipe] Done. Run `bun run db:push` to apply the new schema.");
}

main().catch((e) => { console.error(e); process.exit(1); });
```

- [ ] **Step 2 : Exécuter le wipe puis push**

```bash
cd backend
bun run scripts/wipe-phase-1b.ts
bun run db:push
```

Expected : `bun run db:push` termine sans erreur et crée `networks`, `memberships`, `packs`, `pack_bindings`, `assets` (new shape), `server_keys` (new shape), `editor_sessions`, `link_codes`, `pack_conflicts`. Vérifier dans psql :

```sql
\dt
-- doit lister : discord_accounts, editor_sessions, link_codes, memberships, networks, pack_bindings, pack_conflicts, packs, server_keys, user_sessions, users
```

- [ ] **Step 3 : Vider le disque `data/`**

Iban accepte le wipe disque aussi (cohérent avec le DB wipe) :

```bash
# depuis la racine du projet
rm -rf backend/data/assets backend/data/custom-items backend/data/resource-packs
```

- [ ] **Step 4 : Supprimer la table `packBundles` du schéma**

Dans `backend/src/db/schema.ts`, supprimer le bloc `export const packBundles = pgTable(...)`. Vérifier qu'aucun code source en dehors des fichiers à refactorer (Section C, F) ne l'importe — `grep` pour `packBundles` doit ne renvoyer que les imports dans `editorSession.ts`, `bundles.ts`, `hub.ts`, et leurs tests.

- [ ] **Step 5 : Commit**

```bash
git add backend/scripts/wipe-phase-1b.ts backend/src/db/schema.ts
git commit -m "chore(backend): wipe script + drop packBundles from schema"
```

---

## Section B — Network / Membership service + auto-create

### Task B1 : `networkManager.ts`

**Files:**
- Create: `backend/src/lib/networkManager.ts`
- Test: `backend/src/lib/networkManager.test.ts`

- [ ] **Step 1 : Test — création + lookup d'un Network**

```ts
// backend/src/lib/networkManager.test.ts
import { describe, it, expect, beforeEach } from "bun:test";
import { db } from "../db/index";
import { networks } from "../db/schema";
import { createNetwork, getNetworkById } from "./networkManager";

describe("networkManager", () => {
  beforeEach(async () => { await db.delete(networks); });

  it("createNetwork inserts a row with tier=free + returns id", async () => {
    const net = await createNetwork("My Network");
    expect(net.id).toMatch(/^net_/);
    expect(net.name).toBe("My Network");
    expect(net.tier).toBe("free");
    const rows = await db.select().from(networks);
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(net.id);
  });

  it("getNetworkById returns the row or null", async () => {
    const net = await createNetwork("X");
    const found = await getNetworkById(net.id);
    expect(found?.name).toBe("X");
    const missing = await getNetworkById("net_nope");
    expect(missing).toBeNull();
  });
});
```

- [ ] **Step 2 : Run — expect FAIL (module manquant)**

```bash
cd backend
bun test src/lib/networkManager.test.ts
```

Expected : `Cannot find module './networkManager'`.

- [ ] **Step 3 : Implémenter `networkManager.ts`**

```ts
// backend/src/lib/networkManager.ts
import { eq } from "drizzle-orm";
import { db } from "../db/index";
import { networks } from "../db/schema";

export type Network = typeof networks.$inferSelect;

export async function createNetwork(name: string): Promise<Network> {
  const id = "net_" + crypto.randomUUID().replace(/-/g, "").slice(0, 12);
  const now = new Date();
  await db.insert(networks).values({
    id, name, tier: "free", subscriptionId: null, createdAt: now, updatedAt: now,
  });
  const rows = await db.select().from(networks).where(eq(networks.id, id));
  return rows[0]!;
}

export async function getNetworkById(id: string): Promise<Network | null> {
  const rows = await db.select().from(networks).where(eq(networks.id, id));
  return rows[0] ?? null;
}
```

- [ ] **Step 4 : Run — expect PASS**

```bash
bun test src/lib/networkManager.test.ts
```

- [ ] **Step 5 : Commit**

```bash
git add backend/src/lib/networkManager.ts backend/src/lib/networkManager.test.ts
git commit -m "feat(backend): networkManager (create + lookup)"
```

---

### Task B2 : `membershipManager.ts`

**Files:**
- Create: `backend/src/lib/membershipManager.ts`
- Test: `backend/src/lib/membershipManager.test.ts`

- [ ] **Step 1 : Test**

```ts
// backend/src/lib/membershipManager.test.ts
import { describe, it, expect, beforeEach } from "bun:test";
import { db } from "../db/index";
import { memberships, networks, users } from "../db/schema";
import { addMembership, listNetworksForUser } from "./membershipManager";
import { createNetwork } from "./networkManager";

describe("membershipManager", () => {
  beforeEach(async () => {
    await db.delete(memberships);
    await db.delete(networks);
    await db.delete(users);
    await db.insert(users).values({
      id: "u1", email: "a@b.c", name: "A", passwordHash: null, avatarUrl: null,
      createdAt: new Date(), updatedAt: new Date(),
    });
  });

  it("addMembership inserts a row", async () => {
    const net = await createNetwork("N");
    await addMembership("u1", net.id, "owner");
    const rows = await db.select().from(memberships);
    expect(rows).toHaveLength(1);
    expect(rows[0].userId).toBe("u1");
    expect(rows[0].role).toBe("owner");
  });

  it("listNetworksForUser returns the user's networks", async () => {
    const n1 = await createNetwork("A");
    const n2 = await createNetwork("B");
    await addMembership("u1", n1.id, "owner");
    await addMembership("u1", n2.id, "admin");
    const list = await listNetworksForUser("u1");
    expect(list.map((n) => n.id).sort()).toEqual([n1.id, n2.id].sort());
  });
});
```

- [ ] **Step 2 : Run — expect FAIL**

```bash
bun test src/lib/membershipManager.test.ts
```

- [ ] **Step 3 : Implémenter**

```ts
// backend/src/lib/membershipManager.ts
import { eq, inArray } from "drizzle-orm";
import { db } from "../db/index";
import { memberships, networks } from "../db/schema";

export type Role = "owner" | "admin";

export async function addMembership(userId: string, networkId: string, role: Role): Promise<void> {
  const id = "mem_" + crypto.randomUUID().replace(/-/g, "").slice(0, 12);
  await db.insert(memberships).values({ id, userId, networkId, role, createdAt: new Date() });
}

export async function listNetworksForUser(userId: string) {
  const memb = await db.select({ networkId: memberships.networkId }).from(memberships).where(eq(memberships.userId, userId));
  if (memb.length === 0) return [];
  return await db.select().from(networks).where(inArray(networks.id, memb.map((m) => m.networkId)));
}
```

- [ ] **Step 4 : Run — expect PASS**

- [ ] **Step 5 : Commit**

```bash
git add backend/src/lib/membershipManager.ts backend/src/lib/membershipManager.test.ts
git commit -m "feat(backend): membershipManager (add + list networks for user)"
```

---

### Task B3 : Auto-Network sur `POST /link/:code/claim`

**Files:**
- Modify: `backend/src/routes/link.ts`
- Modify: `backend/src/routes/link.test.ts`

- [ ] **Step 1 : Test — un claim crée un Network + relie le server_key**

Ajouter dans `link.test.ts` :

```ts
it("auto-creates a Network when claiming and links the server_key to it", async () => {
  const create = await app.request("/api/link/", { method: "POST" });
  const { code } = await create.json();
  const claim = await app.request(`/api/link/${code}/claim`, { method: "POST" });
  const { server_key_id } = await claim.json();

  const sk = await db.select().from(serverKeys).where(eq(serverKeys.id, server_key_id));
  expect(sk[0].networkId).toBeTruthy();
  const nets = await db.select().from(networks).where(eq(networks.id, sk[0].networkId));
  expect(nets).toHaveLength(1);
  expect(nets[0].name).toMatch(/Network/);   // default name pattern
});
```

> Note : importer `networks` depuis `schema`.

- [ ] **Step 2 : Run — expect FAIL** (la colonne `networkId` est `NOT NULL` mais le code actuel ne la set pas).

- [ ] **Step 3 : Modifier `link.ts` pour auto-créer un Network**

Remplacer le bloc `POST /:code/claim` :

```ts
import { createNetwork } from "../lib/networkManager";

router.post("/:code/claim", async (c) => {
  const code = c.req.param("code");
  const rows = await db.select().from(linkCodes).where(eq(linkCodes.code, code));
  if (rows.length === 0) return c.json({ error: "Not found" }, 404);
  const row = rows[0];
  if (row.claimedAt) return c.json({ error: "Already claimed" }, 409);
  if (row.expiresAt < new Date()) return c.json({ error: "Expired" }, 410);

  const { id, key, hash } = await generateServerKey();
  const network = await createNetwork(`Network ${id.slice(0, 6)}`);
  await db.transaction(async (tx) => {
    await tx.insert(serverKeys).values({
      id, hash, label: null, networkId: network.id, createdAt: new Date(),
    });
    await tx.update(linkCodes).set({ claimedAt: new Date(), serverKeyId: id }).where(eq(linkCodes.code, code));
  });

  pushLinkConfirmed(code, key);

  return c.json({ server_key_id: id }, 200);
});
```

> Le `createNetwork` ne fait pas partie de la transaction (Drizzle/Bun postgres transactions n'acceptent pas un appel externe de manière propre). Acceptable car le worst case = orphan Network (sera GC dans une migration future ou ignoré).

- [ ] **Step 4 : Faire la même chose pour `setup_claim` (handlePluginMessage dans `hub.ts`)**

Dans `hub.ts`, dans le bloc `if (msg.type === "setup_claim")`, modifier l'insert de server_keys pour inclure `networkId`. Auto-créer un Network juste avant l'insert :

```ts
// Avant le `await db.transaction(...)`:
const { createNetwork } = await import("../lib/networkManager");
const networkForSetup = await createNetwork(`Network ${id.slice(0, 6)}`);

// Dans le transaction :
await tx.insert(serverKeys).values({
  id, hash, label: null, networkId: networkForSetup.id, createdAt: new Date(),
});
```

- [ ] **Step 5 : Run — expect PASS**

```bash
bun test src/routes/link.test.ts
```

- [ ] **Step 6 : Commit**

```bash
git add backend/src/routes/link.ts backend/src/routes/link.test.ts backend/src/ws/hub.ts
git commit -m "feat(backend): auto-Network sur claim/setup_claim"
```

---

## Section C — Pack service refactor

### Task C1 : `packStorage.ts` (CRUD)

**Files:**
- Create: `backend/src/lib/packStorage.ts`
- Test: `backend/src/lib/packStorage.test.ts`

- [ ] **Step 1 : Test**

```ts
// backend/src/lib/packStorage.test.ts
import { describe, it, expect, beforeEach } from "bun:test";
import { db } from "../db/index";
import { packs, networks } from "../db/schema";
import { createPack, getPack, upsertPackContent, softDeletePack, listPacksForNetwork } from "./packStorage";
import { createNetwork } from "./networkManager";

describe("packStorage", () => {
  let networkId: string;
  beforeEach(async () => {
    await db.delete(packs);
    await db.delete(networks);
    networkId = (await createNetwork("N")).id;
  });

  it("createPack inserts with default hash and files", async () => {
    const p = await createPack({ networkId, name: "main" });
    expect(p.id).toMatch(/^pack_/);
    expect(p.networkId).toBe(networkId);
    expect(p.hash).toBe("");
    expect(p.filesJson).toBe("{}");
  });

  it("getPack returns the row or null", async () => {
    const p = await createPack({ networkId, name: "main" });
    expect((await getPack(p.id))?.id).toBe(p.id);
    expect(await getPack("pack_nope")).toBeNull();
  });

  it("upsertPackContent updates hash + filesJson", async () => {
    const p = await createPack({ networkId, name: "main" });
    await upsertPackContent(p.id, { hash: "abc", filesJson: '{"a.yaml":"x"}', editorJson: '{"id":"main"}' });
    const updated = await getPack(p.id);
    expect(updated?.hash).toBe("abc");
    expect(updated?.filesJson).toBe('{"a.yaml":"x"}');
  });

  it("softDeletePack sets deletedAt", async () => {
    const p = await createPack({ networkId, name: "main" });
    await softDeletePack(p.id);
    expect((await getPack(p.id))?.deletedAt).toBeTruthy();
  });

  it("listPacksForNetwork filters by network + non-deleted", async () => {
    const p1 = await createPack({ networkId, name: "a" });
    const p2 = await createPack({ networkId, name: "b" });
    await softDeletePack(p2.id);
    const list = await listPacksForNetwork(networkId);
    expect(list.map((p) => p.id)).toEqual([p1.id]);
  });
});
```

- [ ] **Step 2 : Run — expect FAIL**

- [ ] **Step 3 : Implémenter**

```ts
// backend/src/lib/packStorage.ts
import { and, eq, isNull } from "drizzle-orm";
import { db } from "../db/index";
import { packs } from "../db/schema";

export type Pack = typeof packs.$inferSelect;

export async function createPack(input: {
  networkId: string;
  name: string;
  description?: string | null;
  id?: string;          // optional, default generated
}): Promise<Pack> {
  const id = input.id ?? "pack_" + crypto.randomUUID().replace(/-/g, "").slice(0, 12);
  const now = new Date();
  await db.insert(packs).values({
    id,
    networkId: input.networkId,
    name: input.name,
    description: input.description ?? null,
    hash: "",
    filesJson: "{}",
    editorJson: null,
    deployedEditorJson: null,
    deletedAt: null,
    createdAt: now,
    updatedAt: now,
  });
  return (await getPack(id))!;
}

export async function getPack(id: string): Promise<Pack | null> {
  const rows = await db.select().from(packs).where(eq(packs.id, id));
  return rows[0] ?? null;
}

export async function upsertPackContent(
  id: string,
  patch: { hash?: string; filesJson?: string; editorJson?: string | null; deployedEditorJson?: string | null },
): Promise<void> {
  await db.update(packs)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(packs.id, id));
}

export async function softDeletePack(id: string): Promise<void> {
  await db.update(packs).set({ deletedAt: new Date(), updatedAt: new Date() }).where(eq(packs.id, id));
}

export async function listPacksForNetwork(networkId: string): Promise<Pack[]> {
  return await db.select().from(packs).where(and(eq(packs.networkId, networkId), isNull(packs.deletedAt)));
}
```

- [ ] **Step 4 : Run — expect PASS**

- [ ] **Step 5 : Commit**

```bash
git add backend/src/lib/packStorage.ts backend/src/lib/packStorage.test.ts
git commit -m "feat(backend): packStorage (CRUD packs first-class)"
```

---

### Task C2 : `packBindingManager.ts`

**Files:**
- Create: `backend/src/lib/packBindingManager.ts`
- Test: `backend/src/lib/packBindingManager.test.ts`

- [ ] **Step 1 : Test**

```ts
// backend/src/lib/packBindingManager.test.ts
import { describe, it, expect, beforeEach } from "bun:test";
import { db } from "../db/index";
import { packBindings, packs, serverKeys, networks } from "../db/schema";
import {
  createBinding, deleteBinding, listPacksForServerKey, listServerKeysForPack,
} from "./packBindingManager";
import { createNetwork } from "./networkManager";
import { createPack } from "./packStorage";

describe("packBindingManager", () => {
  let networkId: string, skId: string;
  beforeEach(async () => {
    await db.delete(packBindings);
    await db.delete(packs);
    await db.delete(serverKeys);
    await db.delete(networks);
    networkId = (await createNetwork("N")).id;
    skId = "sk_" + crypto.randomUUID().slice(0, 8);
    await db.insert(serverKeys).values({
      id: skId, hash: "h", networkId, label: null, createdAt: new Date(),
    });
  });

  it("createBinding inserts a row", async () => {
    const pack = await createPack({ networkId, name: "main" });
    await createBinding(skId, pack.id);
    const rows = await db.select().from(packBindings);
    expect(rows).toHaveLength(1);
  });

  it("listPacksForServerKey returns bound non-deleted packs", async () => {
    const p1 = await createPack({ networkId, name: "a" });
    const p2 = await createPack({ networkId, name: "b" });
    await createBinding(skId, p1.id);
    await createBinding(skId, p2.id);
    const list = await listPacksForServerKey(skId);
    expect(list.map((p) => p.id).sort()).toEqual([p1.id, p2.id].sort());
  });

  it("listServerKeysForPack returns all bound server keys", async () => {
    const pack = await createPack({ networkId, name: "main" });
    await createBinding(skId, pack.id);
    const list = await listServerKeysForPack(pack.id);
    expect(list).toEqual([skId]);
  });

  it("deleteBinding removes the row", async () => {
    const pack = await createPack({ networkId, name: "main" });
    await createBinding(skId, pack.id);
    await deleteBinding(skId, pack.id);
    expect(await db.select().from(packBindings)).toHaveLength(0);
  });
});
```

- [ ] **Step 2 : Run — expect FAIL**

- [ ] **Step 3 : Implémenter**

```ts
// backend/src/lib/packBindingManager.ts
import { and, eq, inArray, isNull } from "drizzle-orm";
import { db } from "../db/index";
import { packBindings, packs } from "../db/schema";

export async function createBinding(serverKeyId: string, packId: string): Promise<void> {
  const id = "bind_" + crypto.randomUUID().replace(/-/g, "").slice(0, 12);
  await db.insert(packBindings).values({ id, serverKeyId, packId, createdAt: new Date() });
}

export async function deleteBinding(serverKeyId: string, packId: string): Promise<void> {
  await db.delete(packBindings)
    .where(and(eq(packBindings.serverKeyId, serverKeyId), eq(packBindings.packId, packId)));
}

export async function listPacksForServerKey(serverKeyId: string) {
  const bindings = await db.select({ packId: packBindings.packId })
    .from(packBindings).where(eq(packBindings.serverKeyId, serverKeyId));
  if (bindings.length === 0) return [];
  return await db.select().from(packs).where(and(
    inArray(packs.id, bindings.map((b) => b.packId)),
    isNull(packs.deletedAt),
  ));
}

export async function listServerKeysForPack(packId: string): Promise<string[]> {
  const rows = await db.select({ serverKeyId: packBindings.serverKeyId })
    .from(packBindings).where(eq(packBindings.packId, packId));
  return rows.map((r) => r.serverKeyId);
}
```

- [ ] **Step 4 : Run — expect PASS**

- [ ] **Step 5 : Commit**

```bash
git add backend/src/lib/packBindingManager.ts backend/src/lib/packBindingManager.test.ts
git commit -m "feat(backend): packBindingManager"
```

---

### Task C3 : Refactor `editorSession.ts` — list & PUT packs via bindings

**Files:**
- Modify: `backend/src/routes/editorSession.ts`
- Modify: `backend/src/routes/editorSession.test.ts`

Le but : `GET /api/editor-session/:token/packs` retourne les packs bindés au server_key (au lieu de query `packBundles`). `PUT /api/editor-session/:token/packs/:packId` upsert sur `packs` ; et si le binding n'existe pas, il est créé automatiquement.

- [ ] **Step 1 : Adapter le test existant `GET /:token/packs`**

Lire `backend/src/routes/editorSession.test.ts` autour des assertions de listing de packs et remplacer toute fixture qui insert dans `packBundles` par :

```ts
// Setup helper (à factoriser au début du fichier si pas déjà fait) :
async function seedBoundPack(serverKeyId: string, packId: string, hash: string, files: object) {
  const sk = (await db.select().from(serverKeys).where(eq(serverKeys.id, serverKeyId)))[0];
  if (!sk) throw new Error("seed: server_key absent");
  const { createPack } = await import("../lib/packStorage");
  const { createBinding } = await import("../lib/packBindingManager");
  await createPack({ networkId: sk.networkId, name: packId, id: `pack_${packId}` });
  await createBinding(serverKeyId, `pack_${packId}`);
  await db.update(packs).set({ hash, filesJson: JSON.stringify(files) }).where(eq(packs.id, `pack_${packId}`));
}
```

Les tests qui faisaient `db.insert(packBundles).values(...)` deviennent `seedBoundPack(serverKeyId, "main", "h", { "a.yaml": "x" })`.

- [ ] **Step 2 : Run — expect FAIL** (le route renvoie encore l'ancien shape ou vide).

- [ ] **Step 3 : Modifier `GET /:token/packs` dans `editorSession.ts`**

```ts
import { listPacksForServerKey } from "../lib/packBindingManager";

editorSessionRouter.get("/:token/packs", async (c) => {
  const session = await validateAccessToken(c.req.param("token"));
  if (!session) return c.json({ error: "Unauthorized" }, 401);
  const packs = await listPacksForServerKey(session.serverKeyId);
  return c.json({
    packs: packs.map((p) => ({
      pack_id: p.id,
      name: p.name,
      hash: p.hash,
      files: JSON.parse(p.filesJson),
      editor: p.editorJson ? JSON.parse(p.editorJson) : null,
    })),
  });
});
```

> Adapter la projection JSON aux clés attendues par l'éditeur (regarder le shape consommé par `packApi.loadPacks`).

- [ ] **Step 4 : Modifier `PUT /:token/packs/:packId`**

```ts
import { getPack, upsertPackContent, createPack } from "../lib/packStorage";
import { createBinding } from "../lib/packBindingManager";

editorSessionRouter.put("/:token/packs/:packId", async (c) => {
  const session = await validateAccessToken(c.req.param("token"));
  if (!session) return c.json({ error: "Unauthorized" }, 401);
  const packId = c.req.param("packId");
  const body = await c.req.json<{ hash: string; files: Record<string, string>; editor: unknown }>();

  // server_key → network → pack must be in same network
  const sk = (await db.select().from(serverKeys).where(eq(serverKeys.id, session.serverKeyId)))[0];
  if (!sk) return c.json({ error: "Server key missing" }, 500);

  let pack = await getPack(packId);
  if (!pack) {
    pack = await createPack({ networkId: sk.networkId, name: packId, id: packId });
    await createBinding(session.serverKeyId, packId);
  } else if (pack.networkId !== sk.networkId) {
    return c.json({ error: "Cross-network pack" }, 403);
  }

  await upsertPackContent(packId, {
    hash: body.hash,
    filesJson: JSON.stringify(body.files),
    editorJson: body.editor ? JSON.stringify(body.editor) : null,
  });

  return c.json({ ok: true });
});
```

- [ ] **Step 5 : Run — expect PASS**

```bash
bun test src/routes/editorSession.test.ts -t "packs"
```

- [ ] **Step 6 : Commit**

```bash
git add backend/src/routes/editorSession.ts backend/src/routes/editorSession.test.ts
git commit -m "refactor(backend): GET/PUT /editor-session packs via packBindings"
```

---

### Task C4 : Refactor `POST /:token/packs/:packId/deploy`

**Files:**
- Modify: `backend/src/routes/editorSession.ts`
- Modify: `backend/src/routes/editorSession.test.ts`

- [ ] **Step 1 : Adapter les fixtures de test `deploy`** — mêmes patterns que Task C3.

- [ ] **Step 2 : Modifier le handler**

```ts
import { pushBundleAvailable } from "../ws/hub";

editorSessionRouter.post("/:token/packs/:packId/deploy", async (c) => {
  const session = await validateAccessToken(c.req.param("token"));
  if (!session) return c.json({ error: "Unauthorized" }, 401);
  const packId = c.req.param("packId");
  const body = await c.req.json<{ hash: string; files: Record<string, string>; editor: unknown }>();

  const pack = await getPack(packId);
  if (!pack) return c.json({ error: "Pack not found" }, 404);
  if (pack.deletedAt) return c.json({ error: "Pack deleted" }, 410);

  await upsertPackContent(packId, {
    hash: body.hash,
    filesJson: JSON.stringify(body.files),
    editorJson: body.editor ? JSON.stringify(body.editor) : null,
    deployedEditorJson: body.editor ? JSON.stringify(body.editor) : null,
  });

  await pushBundleAvailable(packId, body.hash);     // signature change in Task F2
  return c.json({ ok: true });
});
```

> Noter le **changement de signature** de `pushBundleAvailable` : ne prend plus `serverKeyId` car la fonction résout elle-même les server_keys bindés (cf. Task F2).

- [ ] **Step 3 : Run — expect FAIL** (pushBundleAvailable signature pas encore changée — laisser ce fail pour le moment, sera fixé à Task F2).

- [ ] **Step 4 : Commit (work-in-progress, sera vert après Task F2)**

```bash
git add backend/src/routes/editorSession.ts backend/src/routes/editorSession.test.ts
git commit -m "refactor(backend): deploy via packs first-class (broken until F2)"
```

---

### Task C5 : Refactor `GET /:token/packs/:packId/deployed`

**Files:**
- Modify: `backend/src/routes/editorSession.ts`

- [ ] **Step 1 : Modifier le handler**

```ts
editorSessionRouter.get("/:token/packs/:packId/deployed", async (c) => {
  const session = await validateAccessToken(c.req.param("token"));
  if (!session) return c.json({ error: "Unauthorized" }, 401);
  const pack = await getPack(c.req.param("packId"));
  if (!pack || !pack.deployedEditorJson) return c.json({ deployed: null });
  return c.json({ deployed: JSON.parse(pack.deployedEditorJson) });
});
```

- [ ] **Step 2 : Adapter le test, run, expect PASS**

- [ ] **Step 3 : Commit**

```bash
git add backend/src/routes/editorSession.ts backend/src/routes/editorSession.test.ts
git commit -m "refactor(backend): GET deployed via packs first-class"
```

---

### Task C6 : Refactor `DELETE /:token/packs/:packId`

**Files:**
- Modify: `backend/src/routes/editorSession.ts`

- [ ] **Step 1 : Modifier le handler — soft-delete + auto-résolution conflits + broadcast**

```ts
import { eq, and, isNull } from "drizzle-orm";
import { packConflicts } from "../db/schema";
import { pushPackDeleted } from "../ws/hub";

editorSessionRouter.delete("/:token/packs/:packId", async (c) => {
  const session = await validateAccessToken(c.req.param("token"));
  if (!session) return c.json({ error: "Unauthorized" }, 401);
  const packId = c.req.param("packId");
  const pack = await getPack(packId);
  if (!pack || pack.deletedAt) return c.json({ error: "Not found" }, 404);

  await softDeletePack(packId);
  await db.update(packConflicts)
    .set({ resolvedAt: new Date(), resolution: "editor" })
    .where(and(eq(packConflicts.packId, packId), isNull(packConflicts.resolvedAt)));

  pushPackDeleted(packId);                  // signature change in Task F2
  return c.json({ deleted: true });
});
```

- [ ] **Step 2 : Adapter le test, run, expect PASS (modulo F2 fix-up)**

- [ ] **Step 3 : Commit**

```bash
git add backend/src/routes/editorSession.ts backend/src/routes/editorSession.test.ts
git commit -m "refactor(backend): DELETE pack via packs first-class"
```

---

### Task C7 : Refactor `POST /api/bundles/:packId` (plugin push)

**Files:**
- Modify: `backend/src/routes/bundles.ts`
- Modify: `backend/src/routes/bundles.test.ts`

- [ ] **Step 1 : Modifier le POST handler — créer le pack + binding si manquants**

```ts
import { getPack, createPack, upsertPackContent } from "../lib/packStorage";
import { createBinding } from "../lib/packBindingManager";

bundlesRouter.post("/:packId", async (c) => {
  const auth = await validateServerKeyHeader(c);
  if (!auth) return c.json({ error: "Unauthorized" }, 401);
  const packId = c.req.param("packId");
  const body = await c.req.json<{ hash: string; files: Record<string, string> }>();

  // Resolve network of the server_key
  const sk = (await db.select().from(serverKeys).where(eq(serverKeys.id, auth.serverKeyId)))[0];
  if (!sk) return c.json({ error: "Server key missing" }, 500);

  let pack = await getPack(packId);
  if (!pack) {
    pack = await createPack({ networkId: sk.networkId, name: packId, id: packId });
    await createBinding(auth.serverKeyId, packId);
  }
  await upsertPackContent(packId, { hash: body.hash, filesJson: JSON.stringify(body.files) });
  return c.json({ ok: true });
});
```

- [ ] **Step 2 : Adapter les tests** — supprimer toute insertion dans `packBundles`.

- [ ] **Step 3 : Run — expect PASS**

- [ ] **Step 4 : Commit**

```bash
git add backend/src/routes/bundles.ts backend/src/routes/bundles.test.ts
git commit -m "refactor(backend): POST /api/bundles/:packId via packs"
```

---

### Task C8 : Refactor `GET /api/bundles/:packId`

**Files:**
- Modify: `backend/src/routes/bundles.ts`

- [ ] **Step 1 : Modifier le GET — lire depuis `packs`**

```ts
bundlesRouter.get("/:packId", async (c) => {
  const auth = await validateServerKeyHeader(c);
  if (!auth) return c.json({ error: "Unauthorized" }, 401);
  const packId = c.req.param("packId");

  // Authoriser uniquement si binding actif
  const { listPacksForServerKey } = await import("../lib/packBindingManager");
  const bound = await listPacksForServerKey(auth.serverKeyId);
  if (!bound.find((p) => p.id === packId)) return c.json({ error: "Not bound" }, 404);

  const pack = await getPack(packId);
  if (!pack || pack.deletedAt) return c.json({ error: "Not found" }, 404);

  return c.json({ hash: pack.hash, files: JSON.parse(pack.filesJson) });
});
```

- [ ] **Step 2 : Adapter tests, run, expect PASS**

- [ ] **Step 3 : Commit**

```bash
git add backend/src/routes/bundles.ts backend/src/routes/bundles.test.ts
git commit -m "refactor(backend): GET /api/bundles/:packId via packs"
```

---

## Section D — Assets per-pack refactor

### Task D1 : `assetStorage.ts` — chemins par packId

**Files:**
- Modify: `backend/src/lib/assetStorage.ts`
- Modify: `backend/src/lib/assetStorage.test.ts` (s'il existe — créer sinon)

- [ ] **Step 1 : Test**

```ts
// backend/src/lib/assetStorage.test.ts
import { describe, it, expect, afterAll } from "bun:test";
import { join } from "path";
import { existsSync } from "fs";
import { rm } from "fs/promises";
import { assetPath, writeAssetFile, deleteAssetFile, assetRoot } from "./assetStorage";

describe("assetStorage (pack-scoped)", () => {
  afterAll(async () => { await rm(join(assetRoot(), "pack_test_d1"), { recursive: true, force: true }); });

  it("assetPath produces data/assets/{packId}/{assetId}.png", () => {
    const p = assetPath("pack_test_d1", "asset_x");
    expect(p.endsWith(join("assets", "pack_test_d1", "asset_x.png"))).toBe(true);
  });

  it("writeAssetFile creates dir and file", async () => {
    await writeAssetFile("pack_test_d1", "asset_x", new Uint8Array([1, 2, 3]));
    expect(existsSync(assetPath("pack_test_d1", "asset_x"))).toBe(true);
  });

  it("deleteAssetFile is idempotent", async () => {
    await deleteAssetFile("pack_test_d1", "asset_x");
    await deleteAssetFile("pack_test_d1", "asset_x");   // no throw
  });
});
```

- [ ] **Step 2 : Run — expect FAIL** (les tests référencent encore l'ancienne signature avec `serverKeyId`).

> Si l'ancien test `assetStorage.test.ts` existe, le supprimer/écraser avec le nouveau contenu.

- [ ] **Step 3 : Renommer le paramètre dans `assetStorage.ts`**

```ts
// backend/src/lib/assetStorage.ts
import { mkdir, writeFile, unlink } from "fs/promises";
import { join, resolve } from "path";

export function assetRoot(): string {
  return resolve("data/assets");
}

export function assetPath(packId: string, assetId: string): string {
  return join(assetRoot(), packId, `${assetId}.png`);
}

export async function writeAssetFile(packId: string, assetId: string, data: Uint8Array): Promise<void> {
  const dir = join(assetRoot(), packId);
  await mkdir(dir, { recursive: true });
  await writeFile(assetPath(packId, assetId), data);
}

export async function deleteAssetFile(packId: string, assetId: string): Promise<void> {
  try {
    await unlink(assetPath(packId, assetId));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
  }
}
```

- [ ] **Step 4 : Run — expect PASS** (les call sites externes ne compilent plus, mais ce fichier seul est vert)

- [ ] **Step 5 : Commit**

```bash
git add backend/src/lib/assetStorage.ts backend/src/lib/assetStorage.test.ts
git commit -m "refactor(backend): assetStorage paths via packId"
```

---

### Task D2 : `fontStorage.ts` — chemins par packId

**Files:**
- Modify: `backend/src/lib/fontStorage.ts`
- Modify: `backend/src/lib/fontStorage.test.ts`

- [ ] **Step 1 : Renommer `serverKeyId` → `packId` partout dans `fontStorage.ts`**

```ts
// 4 fonctions à patcher : fontDirPaths, writeFontAssets, deleteFontAssets, readFontGlyph.
// Le path interne devient resolve("data/assets", packId, "fonts", assetId).
export function fontDirPaths(packId: string, assetId: string): FontPaths {
  const dir = resolve("data/assets", packId, "fonts", assetId);
  return { dir, fontJson: join(dir, "font.json") };
}
// ... renommer paramètre + appel résolu dans les 3 autres fonctions.
```

- [ ] **Step 2 : Adapter le test `fontStorage.test.ts`** — remplacer toutes les valeurs `"sk_xxx"` par `"pack_xxx"`.

- [ ] **Step 3 : Run — expect PASS**

- [ ] **Step 4 : Commit**

```bash
git add backend/src/lib/fontStorage.ts backend/src/lib/fontStorage.test.ts
git commit -m "refactor(backend): fontStorage paths via packId"
```

---

### Task D3 : `codepointAllocator` — scope par packId

**Files:**
- Modify: `backend/src/lib/codepointAllocator.ts`
- Modify: `backend/src/lib/codepointAllocator.test.ts`

- [ ] **Step 1 : Modifier la signature**

```ts
export async function allocateCodepoint(packId: string): Promise<number> {
  const rows = await db
    .select({ max: max(assets.codepoint) })
    .from(assets)
    .where(and(eq(assets.packId, packId), isNotNull(assets.codepoint)));
  const current = rows[0]?.max ?? null;
  const next = current === null ? CODEPOINT_MIN : current + 1;
  if (next > CODEPOINT_MAX) {
    throw new Error("Codepoint range exhausted (U+E000–U+F7FF)");
  }
  return next;
}
```

- [ ] **Step 2 : Adapter le test** — remplacer les `serverKeyId` par `packId` dans les seeds.

- [ ] **Step 3 : Run — expect PASS**

- [ ] **Step 4 : Commit**

```bash
git add backend/src/lib/codepointAllocator.ts backend/src/lib/codepointAllocator.test.ts
git commit -m "refactor(backend): codepointAllocator scope packId"
```

---

### Task D4 : Routes assets sous `/packs/:packId/assets/*`

**Files:**
- Modify: `backend/src/routes/assets.ts`
- Modify: `backend/src/routes/assets.test.ts`
- Modify: `backend/src/index.ts` (montage du router si le path racine change)

Décision : changer le path racine de mounting. Aujourd'hui `app.route("/api/editor-session", assetsRouter)` + routes `:token/assets/...`. On passe à `:token/packs/:packId/assets/...`.

- [ ] **Step 1 : Adapter le test — toutes les URLs incluent `/packs/:packId/`**

Exemple :

```ts
// avant : POST /api/editor-session/${token}/assets
// après : POST /api/editor-session/${token}/packs/${packId}/assets
```

Le fixture doit donc préparer `packId` lié au server_key (helper `seedBoundPack` de Task C3).

- [ ] **Step 2 : Modifier toutes les routes dans `assets.ts`**

Remplacer chaque déclaration :

```ts
assetsRouter.post("/:token/assets", async (c) => {
  ...
  const session = await validateAccessToken(token);
  ...
  eq(assets.serverKeyId, session.serverKeyId),
});
```

par :

```ts
assetsRouter.post("/:token/packs/:packId/assets", async (c) => {
  const token = c.req.param("token");
  const packId = c.req.param("packId");
  const session = await validateAccessToken(token);
  if (!session) return c.json({ error: "Unauthorized" }, 401);

  // Authoriser uniquement si le pack est bindé au server_key
  const { listPacksForServerKey } = await import("../lib/packBindingManager");
  const bound = await listPacksForServerKey(session.serverKeyId);
  if (!bound.find((p) => p.id === packId)) return c.json({ error: "Pack not bound" }, 403);

  // ... reste du handler, remplaçant:
  //   - eq(assets.serverKeyId, session.serverKeyId)  →  eq(assets.packId, packId)
  //   - writeAssetFile(session.serverKeyId, ...)     →  writeAssetFile(packId, ...)
  //   - writeFontAssets(session.serverKeyId, ...)    →  writeFontAssets(packId, ...)
  //   - allocateCodepoint(session.serverKeyId)       →  allocateCodepoint(packId)
  //   - rebuildResourcePack(session.serverKeyId)     →  rebuildResourcePack(session.serverKeyId) [inchangé : RP scope reste server_key]
  //   - assets.serverKeyId                           →  assets.packId
});
```

Appliquer le même pattern aux 5 autres endpoints :
- `GET /:token/packs/:packId/assets` (list)
- `GET /:token/packs/:packId/assets/:id`
- `PATCH /:token/packs/:packId/assets/:id`
- `POST /:token/packs/:packId/assets/:id/duplicate`
- `DELETE /:token/packs/:packId/assets/:id`

Factoriser la résolution `assertBound` en helper local pour éviter la duplication :

```ts
async function assertBound(token: string, packId: string): Promise<{ session: NonNullable<Awaited<ReturnType<typeof validateAccessToken>>> } | { error: Response }> {
  const session = await validateAccessToken(token);
  if (!session) return { error: new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 }) };
  const { listPacksForServerKey } = await import("../lib/packBindingManager");
  const bound = await listPacksForServerKey(session.serverKeyId);
  if (!bound.find((p) => p.id === packId)) {
    return { error: new Response(JSON.stringify({ error: "Pack not bound" }), { status: 403 }) };
  }
  return { session };
}
```

- [ ] **Step 3 : Run — expect PASS** (tous les tests `assets.test.ts`)

```bash
bun test src/routes/assets.test.ts
```

- [ ] **Step 4 : Commit**

```bash
git add backend/src/routes/assets.ts backend/src/routes/assets.test.ts
git commit -m "refactor(backend): assets routes sous /packs/:packId/"
```

---

### Task D5 : `/api/textures/asset/:packId/:assetId`

**Files:**
- Modify: `backend/src/routes/textures.ts`
- Modify: `backend/src/routes/textures.assets.test.ts`

- [ ] **Step 1 : Test — la route change de path**

```ts
it("GET /api/textures/asset/:packId/:assetId returns the PNG", async () => {
  // seed: créer un pack + un asset PNG sur disque sous data/assets/{packId}/{assetId}.png
  // …
  const res = await app.request(`/api/textures/asset/${packId}/${assetId}`);
  expect(res.status).toBe(200);
  expect(res.headers.get("content-type")).toBe("image/png");
});
```

- [ ] **Step 2 : Modifier la route dans `textures.ts`**

Remplacer la déclaration `texturesRouter.get("/asset/:server_key_id/:asset_id", ...)` par `texturesRouter.get("/asset/:packId/:assetId", ...)` et lire le PNG depuis `assetPath(packId, assetId)`.

Pour `/asset-font/:assetId/:path*` (lookup-par-asset), patcher la résolution interne : aujourd'hui le serverKey est lu en DB depuis l'asset. Désormais, lire `packId` :

```ts
texturesRouter.get("/asset-font/:assetId/:path{.+}", async (c) => {
  const assetId = c.req.param("assetId");
  const relPath = c.req.param("path") ?? "";
  const row = (await db.select().from(assets).where(eq(assets.id, assetId)))[0];
  if (!row || row.type !== "font") return c.text("Not found", 404);
  const bytes = await readFontGlyph(row.packId, assetId, relPath);
  if (!bytes) return c.text("Not found", 404);
  return new Response(new Uint8Array(bytes), { headers: { "content-type": "image/png" } });
});
```

- [ ] **Step 3 : Run — expect PASS**

- [ ] **Step 4 : Commit**

```bash
git add backend/src/routes/textures.ts backend/src/routes/textures.assets.test.ts
git commit -m "refactor(backend): /api/textures/asset par packId"
```

---

### Task D6 : Mass tests update pour les fixtures asset/font/codepoint

**Files:**
- Modify: `backend/src/integration.test.ts`
- Modify: `backend/src/lib/assetIndexBuilder.test.ts`
- Modify: `backend/src/lib/fontJsonBuilder.test.ts`
- Modify: `backend/src/lib/resourcePackBuilder.test.ts`
- Modify: `backend/src/lib/resourcePack.test.ts`
- Modify: `backend/src/lib/packImport.test.ts`

- [ ] **Step 1 : Pour chaque fichier, remplacer dans les fixtures `serverKeyId: "sk_xxx"` par `packId: "pack_xxx"` sur les rows assets**

Pour les tests qui sollicitent `rebuildResourcePack(serverKeyId)` ou qui composent un `AssetRow[]`, vérifier que le shape `AssetRow` (défini dans `fontJsonBuilder.ts`) inclut désormais `packId` (le type est inféré depuis `assets.$inferSelect`, donc le changement de schéma se propage automatiquement — mais les fixtures qui construisent l'objet à la main doivent être adaptées).

> NOTE — la valeur `assetRoot()` reste `data/assets`. Tous les tests qui résolvent un path sur le FS doivent maintenant utiliser `packId` au lieu de `serverKeyId` pour les sous-dossiers (cf. Task D1 et D2).

- [ ] **Step 2 : Run all backend tests**

```bash
cd backend
bun test
```

Expected : la suite passe modulo Tasks E* et F* en attente (les RP build tests multi-pack et hub tests broadcast sont attendus rouges jusqu'à leurs tasks).

- [ ] **Step 3 : Commit**

```bash
git add backend/src
git commit -m "refactor(backend): fixtures tests assets/font scope packId"
```

---

## Section E — Resource pack build multi-pack avec ré-allocation codepoints

### Task E1 : `rpCodepointMerger.ts` — algo de merge

**Files:**
- Create: `backend/src/lib/rpCodepointMerger.ts`
- Test: `backend/src/lib/rpCodepointMerger.test.ts`

Algo : on reçoit une liste ordonnée de "pack contributions" (chacune avec ses assets glyph et leurs codepoints d'origine). On itère dans l'ordre :
- Premier pack : tous ses codepoints sont acceptés tels quels (jamais de collision).
- Packs suivants : pour chaque glyph, si son codepoint est déjà pris, on alloue le prochain libre dans `[U+E000, U+F7FF]`. Sinon on garde tel quel.
- Le résultat : `Map<assetId, finalCodepoint>` + la table des contributions remappées (par pack, par asset_id → final cp), utilisée pour générer le font.json unifié.

- [ ] **Step 1 : Test**

```ts
// backend/src/lib/rpCodepointMerger.test.ts
import { describe, it, expect } from "bun:test";
import { mergeCodepoints, type GlyphContribution } from "./rpCodepointMerger";

describe("mergeCodepoints", () => {
  it("first pack keeps all its codepoints", () => {
    const contribs: GlyphContribution[] = [
      { packId: "p1", glyphs: [{ assetId: "a1", codepoint: 0xE000 }, { assetId: "a2", codepoint: 0xE001 }] },
    ];
    const out = mergeCodepoints(contribs);
    expect(out.finalCodepoints.get("a1")).toBe(0xE000);
    expect(out.finalCodepoints.get("a2")).toBe(0xE001);
  });

  it("second pack with no collision keeps its codepoints", () => {
    const contribs: GlyphContribution[] = [
      { packId: "p1", glyphs: [{ assetId: "a1", codepoint: 0xE000 }] },
      { packId: "p2", glyphs: [{ assetId: "b1", codepoint: 0xE010 }] },
    ];
    const out = mergeCodepoints(contribs);
    expect(out.finalCodepoints.get("a1")).toBe(0xE000);
    expect(out.finalCodepoints.get("b1")).toBe(0xE010);
  });

  it("colliding glyph from later pack gets reallocated to next free codepoint", () => {
    const contribs: GlyphContribution[] = [
      { packId: "p1", glyphs: [{ assetId: "a1", codepoint: 0xE000 }] },
      { packId: "p2", glyphs: [{ assetId: "b1", codepoint: 0xE000 }] },     // collision
    ];
    const out = mergeCodepoints(contribs);
    expect(out.finalCodepoints.get("a1")).toBe(0xE000);
    expect(out.finalCodepoints.get("b1")).toBe(0xE001);
  });

  it("walks through gaps when finding free codepoints", () => {
    const contribs: GlyphContribution[] = [
      { packId: "p1", glyphs: [{ assetId: "a1", codepoint: 0xE000 }, { assetId: "a2", codepoint: 0xE002 }] },
      { packId: "p2", glyphs: [{ assetId: "b1", codepoint: 0xE000 }] },  // → 0xE001 (first free)
    ];
    const out = mergeCodepoints(contribs);
    expect(out.finalCodepoints.get("b1")).toBe(0xE001);
  });

  it("throws when range is exhausted", () => {
    const glyphs = Array.from({ length: 6200 }, (_, i) => ({ assetId: `a${i}`, codepoint: 0xE000 + i }));
    expect(() => mergeCodepoints([{ packId: "p1", glyphs }])).toThrow(/exhausted/);
  });
});
```

- [ ] **Step 2 : Run — expect FAIL**

- [ ] **Step 3 : Implémenter**

```ts
// backend/src/lib/rpCodepointMerger.ts
import { CODEPOINT_MIN, CODEPOINT_MAX } from "./codepointAllocator";

export interface GlyphContribution {
  packId: string;
  glyphs: { assetId: string; codepoint: number }[];
}

export interface MergeResult {
  finalCodepoints: Map<string, number>;    // assetId → final codepoint
}

export function mergeCodepoints(contribs: GlyphContribution[]): MergeResult {
  const used = new Set<number>();
  const finalCodepoints = new Map<string, number>();

  for (const contrib of contribs) {
    for (const g of contrib.glyphs) {
      let target = g.codepoint;
      if (used.has(target)) {
        target = nextFree(used);
      }
      if (target > CODEPOINT_MAX) {
        throw new Error("Codepoint range exhausted (U+E000–U+F7FF)");
      }
      used.add(target);
      finalCodepoints.set(g.assetId, target);
    }
  }

  return { finalCodepoints };
}

function nextFree(used: Set<number>): number {
  for (let cp = CODEPOINT_MIN; cp <= CODEPOINT_MAX; cp++) {
    if (!used.has(cp)) return cp;
  }
  return CODEPOINT_MAX + 1;     // signals exhausted
}
```

- [ ] **Step 4 : Run — expect PASS**

- [ ] **Step 5 : Commit**

```bash
git add backend/src/lib/rpCodepointMerger.ts backend/src/lib/rpCodepointMerger.test.ts
git commit -m "feat(backend): rpCodepointMerger (multi-pack codepoint merge)"
```

---

### Task E2 : Refactor `rebuildResourcePack` — multi-pack aggregation

**Files:**
- Modify: `backend/src/lib/resourcePack.ts`
- Modify: `backend/src/lib/resourcePack.test.ts`

- [ ] **Step 1 : Test — un server_key bindé à 2 packs avec collision génère un asset-index avec codepoints distincts**

```ts
it("multi-pack: collision → second glyph reallocated", async () => {
  // seed network + server_key + pack1 (glyph cp E000) + pack2 (glyph cp E000)
  // … (utiliser createNetwork, createPack, createBinding, db.insert(assets))
  await rebuildResourcePack(skId);

  const pack = await currentPackInfo(skId);
  // décompresser le zip, lire asset-index.json, vérifier que les 2 assetIds existent avec codepoints distincts.
  // …
});
```

- [ ] **Step 2 : Run — expect FAIL**

- [ ] **Step 3 : Implémenter le multi-pack collect + merger**

```ts
// backend/src/lib/resourcePack.ts
import { listPacksForServerKey } from "./packBindingManager";
import { mergeCodepoints, type GlyphContribution } from "./rpCodepointMerger";

export async function rebuildResourcePack(serverKeyId: string): Promise<PackInfo> {
  const boundPacks = await listPacksForServerKey(serverKeyId);
  if (boundPacks.length === 0) {
    // Pas de packs bindés : rebuild un RP vide. Conservation du comportement actuel d'un setup vierge.
    return rebuildEmpty(serverKeyId);
  }

  // Collect all assets across packs, sorted by pack.createdAt for stable order
  boundPacks.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  const contribs: GlyphContribution[] = [];
  const allAssets: (typeof assets.$inferSelect & { packId: string })[] = [];
  for (const p of boundPacks) {
    const rows = await db.select().from(assets).where(eq(assets.packId, p.id));
    contribs.push({
      packId: p.id,
      glyphs: rows
        .filter((a) => a.type === "glyph" && a.codepoint !== null)
        .map((a) => ({ assetId: a.id, codepoint: a.codepoint! })),
    });
    allAssets.push(...rows);
  }
  const { finalCodepoints } = mergeCodepoints(contribs);

  // Read PNGs from disk (per-pack subdirs)
  const glyphPngs = new Map<string, Uint8Array>();
  for (const a of allAssets) {
    if (a.type !== "glyph" || a.codepoint === null) continue;
    const p = assetPath(a.packId, a.id);
    if (!existsSync(p)) continue;
    glyphPngs.set(a.id, new Uint8Array(await readFile(p)));
  }
  const fontGlyphPngs = new Map<string, Map<string, Uint8Array>>();
  for (const a of allAssets) {
    if (a.type !== "font" || !a.fontMeta) continue;
    const meta = a.fontMeta as FontMeta | null;
    const glyphMap = meta && Array.isArray(meta.glyphMap) ? meta.glyphMap : [];
    const fontMap = new Map<string, Uint8Array>();
    const { dir } = fontDirPaths(a.packId, a.id);
    for (const g of glyphMap) {
      const filePath = join(dir, g.texture);
      if (!existsSync(filePath)) continue;
      fontMap.set(g.texture, new Uint8Array(await readFile(filePath)));
    }
    fontGlyphPngs.set(a.id, fontMap);
  }

  const { zipBytes, hash } = buildResourcePackZip(allAssets, glyphPngs, fontGlyphPngs, { finalCodepoints });
  await writeResourcePack(serverKeyId, hash, zipBytes);
  await db.update(serverKeys)
    .set({ resourcePackHash: hash, resourcePackUpdatedAt: new Date() })
    .where(eq(serverKeys.id, serverKeyId));
  await pruneOldResourcePacks(serverKeyId, KEEP_PACK_COUNT, hash);

  return { url: buildPackUrl(serverKeyId, hash), hash };
}

async function rebuildEmpty(serverKeyId: string): Promise<PackInfo> {
  const { zipBytes, hash } = buildResourcePackZip([], new Map(), new Map(), { finalCodepoints: new Map() });
  await writeResourcePack(serverKeyId, hash, zipBytes);
  await db.update(serverKeys)
    .set({ resourcePackHash: hash, resourcePackUpdatedAt: new Date() })
    .where(eq(serverKeys.id, serverKeyId));
  return { url: buildPackUrl(serverKeyId, hash), hash };
}
```

- [ ] **Step 2b : Adapter la signature de `buildResourcePackZip` (Task E3) puis re-run.**

- [ ] **Step 3 : Run après E3 — expect PASS**

- [ ] **Step 4 : Commit**

```bash
git add backend/src/lib/resourcePack.ts backend/src/lib/resourcePack.test.ts
git commit -m "refactor(backend): rebuildResourcePack multi-pack avec merger"
```

---

### Task E3 : `buildResourcePackZip` accepte un mapping codepoint final

**Files:**
- Modify: `backend/src/lib/resourcePackBuilder.ts`
- Modify: `backend/src/lib/resourcePackBuilder.test.ts`

- [ ] **Step 1 : Ajouter le paramètre `mergeResult: { finalCodepoints: Map<assetId, codepoint> }`**

```ts
export function buildResourcePackZip(
  assets: AssetRow[],
  glyphPngs: Map<string, Uint8Array>,
  fontGlyphPngs: Map<string, Map<string, Uint8Array>>,
  mergeResult: { finalCodepoints: Map<string, number> } = { finalCodepoints: new Map() },
): BuildResult {
  // Pour chaque glyph, remplacer assets[i].codepoint par mergeResult.finalCodepoints.get(assets[i].id) ?? assets[i].codepoint
  // avant de passer la liste à buildAssetIndex et buildDefaultFontJson.
  const remapped = assets.map((a) => {
    if (a.type !== "glyph" || a.codepoint === null) return a;
    const remappedCp = mergeResult.finalCodepoints.get(a.id);
    return remappedCp !== undefined ? { ...a, codepoint: remappedCp } : a;
  });
  // ... reste du pipeline utilise `remapped` au lieu de `assets`.
}
```

- [ ] **Step 2 : Adapter le test — au moins un cas avec finalCodepoints non vide**

```ts
it("respects mergeResult.finalCodepoints to remap glyph codepoints", () => {
  const a: AssetRow = { id: "a1", packId: "p1", type: "glyph", codepoint: 0xE000, /* ... */ } as never;
  const { zipBytes } = buildResourcePackZip([a], new Map([["a1", new Uint8Array([])]]), new Map(),
    { finalCodepoints: new Map([["a1", 0xE042]]) });
  // décompresser, vérifier le font.json default contient codepoint U+E042.
});
```

- [ ] **Step 3 : Run — expect PASS**

- [ ] **Step 4 : Commit**

```bash
git add backend/src/lib/resourcePackBuilder.ts backend/src/lib/resourcePackBuilder.test.ts
git commit -m "feat(backend): buildResourcePackZip accepte mergeResult"
```

---

### Task E4 : Adapter `fontJsonBuilder` + `assetIndexBuilder` au multi-pack

**Files:**
- Modify: `backend/src/lib/fontJsonBuilder.ts`
- Modify: `backend/src/lib/assetIndexBuilder.ts`

> Note : ces deux modules itèrent déjà sur `AssetRow[]` sans connaître la notion de pack. Le seul changement est que les codepoints reçus sont déjà remappés (depuis Task E3). Aucun changement de signature n'est nécessaire **si** Task E3 passe le `remapped` array.

- [ ] **Step 1 : Vérifier qu'aucun field `serverKeyId` n'est référencé**

`grep -n serverKeyId backend/src/lib/fontJsonBuilder.ts backend/src/lib/assetIndexBuilder.ts` doit ne renvoyer aucun résultat (les modules ne devraient toucher que `id`, `type`, `name`, `codepoint`, `height`, `width`, `ascent`, `contentWidth`, `fontMeta`).

- [ ] **Step 2 : Si des références existent, les remplacer par `packId`** (aucune attendue).

- [ ] **Step 3 : Run tests** (`fontJsonBuilder.test.ts`, `assetIndexBuilder.test.ts`) — expect PASS.

- [ ] **Step 4 : Commit (si modifications, sinon skip)**

---

### Task E5 : Test d'intégration multi-pack — un server_key bindé à 2 packs

**Files:**
- Modify: `backend/src/integration.test.ts`

- [ ] **Step 1 : Ajouter un cas multi-pack**

```ts
it("server_key bindé à 2 packs : RP contient les assets des 2 packs avec codepoints distincts", async () => {
  // Seed via les managers Plan 1B:
  //   - createNetwork
  //   - server_key + binding
  //   - pack A avec glyph "alpha" (cp 0xE000)
  //   - pack B avec glyph "beta" (cp 0xE000) — collision intentionnelle
  // POST /api/editor-session/{token}/packs/A/assets (upload PNG)
  // POST /api/editor-session/{token}/packs/B/assets (upload PNG)
  // GET  /api/resource-pack/{server_key_id}/{hash}.zip
  // Vérifier l'asset-index.json: alpha à 0xE000, beta à 0xE001 (remappé).
});
```

- [ ] **Step 2 : Run — expect PASS**

- [ ] **Step 3 : Commit**

```bash
git add backend/src/integration.test.ts
git commit -m "test(backend): integration multi-pack RP merge"
```

---

## Section F — WS Hub refactor

### Task F1 : `hello_ack.pack_hashes` via packBindings

**Files:**
- Modify: `backend/src/ws/hub.ts`
- Modify: `backend/src/ws/hub.test.ts`

- [ ] **Step 1 : Test**

```ts
it("hello_ack contains pack_hashes from packBindings ⨝ packs", async () => {
  // seed : network, server_key, 2 packs liés via packBindings (A: hash="ha", B: hash="hb")
  // simuler un message hello
  const { reply } = await handlePluginMessage("conn1", JSON.stringify({
    type: "hello", server_key: skKey, current_bundle_hash: "", local_pack_ids: [],
    minecraft_version: "1.21.4",
  }));
  const ack = JSON.parse(reply!);
  expect(ack.pack_hashes).toEqual({ [packAId]: "ha", [packBId]: "hb" });
});
```

- [ ] **Step 2 : Run — expect FAIL**

- [ ] **Step 3 : Modifier le bloc `hello` dans `hub.ts`**

Remplacer la query qui select `packBundles` par une jointure :

```ts
// Avant : const allPacks = await db.select({ packId, hash, deletedAt }).from(packBundles).where(eq(packBundles.serverId, keyId));
// Après :
import { listPacksForServerKey } from "../lib/packBindingManager";
const boundPacks = await listPacksForServerKey(keyId);     // exclut déjà deletedAt
const packHashesMap: Record<string, string> = {};
for (const p of boundPacks) packHashesMap[p.id] = p.hash;

const deletedRows = await db.select({ id: packs.id })
  .from(packs)
  .innerJoin(packBindings, eq(packBindings.packId, packs.id))
  .where(and(eq(packBindings.serverKeyId, keyId), isNotNull(packs.deletedAt)));
const deletedPackIds = deletedRows.map((r) => r.id);
```

Et pour le bloc qui crée des "minimal editor stubs" pour les `local_pack_ids` manquants :

```ts
const knownPackIds = new Set(boundPacks.map((p) => p.id));
const localPackIds = hello.local_pack_ids ?? [];
const missingPackIds = localPackIds.filter((id) => !knownPackIds.has(id));
if (missingPackIds.length > 0) {
  const { createPack } = await import("../lib/packStorage");
  const { createBinding } = await import("../lib/packBindingManager");
  const sk = (await db.select().from(serverKeys).where(eq(serverKeys.id, keyId)))[0];
  if (sk) {
    for (const packId of missingPackIds) {
      // packId reçu du plugin = id arbitraire pré-existant sur disque, on l'utilise tel quel.
      await createPack({ networkId: sk.networkId, name: packId, id: packId });
      await createBinding(keyId, packId);
    }
  }
}
```

Pour le bloc `if (needsSync) push bundle_available` :

```ts
if (needsSync) {
  for (const pack of boundPacks) {
    const available: BundleAvailableMessage = {
      type: "bundle_available",
      pack_id: pack.id,
      url: `${BUNDLE_BASE_URL}/api/bundles/${pack.id}`,
      hash: pack.hash,
      signature: "",
    };
    push.push(JSON.stringify(available));
  }
}
```

- [ ] **Step 4 : Run — expect PASS**

- [ ] **Step 5 : Commit**

```bash
git add backend/src/ws/hub.ts backend/src/ws/hub.test.ts
git commit -m "refactor(backend): hello_ack.pack_hashes via packBindings"
```

---

### Task F2 : `pushBundleAvailable(packId, hash)` résout les server_keys via packBindings

**Files:**
- Modify: `backend/src/ws/hub.ts`
- Modify: `backend/src/ws/hub.test.ts`

- [ ] **Step 1 : Test — broadcast à tous les conns dont le server_key est bindé au pack**

```ts
it("pushBundleAvailable broadcasts to all server_keys bound to the pack", async () => {
  // seed : 2 server_keys (sk1, sk2) du même network, 1 pack lié aux 2.
  // ajouter 2 connections fictives sur sk1 et sk2.
  // call pushBundleAvailable(packId, "h").
  // vérifier que chaque conn a reçu un bundle_available.
});
```

- [ ] **Step 2 : Modifier la signature**

```ts
import { listServerKeysForPack } from "../lib/packBindingManager";

export async function pushBundleAvailable(packId: string, hash: string): Promise<void> {
  // Freeze : on garde la logique conflit telle quelle (Plan 1B ne supprime pas pack_conflicts)
  // mais on doit la scoper par chaque server_key concerné individuellement.
  const serverKeysBound = await listServerKeysForPack(packId);
  if (serverKeysBound.length === 0) return;

  const url = `${BUNDLE_BASE_URL}/api/bundles/${packId}`;
  const payload = JSON.stringify({
    type: "bundle_available", pack_id: packId, url, hash, signature: "",
  } satisfies BundleAvailableMessage);

  for (const serverKeyId of serverKeysBound) {
    // Skip si conflit ouvert pour ce (server_key, pack)
    const open = await db.select({ id: packConflicts.id }).from(packConflicts).where(and(
      eq(packConflicts.serverId, serverKeyId),
      eq(packConflicts.packId, packId),
      isNull(packConflicts.resolvedAt),
    ));
    if (open.length > 0) continue;

    for (const [connId, sId] of connToServerId) {
      if (sId !== serverKeyId) continue;
      connSenders.get(connId)?.(payload);
    }
  }
}
```

- [ ] **Step 3 : Modifier de la même façon `broadcastDraftUpdate`** : utiliser `listServerKeysForPack(packId)` pour scoper le broadcast aux conns dont le server_key est bindé.

- [ ] **Step 4 : Modifier `pushPackDeleted` (si la signature actuelle prend `serverKeyId`)** : passer à `pushPackDeleted(packId)` et broadcast aux conns/éditeurs bindés.

- [ ] **Step 5 : Run all hub tests — expect PASS**

```bash
bun test src/ws/hub.test.ts
```

- [ ] **Step 6 : Commit**

```bash
git add backend/src/ws/hub.ts backend/src/ws/hub.test.ts
git commit -m "refactor(backend): pushBundleAvailable + broadcasts via packBindings"
```

---

### Task F3 : Backend full test sweep

**Files:** N/A

- [ ] **Step 1 : Run full backend test suite**

```bash
cd backend
bun test
```

Expected : tous les tests passent. Si certains restent rouges, regrouper les fixes en un commit final "fix(backend): adapter fixtures résiduelles Plan 1B".

- [ ] **Step 2 : Commit (si nécessaire)**

```bash
git add backend
git commit -m "fix(backend): adapter fixtures résiduelles Plan 1B"
```

---

## Section G — Editor adaptation

### Task G1 : `packApi.ts` — endpoints assets pack-scopés

**Files:**
- Modify: `editor/src/lib/packApi.ts`
- Modify: `editor/src/lib/packApi.test.ts` (si existe — créer sinon)

- [ ] **Step 1 : Modifier la signature des 6 fonctions assets**

```ts
// listAssets, uploadAsset, updateAsset, deleteAsset, duplicateAsset, etc.

export async function listAssets(token: string, packId: string, opts?: { type?: string; search?: string }) {
  const params = new URLSearchParams();
  if (opts?.type) params.set("type", opts.type);
  if (opts?.search) params.set("search", opts.search);
  const qs = params.toString() ? `?${params.toString()}` : "";
  const res = await fetch(`/api/editor-session/${token}/packs/${packId}/assets${qs}`);
  if (!res.ok) throw new Error(`listAssets failed: ${res.status}`);
  return (await res.json()).assets as AssetSummary[];
}

export async function uploadAsset(token: string, packId: string, form: FormData): Promise<AssetSummary> {
  const res = await fetch(`/api/editor-session/${token}/packs/${packId}/assets`, { method: "POST", body: form });
  if (!res.ok) throw new Error(`uploadAsset failed: ${res.status}`);
  return (await res.json()).asset;
}

// idem pour: getAsset, updateAsset, deleteAsset, duplicateAsset.
```

- [ ] **Step 2 : Adapter `packApi.test.ts`** : tous les `fetch.mock` URL patterns incluent `/packs/${packId}`.

- [ ] **Step 3 : Run — expect PASS**

```bash
cd editor
npx vitest run src/lib/packApi.test.ts
```

- [ ] **Step 4 : Commit**

```bash
git add editor/src/lib/packApi.ts editor/src/lib/packApi.test.ts
git commit -m "refactor(editor): packApi assets endpoints pack-scopés"
```

---

### Task G2 : `useAssetInit` lit `packId` du route param

**Files:**
- Modify: `editor/src/features/assets/useAssetInit.ts`
- Modify: `editor/src/features/assets/useAssetInit.test.tsx`

- [ ] **Step 1 : Modifier le hook**

```ts
import { useParams } from "@tanstack/react-router";

export function useAssetInit() {
  const { packId } = useParams({ strict: false });    // ou route-specific
  const token = useSessionStore((s) => s.accessToken);

  useEffect(() => {
    if (!token || !packId) return;
    listAssets(token, packId).then((list) => useAssetStore.getState().setAssets(list));
  }, [token, packId]);
}
```

- [ ] **Step 2 : Adapter le test** : injecter un mock de `useParams` retournant `{ packId: "pack_test" }`.

- [ ] **Step 3 : Run — expect PASS**

- [ ] **Step 4 : Commit**

```bash
git add editor/src/features/assets/useAssetInit.ts editor/src/features/assets/useAssetInit.test.tsx
git commit -m "refactor(editor): useAssetInit prend packId du route"
```

---

### Task G3 : `assetStore` reset sur switch de pack

**Files:**
- Modify: `editor/src/features/assets/assetStore.ts`
- Modify: `editor/src/features/assets/assetStore.test.ts`

- [ ] **Step 1 : Test**

```ts
it("setAssets remplace la liste (pas de merge entre packs)", () => {
  useAssetStore.getState().setAssets([{ id: "a1" } as AssetSummary]);
  useAssetStore.getState().setAssets([{ id: "b1" } as AssetSummary]);
  expect(useAssetStore.getState().assets.map((a) => a.id)).toEqual(["b1"]);
});
```

- [ ] **Step 2 : Vérifier que `setAssets` remplace bien (pas de merge implicite)** : c'est probablement déjà le cas. Si oui, juste documenter par le test.

- [ ] **Step 3 : Run — expect PASS**

- [ ] **Step 4 : Commit**

```bash
git add editor/src/features/assets/assetStore.test.ts
git commit -m "test(editor): assetStore.setAssets remplace la liste"
```

---

### Task G4 : `AssetsTab` lit `packId` du route param

**Files:**
- Modify: `editor/src/features/assets/AssetsTab.tsx`
- Modify: `editor/src/features/assets/AssetsTab.test.tsx`

- [ ] **Step 1 : Passer `packId` aux fonctions API de l'UI (Upload dialog, Import font dialog, Detail panel)**

```tsx
const { packId } = useParams({ strict: false });

<AssetUploadDialog packId={packId} ... />
<AssetImportFontDialog packId={packId} ... />
<AssetDetailPanel packId={packId} ... />
```

Et dans chaque dialog enfant : appeler `uploadAsset(token, packId, form)`, `updateAsset(token, packId, id, ...)`, etc.

- [ ] **Step 2 : Adapter les tests des dialogs** — fournir `packId` en prop.

- [ ] **Step 3 : Run tous les tests `assets/*.test.tsx` — expect PASS**

- [ ] **Step 4 : Commit**

```bash
git add editor/src/features/assets
git commit -m "refactor(editor): AssetsTab + dialogs prennent packId"
```

---

### Task G5 : URL textures `/api/textures/asset/:packId/:assetId`

**Files:**
- Modify: `editor/src/lib/textures.ts` (helper qui construit l'URL)
- Modify: `editor/src/lib/textures.test.ts`
- Modify: tout call site qui utilise l'URL `asset/{server_key_id}/...`

- [ ] **Step 1 : Modifier le helper**

```ts
export function assetTextureUrl(packId: string, assetId: string): string {
  return `/api/textures/asset/${packId}/${assetId}`;
}
```

- [ ] **Step 2 : Propager le param `packId` aux call sites** (chercher l'ancien helper avec `grep -r "textures/asset"`).

- [ ] **Step 3 : Run editor full suite**

```bash
cd editor
npx vitest run
```

- [ ] **Step 4 : Commit**

```bash
git add editor/src
git commit -m "refactor(editor): assetTextureUrl prend packId"
```

---

## Section H — Wrap-up

### Task H1 : Full backend suite verte

**Files:** N/A

- [ ] **Step 1 : Run `bun test` à la racine backend**

```bash
cd backend
bun test
```

Expected : 100% green. Aucun test skip non-explicite.

- [ ] **Step 2 : Si rouge, fix iteratively avant de continuer**

---

### Task H2 : Full editor suite verte

**Files:** N/A

- [ ] **Step 1 : Run `npx vitest run` à la racine editor**

```bash
cd editor
npx vitest run
```

Expected : 100% green. Le test E2E Playwright (`smoke.spec.ts`) doit aussi passer.

- [ ] **Step 2 : Si rouge, fix iteratively**

---

### Task H3 : Smoke test docker manuel

**Files:** N/A

- [ ] **Step 1 : `docker compose up`**

```bash
cd Artisan
docker compose up --build
```

- [ ] **Step 2 : Wipe disque dans le container backend (idempotent)**

```bash
docker compose exec backend rm -rf data/assets data/custom-items data/resource-packs
```

- [ ] **Step 3 : `/artisan link` depuis la console MC du container**

Vérifier le flux end-to-end :
- Plugin envoie `setup_request` → reçoit `setup_code`.
- Editor sur `http://localhost:5173/link?code=…` → claim.
- Backend crée Network + ServerKey + linkCode claimed.
- Plugin reçoit `link_confirmed` avec server_key.

- [ ] **Step 4 : `/artisan editor` puis trust dance dans l'éditeur**

- [ ] **Step 5 : Créer un pack via l'éditeur** (saver = PUT → creates pack + binding).

- [ ] **Step 6 : Uploader un asset glyph dans ce pack, vérifier qu'il apparaît dans le RP**

- [ ] **Step 7 : Documenter les éventuels bugs trouvés en commits "fix:" ciblés**

---

### Task H4 : Docs updates

**Files:**
- Modify: `Artisan/CLAUDE.md` (section Custom Items → endpoints, ajouter le préfixe `/packs/:packId/`)
- Modify: `.claude/skills/sync-docs/doc-impact-map.yaml`

- [ ] **Step 1 : Mettre à jour la table endpoints dans `Artisan/CLAUDE.md`**

Remplacer la section "Custom Items — endpoints et cache" en s'assurant que :
- `POST /api/editor-session/:token/assets` → `POST /api/editor-session/:token/packs/:packId/assets`
- (mêmes pour GET list, GET single, PATCH, POST duplicate, DELETE)
- `GET /api/textures/asset/:server_key_id/:asset_id` → `GET /api/textures/asset/:packId/:assetId`

Ajouter une nouvelle section "Modèle entités (Plan 1B)" qui résume :
- `Network` détient packs + server_keys
- `Pack` first-class (id, networkId, hash, filesJson, …)
- `PackBinding (server_key_id, pack_id)`
- `Assets` scopés au pack
- Build RP merge multi-pack avec ré-allocation de codepoints

- [ ] **Step 2 : Mettre à jour `doc-impact-map.yaml`**

Ajouter les triggers pour les nouveaux fichiers (`networkManager.ts`, `packStorage.ts`, `packBindingManager.ts`, `rpCodepointMerger.ts`) → section "Modèle entités" + table endpoints.

- [ ] **Step 3 : Run `/sync-docs` (optionnel, manuel)**

- [ ] **Step 4 : Commit**

```bash
git add Artisan/CLAUDE.md .claude/skills/sync-docs/doc-impact-map.yaml
git commit -m "docs(plan-1b): mise à jour endpoints + modèle entités"
```

---

## Self-review checklist (à exécuter après écriture, avant exécution)

**1. Spec coverage** — chaque bullet de §8 Phase 1 du spec a une section dédiée ?
- `Network` + `Membership` → Section A (A1, A2) + Section B (B1, B2). ✓
- `Pack` first-class → Section A (A4) + Section C. ✓
- `Assets` re-scopés + codepoint allocator + ré-alloc RP build → Sections A6, D, E. ✓
- `ServerKey` belongs to Network → Section A (A3). ✓
- `PackBinding` sans `branch_name` → Section A (A5) + Section C (C1, C2). ✓
- Setup flow → **hors scope Plan 1B**. ✓
- Retrait UI conflits → **hors scope Plan 1B**. ✓

**2. Placeholder scan** — chercher "TBD", "TODO", "implement later", "similar to Task N" → aucun (relire les sections C3, D6 attentivement).

**3. Type consistency** — `Pack` (singular) vs `packs` (table). `PackBinding` (entity) vs `packBindings` (table). `Network`/`networks`. Cohérent.

**4. Function signatures cross-task** —
- `pushBundleAvailable(packId, hash)` : signature changée en F2, appelée en C4 (deploy) — cohérent.
- `pushPackDeleted(packId)` : signature changée en F2, appelée en C6 — cohérent.
- `rebuildResourcePack(serverKeyId)` : signature **inchangée** (le scope reste server_key même si le data flow est multi-pack en interne) — cohérent.
- `assetPath(packId, assetId)` partout après D1 — cohérent.
- `allocateCodepoint(packId)` partout après D3 — cohérent.

**5. Migration realism** — la procédure de wipe est exécutée *une fois* à Task A8 entre la phase "tables ajoutées" (A1-A5) et la phase "tables transformées" (A6-A8). Iban accepte le wipe ; pas de migration data-preserving.

**6. Plan 1A interaction** — les tables `users`, `user_sessions`, `discord_accounts` sont préservées par le wipe. Pas de modification des routes auth.

---

## Notes d'exécution

- L'ordre des sections est important : A → B → C → D → E → F → G → H. Ne pas paralléliser sans précaution (D dépend de A6 ; E dépend de C, D ; F dépend de C, E ; G dépend de C, D, F).
- Iban exécute sur **Windows** : utiliser PowerShell pour les commandes pures Bash (`rm`, etc.) ou les remplacer par `Remove-Item` au besoin. Les commandes `bun`, `npx`, `git` fonctionnent identiques.
- Convention de commit : `feat(backend):` / `refactor(backend):` / `test(backend):` / `feat(editor):` / `docs(plan-1b):` — alignée avec le repo (cf. `git log --oneline -20`).
- Pas de `git push --force` ni `git reset --hard` sans confirmation explicite Iban.

---

**Fin du plan.**
