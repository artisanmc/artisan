# Accounts-Only Cutover (bloc ①) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Supprimer le mode session anonyme (trust dance, surface REST `editor-session`, `sessionStore`) — l'édition web exige un compte ; `/artisan editor` devient informatif.

**Architecture:** Deux phases. **Phase A (additive, shippable seule)** : construire les jumeaux user-auth des 6 capacités session-only identifiées à l'inventaire (presence modules/data-sources, assets CRUD, rebuild resource-pack, draft co-edit, DELETE project, WS éditeur via **ticket éphémère**), et brancher l'éditeur dessus — le mode session continue de marcher pendant toute la phase. **Phase B (destructive)** : plugin (`/artisan editor` informatif via `editor_url` dans `hello_ack`, suppression `trusteditor`), éditeur (effacement de session.tsx/sessionStore/branches duales), backend (suppression router `editor-session`, handlers WS de session, table `editor_sessions` par migration, branche `sk:` d'ownerKey), docs.

**Tech Stack:** Bun + Hono + Drizzle (backend) · React 19 + Zustand + Vitest (éditeur) · Kotlin 2.0 / MockBukkit (plugin).

**Référence des décisions:** `docs/decisions/accounts-only-editing.md` (ADR) + entrées `Link`/`Membership` de `CONTEXT.md`. Inventaire exhaustif de la surface session : session du 2026-07-11 (deux rapports d'exploration, résumés dans les tasks).

## Global Constraints

- Backend : **TOUJOURS `bun run test`, JAMAIS `bun test`** (le direct wipe la DB dev). Tout changement `schema.ts` → migration `bun run db:generate` committée.
- Éditeur : `cd editor && npm test`. Strings UI react-i18next : clés `en.ts` + `fr.ts` même commit (les clés supprimées se retirent des DEUX fichiers).
- Plugin : `cd plugin && ./gradlew test`. Lang keys plugin : `lang/en.yml` + `fr.yml` en miroir.
- La sync plugin↔backend (server key, hello, bundles, `local_push`, custom items, resource pack) est **hors périmètre** — ne toucher aucun de ces chemins.
- Auth user = cookie `artisan_user_session` via le middleware existant (`c.get("user")` dans les routers `user*`). Toute nouvelle route user vérifie la **Membership** (user → network du project/serveur) — copier le pattern d'un handler existant de `userProjects.ts`/`userNetworks.ts`.
- Réponses des jumeaux = shapes IDENTIQUES aux routes session qu'ils remplacent (le client éditeur ne re-mappe pas).
- Docs same-commit : REST → `rest-endpoints.md` ; WS → `ws-protocol.md` ; commandes plugin → CLAUDE.md §Commandes + `docs-site/.../install-admin.md` ; API stable → CHANGELOG.
- Git : conventional commits, `git add` chemins explicites. Phase B = commits `feat!:`/`refactor!:` (breaking assumé pré-launch, noté au CHANGELOG).
- Ne JAMAIS supprimer une capacité session avant que son jumeau user soit shippé et consommé par l'éditeur (ordre des tasks = loi).

---

## Phase A — Jumeaux user-auth (additif, session intact)

### Task 1: Presence user-scoped — GET modules + data-sources par serveur

**Files:**
- Modify: `backend/src/routes/userNetworks.ts`
- Modify: `docs/architecture/rest-endpoints.md`, `CHANGELOG.md`
- Test: `backend/src/routes/userNetworks.test.ts` (étendre)

**Interfaces:**
- Consumes: middleware user existant du router (`c.get("user")`), tables `serverModules`/`serverDataSources` (peuplées par le plugin au hello — inchangées), pattern de check membership des handlers voisins.
- Produces: `GET /api/v1/networks/:networkId/servers/:serverId/modules` → `{ modules: [{ id, version }] }` et `GET .../data-sources` → `{ data_sources: [{ ref, schema_hint }] }` — shapes identiques aux routes session `/:token/modules` (editorSession.ts:125) et `/:token/data-sources` (:136). 404 si le serveur n'appartient pas au network ; 401/403 par le pattern membership existant.

- [ ] **Step 1: Lire le pattern** — ouvrir `userNetworks.ts`, repérer un handler GET avec check membership + résolution serveur (`serverKeys` du network) ; noter le helper d'auth exact.

- [ ] **Step 2: Tests qui échouent** (dans `userNetworks.test.ts`, en copiant le seeding user+network+serverKey d'un test voisin)

```typescript
describe("GET /:networkId/servers/:serverId/modules & /data-sources", () => {
  it("returns presence rows for a member", async () => {
    // seed: user + membership(owner) + network + serverKey + rows serverModules/serverDataSources
    // GET /api/v1/networks/<nid>/servers/<skid>/modules avec le cookie du user
    // expect 200, body.modules == [{id:"boutique", version:"1.0.0"}]
    // idem /data-sources → [{ref:"boutique:items", schema_hint:"id, name"}]
  });
  it("403/404 for a non-member or a server outside the network", async () => {
    // user sans membership → 403 (ou 404 selon le pattern du router — suivre le voisin)
    // serverKey d'un AUTRE network → 404
  });
});
```

Écrire ces tests EN ENTIER sur le harness du fichier (helpers de cookies/seed existants). Run: `cd backend && bun run test` → FAIL (routes absentes).

- [ ] **Step 3: Implémenter** — deux handlers dans `userNetworks.ts`, miroir exact des selects des routes session :

```typescript
router.get("/:networkId/servers/:serverId/modules", async (c) => {
  const user = c.get("user"); // + check membership sur :networkId, pattern voisin
  const sk = await serverInNetworkOr404(c); // resolve serverKey ∈ network (extraire si un helper n'existe pas déjà)
  const rows = await db.select().from(serverModules)
    .where(eq(serverModules.serverKeyId, sk.id));
  return c.json({ modules: rows.map((r) => ({ id: r.moduleId, version: r.version })) });
});

router.get("/:networkId/servers/:serverId/data-sources", async (c) => {
  // même squelette
  const rows = await db.select().from(serverDataSources)
    .where(eq(serverDataSources.serverKeyId, sk.id));
  return c.json({ data_sources: rows.map((r) => ({ ref: r.ref, schema_hint: r.schemaHint })) });
});
```

(adapter `serverInNetworkOr404` au vrai style du fichier — si les handlers voisins inline le check, inline pareil).

- [ ] **Step 4: GREEN + suite** — `bun run test` complet. Docs : ligne d'index dans `rest-endpoints.md`, entrée CHANGELOG `- user-scoped presence endpoints (modules/data-sources) per server`.

- [ ] **Step 5: Commit** — `rtk git add backend/src/routes/userNetworks.ts backend/src/routes/userNetworks.test.ts docs/architecture/rest-endpoints.md CHANGELOG.md && rtk git commit -m "feat(backend): user-scoped presence endpoints (modules + data-sources)"`

---

### Task 2: Assets CRUD + rebuild resource-pack user-scoped

**Files:**
- Modify: `backend/src/routes/assets.ts` (extraction des handlers), `backend/src/routes/resourcePack.ts`
- Create: `backend/src/routes/userAssets.ts`
- Modify: `backend/src/app.ts` (mounts), `docs/architecture/rest-endpoints.md`, `CHANGELOG.md`
- Test: `backend/src/routes/userAssets.test.ts` (create, en miroir de `assets.test.ts`)

**Interfaces:**
- Consumes: les handlers actuels de `assets.ts` (POST/PATCH/DELETE/`:id/duplicate` sous `/:token/projects/:projectId/assets`, gate `assertBound` :29-44) et `resourcePackAdminRouter` (POST `/:token/resource-pack/rebuild`).
- Produces: routes user MÊMES SHAPES : `POST|PATCH|DELETE /api/v1/user/projects/:projectId/assets[...]` + `POST /api/v1/user/networks/:networkId/servers/:serverId/resource-pack/rebuild`. Auth : cookie + membership (project → networkId → membership du user). Refactor : chaque handler d'assets extrait sa logique en fonction `async function handleAssetCreate(c, projectId, serverKeyId)`-style partagée entre les deux routers ; ZÉRO duplication de la logique métier.

- [ ] **Step 1: Tests qui échouent** — `userAssets.test.ts` : copier les cas de `assets.test.ts` (create/patch/delete/duplicate + un cas 403 non-membre), en remplaçant l'auth token par le cookie user et l'URL par `/api/v1/user/projects/:projectId/assets`. Run `bun run test` → FAIL.
- [ ] **Step 2: Refactor `assets.ts`** — extraire le corps de chaque handler en fonctions exportées `(c, {projectId, serverKeyId}) => Response` ; le router session les appelle après `assertBound` (comportement inchangé, tests session existants = filet).
- [ ] **Step 3: `userAssets.ts`** — router user : résout project → vérifie membership (pattern `userProjects.ts`) → appelle les mêmes fonctions. Mount dans `app.ts` : `app.route("/api/v1/user/projects", userAssetsRouter);` (vérifier la collision de paths avec `userProjectsRouter` — si le mount existant est `/api/v1/user/projects`, ajouter les routes assets DANS `userProjects.ts` plutôt qu'un router séparé ; suivre ce que le mount réel impose et le dire dans le rapport).
- [ ] **Step 4: rebuild resource-pack user** — dans `resourcePack.ts`, ajouter au router admin un handler user-scoped `POST /networks/:networkId/servers/:serverId/resource-pack/rebuild` monté sous `/api/v1/user` (même extraction : le corps du rebuild devient une fonction partagée). Test : un cas 200 membre + un 403 non-membre dans `userAssets.test.ts` ou `resourcePack.test.ts` étendu.
- [ ] **Step 5: GREEN + suite complète** (`bun run test`) ; docs + CHANGELOG ; commit `feat(backend): user-scoped assets CRUD + resource-pack rebuild`.

---

### Task 3: Draft co-edit + DELETE project user-scoped

**Files:**
- Modify: `backend/src/routes/userProjects.ts`
- Modify: `docs/architecture/rest-endpoints.md`, `CHANGELOG.md`
- Test: `backend/src/routes/userProjects.test.ts` (étendre)

**Interfaces:**
- Consumes: session POST `/:token/draft` (editorSession.ts:289 → `broadcastDraftUpdate`) et session DELETE `/:token/projects/:projectId` (:277 → soft-delete + `pushProjectDeleted`).
- Produces: `POST /api/v1/user/projects/:projectId/draft` (même body/broadcast) et `DELETE /api/v1/user/projects/:projectId` (soft-delete + `pushProjectDeleted`, mêmes effets : résolution auto des conflits ouverts comme la route session — copier son corps). Membership requise.

- [ ] **Step 1: Tests qui échouent** — deux tests dans `userProjects.test.ts` (harness du fichier) : draft → 200 + broadcast observé (mock/registre du hub comme le test session le fait) ; DELETE → 200, `deletedAt` non-null, non-membre → 403. RED via `bun run test`.
- [ ] **Step 2: Implémenter** — copier les corps des handlers session (mêmes appels `broadcastDraftUpdate`/`softDeleteProject`/`pushProjectDeleted`), auth membership.
- [ ] **Step 3: GREEN + suite ; docs + CHANGELOG ; commit** `feat(backend): user-scoped draft broadcast + project delete`.

---

### Task 4: WS éditeur par ticket éphémère (backend + client)

Le WS `/ws/editor?token=` est aujourd'hui authentifié par l'access token de session (app.ts:100-111). Remplacement : **ticket one-shot** minté en REST cookie-auth, consommé à l'upgrade. Le chemin `?token=` session RESTE en place (supprimé en Phase B).

**Files:**
- Create: `backend/src/lib/wsTickets.ts`
- Modify: `backend/src/app.ts` (route POST ticket + acceptation `?ticket=` sur `/ws/editor`), `backend/src/ws/hub.ts` (subscription multi-serverKeys d'une conn user)
- Modify: `editor/src/lib/editorWs.ts` (connexion par ticket), + le(s) call site(s) d'`EditorWs`
- Modify: `docs/architecture/ws-protocol.md`, `docs/architecture/rest-endpoints.md`, `CHANGELOG.md`
- Test: `backend/src/lib/wsTickets.test.ts` (create), `backend/src/ws/hub.test.ts` (étendre)

**Interfaces:**
- Produces backend: `POST /api/v1/user/ws-ticket` (cookie auth) → `{ ticket: string }` ; `wsTickets.issue(userId): string` / `wsTickets.redeem(ticket): { userId } | null` (one-shot, TTL 30 s, Map en mémoire — cohérent avec la posture single-instance actuelle, cf. audit prod-readiness). À l'upgrade `?ticket=` : redeem → charger les `serverKeyId` de tous les networks du user (memberships → networks → server_keys) → enregistrer la conn éditeur **abonnée à cet ensemble** ; les push existants (`broadcastDraftUpdate`, `pushModuleEvent`, `pushProjectDeleted` — hub.ts:570/603/654) délivrent à toute conn abonnée au serverKey concerné.
- Produces éditeur: `EditorWs` gagne un mode user : `EditorWs.connectAsUser(apiUrl)` — fetch le ticket (credentials include) puis ouvre `${WS_URL}/ws/editor?ticket=…` ; reconnexion = re-fetch d'un ticket neuf. Messages `session_trusted`/`session_expired` ignorés en mode user (ils meurent en Phase B).

- [ ] **Step 1: Test wsTickets qui échoue**

```typescript
import { describe, expect, it } from "bun:test";
import { issueTicket, redeemTicket, __resetTicketsForTests } from "./wsTickets";

describe("wsTickets", () => {
  it("issues and redeems one-shot", () => {
    __resetTicketsForTests();
    const t = issueTicket("user_1");
    expect(redeemTicket(t)).toEqual({ userId: "user_1" });
    expect(redeemTicket(t)).toBeNull(); // one-shot
  });
  it("expires after TTL", () => {
    __resetTicketsForTests();
    const t = issueTicket("user_1", /* nowMs */ 0);
    expect(redeemTicket(t, /* nowMs */ 31_000)).toBeNull();
  });
  it("unknown ticket → null", () => {
    expect(redeemTicket("nope")).toBeNull();
  });
});
```

- [ ] **Step 2: Implémenter `wsTickets.ts`**

```typescript
import { randomBytes } from "node:crypto";

const TTL_MS = 30_000;
const tickets = new Map<string, { userId: string; expiresAt: number }>();

export function issueTicket(userId: string, nowMs: number = Date.now()): string {
  const ticket = "wst_" + randomBytes(24).toString("base64url");
  tickets.set(ticket, { userId, expiresAt: nowMs + TTL_MS });
  return ticket;
}

export function redeemTicket(ticket: string, nowMs: number = Date.now()): { userId: string } | null {
  const entry = tickets.get(ticket);
  if (!entry) return null;
  tickets.delete(ticket); // one-shot, même si expiré
  if (entry.expiresAt < nowMs) return null;
  return { userId: entry.userId };
}

export function __resetTicketsForTests(): void {
  tickets.clear();
}
```

- [ ] **Step 3: Route + upgrade** — `POST /api/v1/user/ws-ticket` dans le router user approprié (auth cookie pattern) → `{ ticket: issueTicket(user.id) }`. Dans `app.ts` `/ws/editor` (lignes ~100-126) : si `?ticket=`, `redeemTicket` → 401 si null → résoudre l'ensemble `serverKeyIds` du user (une requête memberships→server_keys) → enregistrer la conn avec cet ensemble. Dans `hub.ts` : adapter le registre des conns éditeur pour porter `Set<serverKeyId>` (les conns session actuelles = singleton set — même structure, aucun comportement session changé) ; les trois push filtrent par appartenance au set. Étendre un test hub existant de `broadcastDraftUpdate` avec une conn multi-key.
- [ ] **Step 4: Client** — `editorWs.ts` : ajouter le mode user (fetch ticket → connect) ; brancher là où l'éditeur saura l'appeler en mode user (le call site session dans `session.tsx` reste intact ; le call site user arrive en Task 5/6 — exposer l'API, tester unitairement le fetch-then-connect avec fetch mocké si un test editorWs n'existe pas, sinon en créer un minimal).
- [ ] **Step 5: GREEN les 3 suites concernées (backend + éditeur) ; docs (ws-protocol § auth du WS éditeur, rest-endpoints ligne ws-ticket) + CHANGELOG ; commit** `feat: editor WS auth by one-shot user ticket (session token path kept until cutover)`.

---

### Task 5: L'éditeur consomme les jumeaux en mode user

**Files:**
- Modify: `editor/src/lib/api/modules.ts`, `editor/src/lib/api/dataSources.ts` (+ variantes user), `editor/src/state/modulesStore.ts`, `editor/src/state/serverDataSourcesStore.ts`
- Create: `editor/src/lib/api/userAssets.ts`
- Modify: `editor/src/features/assets/useAssetInit.ts`, `AssetUploadDialog.tsx`, `AssetDetailPanel.tsx`, `AssetImportFontDialog.tsx`, `editor/src/features/canvas/title/composer/LayerEditForm.tsx`, `editor/src/features/account/DeleteProjectDialog.tsx`
- Modify: `editor/src/routes/__root.tsx` (déclenchement user des stores presence + EditorWs user)
- Test: étendre `modules.test.ts`, `serverDataSourcesStore.test.ts`, `useAssetInit.test.tsx` (+ tests composants touchés)

**Interfaces:**
- Consumes: Tasks 1-4 (endpoints user + `EditorWs.connectAsUser`). Contexte serveur actif en mode user : `useNetworksStore.activeId` + `useServersStore.activeServerId` (persistés — cf. ProjectSidebar qui les résout déjà).
- Produces: `modulesStore.integrate(source)` et `serverDataSourcesStore.load(source)` avec `source = { token: string } | { networkId: string; serverId: string }` ; `lib/api/userAssets.ts` expose `listAssets/uploadAsset/patchAsset/deleteAsset/duplicateAsset` user-scoped (mêmes signatures de retour que la lib session). Les composants assets prennent le chemin user quand `!sessionToken && user` ; `__root.tsx` déclenche integrate/load/EditorWs-user quand `user && activeNetworkId && activeServerId` (effet dépendant des stores). Après cette task, **le mode user est fonctionnellement complet** (modules montés, sources visibles, assets éditables, WS live) — le mode session marche toujours.

- [ ] **Step 1: Tests d'abord** — étendre les tests des deux stores (source user → bonne URL fetchée), un test `userAssets` (mock fetch, shapes), un test `useAssetInit` mode user. RED.
- [ ] **Step 2: Implémenter** les variantes API + le paramètre `source` des stores + le branchement des composants + l'effet `__root.tsx`. Point d'attention : `m.$moduleId` (module boutique !) monte enfin en mode user — vérifier `resolveModule` ne suppose rien de session.
- [ ] **Step 3: GREEN suite éditeur complète ; commit** `feat(editor): user-auth mode reaches parity (presence, assets, live WS)`.

**→ Fin de Phase A : shippable.** Un utilisateur connecté SANS session plugin a tout ; les sessions marchent encore.

---

## Phase B — Bascule et suppression

### Task 6: Plugin — `/artisan editor` informatif, mort du trust dance

**Files:**
- Modify: `backend/src/ws/hub.ts` (hello_ack : + `editor_url`, + `network_name`), `backend/src/protocol.ts`
- Modify: `plugin/src/main/kotlin/net/artisanmc/plugin/provider/SyncedMenuProvider.kt` (stocke `editorUrl`/`networkName` du hello_ack ; SUPPRIME `requestEditorSession`/`revokeEditorSessions`/`sendTrustRequest`/`editorSessionCallback`/`lastTrustCode`/case `editor_session_ready`), `plugin/.../provider/MenuProvider.kt` (interface), `plugin/.../command/ArtisanCommand.kt`, `plugin/src/main/resources/lang/en.yml` + `fr.yml`, `plugin/src/main/resources/plugin.yml` (usage), `plugin/src/main/resources/config.yml` (`editor.console_only` reste)
- Modify: `docs/architecture/ws-protocol.md`, `CHANGELOG.md`
- Test: `plugin/.../EditorCommandTest.kt` (réécrire), SUPPRIMER `EditorSessionTest.kt`, étendre le test hello_ack existant (`SyncedMenuProviderTest.kt`)

**Interfaces:**
- Produces backend: `hello_ack` gagne `editor_url: string` (= `EDITOR_URL` env, déjà lu dans hub.ts:37) et `network_name: string` (network du serverKey). Les handlers `editor_session_request`/`editor_session_revoke`/`editor_trust_request` restent pour la Task 7 (suppression backend groupée) — ce task ne touche backend QUE le hello_ack.
- Produces plugin: `MenuProvider.editorInfo(): Pair<String, String>?` (url, networkName — null si pas encore connecté). `ArtisanCommand.editor()` : (i) keyless → délègue à `setup()` (le flow Link) avec un message `artisan.editor_not_linked_hint` ; (ii) linké → imprime `artisan.editor_linked` ("Ce serveur appartient au network **{network}** — édite sur {url}", clickable). `setup()` gagne le garde Q2 : `cfg.serverKey.isNotEmpty()` → `artisan.setup_already_linked` (refus informatif), return. `trusteditor` + `editor revoke` supprimés partout (dispatch, tab-complete ligne 37, interface, lang keys `usage_trusteditor`/`trust_sent`/`trust_no_permission`/`editor_revoked`/`editor_expires`/`editor_link_label` ; nouvelles clés `editor_linked`/`editor_not_linked_hint`/`setup_already_linked` en en+fr ; `usage_main`/`usage_editor` réécrites).

- [ ] **Step 1: Backend hello_ack** — ajouter les deux champs (protocol.ts + hub.ts hello handler : network via serverKey.networkId → networks.name) ; étendre le test hub hello_ack. `bun run test` GREEN. Commit `feat(backend): hello_ack carries editor_url + network_name`.
- [ ] **Step 2: Tests plugin qui échouent** — réécrire `EditorCommandTest.kt` :

```kotlin
class EditorCommandTest {
    // harness MockBukkit du fichier actuel (console sender)
    @Test fun `editor on a linked server prints the static editor url and network name`() {
        // provider fake dont editorInfo() retourne ("http://localhost:5173", "Test")
        // exécuter /artisan editor → capturer les messages → contient l'url et "Test"
    }
    @Test fun `editor on a keyless server routes to the link flow hint`() {
        // cfg.serverKey vide → message artisan.editor_not_linked_hint (et pas d'exception)
    }
    @Test fun `setup on a linked server is refused`() {
        // cfg.serverKey non vide → artisan.setup_already_linked, aucun SetupClient créé
    }
    @Test fun `trusteditor is no longer a subcommand`() {
        // /artisan trusteditor X → usage_main (fallback else)
    }
}
```

(compléter le harness sur le modèle du fichier existant avant suppression ; assertions par capture des messages du sender MockBukkit). RED.
- [ ] **Step 3: Implémenter** — provider stocke `editorUrl`/`networkName` depuis hello_ack (case existante :232) ; suppressions listées ; `editor()`/`setup()` réécrits ; lang en+fr ; plugin.yml usage `/artisan <menu <id>|reload|sync …|setup [CODE]|editor|pushLocal <id|--all>>`. Supprimer `EditorSessionTest.kt`.
- [ ] **Step 4: `./gradlew test` GREEN ; docs ws-protocol (hello_ack + messages session marqués "removed in Task 7") + CHANGELOG `feat!: /artisan editor is informative; trusteditor removed` ; commit.**

---

### Task 7: Backend — suppression de la surface session

**Files:**
- Delete: `backend/src/routes/editorSession.ts` + `editorSession.test.ts`
- Modify: `backend/src/app.ts` (démonter les 3 mounts `editor-session` :46/50/52 ; `/ws/editor` n'accepte plus `?token=`, ticket only), `backend/src/ws/hub.ts` (supprimer `editor_session_request`/`editor_session_revoke`/`editor_trust_request`, `findSessionByTrustCode`, `editorTokenToIp`/`trackEditorIp`, registre conns : plus de mode session), `backend/src/routes/assets.ts` (le router session disparaît — ne restent que les fonctions partagées consommées par `userAssets`), `backend/src/routes/resourcePack.ts` (idem admin session), `backend/src/lib/auth.ts` (supprimer `generateEditorToken`/`generateTrustCode`/`validateAccessToken`/`findSessionByTrustCode`/`validateEditorToken`), `backend/src/lib/ownerKey.ts` (branche `sk:` supprimée — assistant/ai = `user:` uniquement), `backend/src/protocol.ts` (types messages session), `backend/src/db/schema.ts` (DROP table `editor_sessions`) + migration `bun run db:generate` **committée**
- Modify: tests qui montaient des sessions : `modules/assistant/routes.test.ts`, `modules/ai/routes.test.ts` (auth cookie user), `ws/hub.test.ts` (purge cas session), `routes/assets.test.ts` (bascule sur userAssets ou suppression si redondant), `resourcePack.test.ts`, `integration.test.ts`
- Modify: `docs/architecture/rest-endpoints.md`, `ws-protocol.md`, `docs/architecture/entities.md` (table supprimée), `CHANGELOG.md`

**Interfaces:**
- Consumes: Phase A complète (chaque capacité supprimée a son jumeau consommé). Ordre STRICT : ce task NE COMMENCE que si Task 5 est mergée.
- Produces: plus aucune référence à `editor_sessions`/`validateAccessToken` dans `backend/src` (le grep final le prouve). `resolveOwnerKey` ne retourne plus que `user:<id>` — les conversations/credits historiques `sk:*` restent en DB, injoignables (assumé : données dev ; noter au CHANGELOG).

- [ ] **Step 1: Basculer les tests assistant/ai sur l'auth cookie** (RED→GREEN localement) — c'est le prérequis avant toute suppression.
- [ ] **Step 2: Suppressions** dans l'ordre : mounts app.ts → router/fichiers → handlers hub → helpers auth → ownerKey `sk:` → types protocol → schema + migration. Après chaque bloc, `bun run test` pour laisser le compilateur/les tests guider les références restantes.
- [ ] **Step 3: Vérification d'extinction** — `rtk grep -rn "editor_session\|editorSession\|validateAccessToken\|trust_code\|trustCode" backend/src` → uniquement des hits dans les migrations historiques. Suite complète GREEN.
- [ ] **Step 4: Docs (rest-endpoints purge la section editor-session ; ws-protocol purge les messages ; entities marque la table supprimée) + CHANGELOG `feat!: remove anonymous editor-session surface (accounts-only, ADR accounts-only-editing)` ; commit.**

---

### Task 8: Éditeur — effacement du mode session

**Files:**
- Delete: `editor/src/routes/session.tsx`, `editor/src/state/sessionStore.ts`, `TrustGatePage`/`TrustBanner` (+ leurs tests), `editor/src/lib/projectApi.ts` si session-only (vérifier)
- Modify (collapse des branches `if (token)`) : `routes/__root.tsx`, `routes/project.$projectId.tsx`, `routes/networks.$networkId.tsx`, `routes/networks.$networkId.servers.$serverId.tsx` (l'exception dual-auth du fix 2026-07-10 disparaît avec la cause), `routes/networks...projects.$projectId.tsx`, `features/project/useProjectLoader.ts`, `useProjectSaver.ts`, `persistProject.ts`, `pickReturnProject.ts`, `components/ProjectTopBarControls.tsx` (deploy/revert user-only), `components/ProjectSidebar.tsx` (isSessionMode disparaît), `features/canvas/useTextureInit.ts`, `features/assets/*` (chemins user-only), `features/assistant/*` (cookie-only), `state/modulesStore.ts`/`serverDataSourcesStore.ts` (source user-only), `state/authStore.ts` (guard logout), `lib/editorWs.ts` (mode ticket only), `lib/api/modules.ts`/`dataSources.ts`/`assistant.ts` (variantes session supprimées), locales `en.ts`+`fr.ts` (clés `sessionPage.*`, `trustBanner.*`, `trustGate.*` retirées)
- Modify: tous les tests listés à l'inventaire §7 éditeur (réécriture user-only ou suppression)
- Modify: `docs/architecture/editor-internals.md` (si le mode session y est décrit — vérifier), `docs/editor-ui-map.md`, `CHANGELOG.md`

**Interfaces:**
- Consumes: Tasks 5 et 7 mergées (les jumeaux sont là ; le backend session n'existe plus, donc tout reliquat session éditeur est un bug visible).
- Produces: `rtk grep -rn "sessionStore\|sessionToken\|accessToken" editor/src` → zéro hit hors historique/comments. Le flux post-login : `/` → `/networks` → project ; l'URL `/session?token=` renvoie vers `/login` (route supprimée → 404 catch-all ou redirect explicite — ajouter un redirect `/session` → `/login` avec un message "Les liens de session n'existent plus, connecte-toi" clé i18n en+fr, pour les vieux liens).
- **Découpage d'exécution** (fichier par fichier c'est ~25 fichiers) : commits intermédiaires par groupe (loader/saver ; topbar/deploy ; assets ; stores/WS ; routes/suppression finale), suite verte à chaque commit.

- [ ] **Step 1:** groupe loader/saver/persist/pickReturn (+ tests) — user-only. GREEN, commit.
- [ ] **Step 2:** groupe deploy/revert/topbar/sidebar (+ tests). GREEN, commit.
- [ ] **Step 3:** groupe assets/textures/assistant (+ tests). GREEN, commit.
- [ ] **Step 4:** groupe stores presence/WS/authStore/api libs (+ tests). GREEN, commit.
- [ ] **Step 5:** suppression session.tsx/sessionStore/trust UI/locales + redirect `/session`→`/login` + purge des branches routes + grep d'extinction + suite complète. Commit `feat!(editor): accounts-only — session mode removed`.

---

### Task 9: Docs finales + checklist de validation

**Files:**
- Modify: `docs-site/src/content/docs/getting-started/install-admin.md` (§2 setup = Link, §3 "Open the editor" réécrit sans trust, table commandes, troubleshooting), `docs-site/src/content/docs/editor/index.md`, `CLAUDE.md` (§Commandes : `editor`/`setup` décrits ; env `EDITOR_URL` si absent du tableau), `docs/architecture/rest-endpoints.md`/`ws-protocol.md` (relecture de cohérence finale)
- Create: `docs/superpowers/specs/2026-07-11-accounts-only-validation.md`

- [ ] **Step 1: Docs** — réécrire les sections listées (le flow documenté : install → `/artisan setup` → link web avec compte → éditer sur artisanmc.net ; `/artisan editor` = rappel d'URL).
- [ ] **Step 2: Checklist de validation** (contenu du fichier) :

```markdown
# Validation accounts-only — smoke manuel (Docker)

1. Serveur keyless : `/artisan editor` → hint + flow Link ; `/artisan setup` → code → claim web (compte requis) → clé poussée → connecté.
2. Serveur linké : `/artisan setup` → refus « déjà lié au network X » ; `/artisan editor` → URL éditeur + nom du network, aucun code.
3. Éditeur connecté (compte membre) : projects visibles, module Boutique monté (presence user), assets éditables, deploy OK, draft co-edit entre deux onglets, module_event live.
4. Non-membre : aucun accès au network/projects (403 propres, pas de boucle réseau).
5. `/session?token=whatever` → redirect login avec message.
6. `/artisan trusteditor X` → n'existe plus (usage).
7. Grep d'extinction backend + éditeur (cf. Tasks 7/8) revérifiés sur main.
```

- [ ] **Step 3: Commit** `docs: accounts-only cutover shipped — admin guide, protocol docs, validation checklist`.

---

## Vérification finale

- [ ] `cd backend && bun run test` / `cd editor && npm test` / `cd plugin && ./gradlew test` — tout vert.
- [ ] Greps d'extinction (Tasks 7/8) verts.
- [ ] Migration DROP `editor_sessions` committée.
- [ ] CHANGELOG : entrées Phase A (jumeaux) + Phase B (breaking).
- [ ] Checklist smoke Docker déroulée avec l'utilisateur.
- [ ] `/sync-docs` en clôture.

## Risques identifiés

- **Task 8 est le plus gros diff de l'épopée** (~25 fichiers) — d'où son découpage en 5 commits internes, suite verte à chaque étape.
- **Assistant/AI tenancy** : la suppression du `sk:` d'ownerKey orpheline les conversations/credits attribués aux server keys (données dev — assumé, noté CHANGELOG). Si des credits réels existaient déjà, STOP et remonter avant Task 7.
- **WS cookie vs ticket** : le ticket évite les pièges SameSite sur l'upgrade WS ; Map en mémoire = même posture single-instance que le reste (audit prod-readiness la traite globalement).
- **Vieux liens `/session?token=`** dans des historiques de chat Minecraft : le redirect + message de la Task 8 les rend inoffensifs.
