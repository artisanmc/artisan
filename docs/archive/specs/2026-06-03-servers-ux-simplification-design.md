# Servers UX Simplification — Design

> Spec brainstormée le 2026-06-03 pour clarifier le modèle de gestion des servers et workspaces dans l'éditeur. Source de vérité pour le plan d'implémentation associé.

**Statut** — Spec validée. Implémentation phasée en 7 étapes (P1 → P7), chaque phase shippable indépendamment.

---

## 1. Goal

Le modèle actuel expose une relation M:N entre `server_keys` et `packs` (via `pack_bindings`), des branches + commits + promote/merge en surface, et un vocabulaire "server_key" qui ne correspond pas au mental model utilisateur. Conséquences en UX :

- Page `/networks/:id` confuse : cards de "server_keys" avec UUIDs techniques, bindings list ambigus, terme "server_key" dans tous les labels.
- Setup wizard et page Network mélangent les concepts.
- Branch toolbar en permanence dans le workspace top bar pour un cas d'usage (staging/prod) que personne n'utilise.

**Cette spec simplifie radicalement le modèle utilisateur** :

```
Network → Servers (1:N)
Server  → Workspaces (1:N — FK directe `packs.server_key_id`)
Server  → Modules (1:N, V1.5+)
```

Plus aucun M:N dans l'UI. Plus de "binding" comme concept exposé. Plus de branch toolbar. La branche `main` reste implicite en backend pour préserver le snapshot/restore via un onglet `History`.

## 2. Non-goals (explicit out-of-scope)

| Item | Raison |
|---|---|
| Sync d'un workspace entre plusieurs servers | V2. Le user duplique manuellement s'il veut le même contenu sur 2 servers. Une action explicite "Sync to..." viendra plus tard avec config manuelle puis automatique. |
| Branches multiples par workspace (Promote, Merge) | V2 si besoin réel émerge. Le code backend reste dormant. |
| Vue topology multi-server avec arêtes | Le canvas reste workspace-scoped. |
| Migration sophistiquée des bindings multi-server existants | Aucun user en prod aujourd'hui. La migration prend le 1ᵉʳ binding et DELETE les packs orphelins. |
| Refactoring du protocole WS plugin↔backend | Plugin envoie toujours `hello` avec une server_key, reçoit `bundle_available`. Aucun changement protocolaire. |

## 3. Nouveau modèle mental

```
User
 └── Network(s)          (membership-based access)
       └── Server(s)     (= 1 MC server physique, identité d'auth)
             ├── Workspace(s) (packs : menus + dialogs + commands)
             └── Module(s)    (shop, quests, etc. — V1.5+)
```

**Relations :**
- `User ↔ Network` : M:N via `memberships` (inchangé)
- `Network → Server` : 1:N (`server_keys.networkId` FK)
- `Server → Workspace` : **1:N (nouveau)** via `packs.serverKeyId` FK
- `Server → Module` : 1:N (à venir V1.5+, même pattern)

**Disparaît du langage user-facing :**
- "server_key" comme terme. Remplacé par "Server" partout.
- "binding" comme concept. Le workspace appartient au server, point.
- "branch" comme concept primaire. Reste en backend, exposé seulement via History (snapshot/restore).

## 4. Data model

### 4.1 Schema changes

```sql
ALTER TABLE packs ADD COLUMN server_key_id text NOT NULL
  REFERENCES server_keys(id) ON DELETE CASCADE;

DROP TABLE pack_bindings;
```

Tables touchées :
- `packs` : nouvelle colonne `server_key_id`, FK cascade. `network_id` reste (dénormalisé, simplifie les requêtes de permissions sans JOIN).
- `pack_bindings` : disparaît.
- `pack_branches`, `pack_commits` : inchangées. Chaque pack a sa branche `main` à la création (déjà le cas).

### 4.2 Endpoints qui disparaissent

- `POST /networks/:id/packs/:packId/bindings/:serverKeyId`
- `DELETE /networks/:id/packs/:packId/bindings/:serverKeyId`
- `PATCH /networks/:id/packs/:packId/bindings/:serverKeyId`
- `GET /networks/:id/packs/:packId/bindings`

### 4.3 Endpoints qui changent

- `POST /networks/:id/packs` : body exige maintenant `serverKeyId` (en plus de `name`, `description?`). 422 `missing_server_key` si absent. 403 si le `serverKeyId` n'appartient pas au network.
- `GET /networks/:id` : la réponse contient maintenant `packs` avec leur `serverKeyId` inline. Le frontend filtre par `activeServerId`.

### 4.4 Nouveau endpoint

- `GET /networks/:id/packs/:packId/commits/:commitId/content` → `{ commit, editor, files }` (même shape que `/branches/:branch/head` existant, mais par commit id). Pour le bouton Restore par-commit dans History tab.

### 4.5 WS hub impact

- `hello_ack.pack_hashes` : se construit en cherchant `packs WHERE server_key_id = thisKey.id`, plus en passant par `pack_bindings`.
- `pushBundleAvailable(packId)` : cherche `serverKeyId` directement sur la row pack, broadcast à la conn (unique maintenant) pour ce server_key.
- Protocole plugin↔backend : **inchangé**. Aucune migration plugin nécessaire.

## 5. Page /networks/:id refonte

### 5.1 Layout

```
┌─ Network: my_net ──────────────────────── ⚙ Settings ─┐
│                                                       │
│  ┌──────────────────────────────────────────────────┐ │
│  │ 🟢 Survival                                 [⋮]  │ │
│  │ 2 workspaces                                     │ │
│  │ ──────                                           │ │
│  │  📋 Shop                              → Open     │ │
│  │  📋 Lobby                             → Open     │ │
│  │  + New workspace                                 │ │
│  └──────────────────────────────────────────────────┘ │
│                                                       │
│  ┌──────────────────────────────────────────────────┐ │
│  │ ⚫ Hub                                       [⋮]  │ │
│  │ offline · last connected 3h ago                  │ │
│  │ ──────                                           │ │
│  │  📋 Welcome                           → Open     │ │
│  │  + New workspace                                 │ │
│  └──────────────────────────────────────────────────┘ │
│                                                       │
│  + Add server                                         │
│                                                       │
│  Members  (V2)                                        │
└───────────────────────────────────────────────────────┘
```

### 5.2 Server card anatomy

- **Header** : dot online/offline + label + kebab menu `[⋮]`
- **Subtitle** : "X workspaces" ; pour offline, ajoute "last connected ..." (depuis le hello audit log)
- **Liste workspaces** : chaque ligne cliquable → `/workspace/$packId`
- **CTA inline** : "+ New workspace" en bas de card

### 5.3 Kebab menu

```
⋮
├── Show server key…       (reveals plaintext key — modal one-time)
├── Rotate key…            (regenerates, modal one-time, see below)
├── ─────
├── Connection history     (opens ConnectionHistoryModal)
├── IP allowlist           (opens IpAllowlistModal)
├── ─────
└── Delete server…         (opens DeleteServerDialog with confirm-by-label)
```

### 5.4 Empty state

Quand le network n'a aucun server :

```
Aucun server.
Tape /artisan setup dans ta console MC pour en lier un.

  [+ Add server (manual)]   ← lien vers /setup wizard
```

### 5.5 Composants

- **Nouveaux** :
  - `ServerCard` — header + workspaces + kebab
  - `WorkspaceRow` — ligne workspace cliquable
  - `ServerKebabMenu` — DropdownMenu shadcn
  - `ConnectionHistoryModal` — extraction du HelloAuditPanel existant
  - `IpAllowlistModal` — extraction de l'AllowlistPanel existant
  - `DeleteServerDialog` — confirm-by-typing-label (réutilise le pattern de DeletePackDialog)
  - `NewServerModal` — label + submit
  - `NewWorkspaceModal` — name + description (serverKeyId passé en prop)
- **Survivants réutilisés** :
  - `RotatedKeyModal` — sert pour "Show key" ET "Rotate key" (modal one-time avec copy-to-clipboard)
- **Suppressions** :
  - L'ancienne section "Server Keys" inline avec collapse panels
  - L'ancienne section "Packs" séparée
  - Tout listing de bindings ; aucune référence au mot "binding"

## 6. Sidebar navigation

### 6.1 Layout

```
┌─ Sidebar ──────────────┐
│ [Mon Network ▾]        │   network dropdown (existant)
│                        │
│ [🟢 Survival ▾]        │   server dropdown (NOUVEAU, ≥2 servers)
│                        │
│ WORKSPACES             │
│  📋 Shop               │
│  📋 Lobby              │
│  + New workspace       │
│                        │
│ MODULES                │
│  (empty — V1.5+)       │
│                        │
│ ─────                  │
│ ⚙ Settings             │
└────────────────────────┘
```

### 6.2 Server selector behavior

- **0 server dans le network** : selector caché. Section workspaces affiche un CTA "Add a server to add workspaces" pointant vers `/setup`.
- **1 server** : selector caché (rien à choisir). Workspaces du seul server affichés.
- **≥2 servers** : dropdown visible sous le network dropdown. Sélection persistée dans un nouveau store `useServersStore` via `zustand/middleware/persist` (clé `activeServerId`).

### 6.3 Auto-pick + transitions

- À l'arrivée sur un network avec ≥2 servers : sélectionne le 1ᵉʳ alphabétiquement si aucun `activeServerId` n'est en cache, sinon le persisted.
- Création d'un nouveau server : auto-switch vers ce nouveau server.
- Suppression du server actif : switch vers le 1ᵉʳ restant, ou clear si plus aucun.

### 6.4 Composants

- `WorkspaceSidebar` (modifié) — ajoute le server dropdown + le filtre `pack.serverKeyId === activeServerId`
- `ServerDropdown` (nouveau) — copie du pattern `NetworkDropdown` existant
- `useServersStore` (nouveau) — `{ activeServerId: string | null, setActiveServerId(id) }`, persisted

## 7. Création / suppression

### 7.1 Server creation

Bouton **"+ Add server"** sur `/networks/:id`. Ouvre `NewServerModal` :

```
┌─ Add a server ────────────────────────────┐
│  Label                                    │
│  [_________________________________]      │
│           [Cancel]  [Create server]       │
└───────────────────────────────────────────┘
```

Submit → `POST /networks/:id/server-keys` (endpoint existant inchangé) → ouvre `RotatedKeyModal` avec la plaintext key + instructions "Paste in your plugin config.yml then run /artisan reload". Auto-switch sidebar sur le nouveau server.

### 7.2 Server deletion

Depuis le kebab d'une Server card → `DeleteServerDialog` :

```
┌─ Delete server "Survival" ?  ─────────────┐
│  This action is irreversible.             │
│  The plugin will lose access on next      │
│  hello. The following workspaces will     │
│  also be deleted :                        │
│   • Shop     (3 menus)                    │
│   • Lobby    (1 menu)                     │
│                                           │
│  Type the server label to confirm:        │
│  [_________________________________]      │
│         [Cancel]  [Delete server + 2 ws]  │
└───────────────────────────────────────────┘
```

Backend : `DELETE /networks/:id/server-keys/:keyId` (existant). Le FK cascade sur `packs` après la migration P1 suffit à supprimer les workspaces — pas besoin d'orchestrer côté frontend.

### 7.3 Workspace creation

Deux entry points :
- "+ New workspace" sur une Server card (serverKeyId implicite = celui de la card)
- "+ New workspace" dans la sidebar (serverKeyId = `activeServerId`)

Modal `NewWorkspaceModal` :

```
┌─ New workspace on "Survival" ─────────────┐
│  Name                                     │
│  [_________________________________]      │
│  Description (optional)                   │
│  [_________________________________]      │
│           [Cancel]  [Create]              │
└───────────────────────────────────────────┘
```

Submit → `POST /networks/:id/packs` avec `{ name, description?, serverKeyId }` → `navigate({ to: "/workspace/$packId", params })`.

### 7.4 Workspace deletion

**Inchangé.** `DeletePackDialog` + endpoints `DELETE /api/editor-session/:token/packs/:packId` (session) ou `DELETE /api/networks/:id/packs/:packId` (user-auth, à ajouter si pas déjà là).

### 7.5 Setup wizard reorder

L'ordre actuel (Network → Pack → ServerKey → Install) ne fonctionne plus puisque le pack a maintenant besoin de `serverKeyId` à la création. Nouveau flow :

| Step | Avant | Après |
|---|---|---|
| 1 | Network | Network (inchangé) |
| 2 | Pack | **Server** (générer + reveal key) |
| 3 | Server Key | **Workspace** (avec serverKeyId du step 2) |
| 4 | Install | Install (inchangé) |

Swap purement data-flow. Composants `Step2Server` / `Step3Workspace` réutilisent ~80% du code existant de `Step2Pack` / `Step3ServerKey`.

## 8. Branches → History tab

### 8.1 Workspace tabs after refactor

```
Avant : overview | translations | data-sources | servers
Après : overview | translations | data-sources | history
```

`servers` tab supprimé (info "this workspace is on server X" déplacée dans le header). `history` tab ajouté.

### 8.2 Workspace top bar simplifié

```
Avant : [← Back] | <name> | [lang] [↶↷] [Branch ▾] [Commit] [Promote] [Merge] [⋮] [Deploy]
Après : [← Back] | <name> · on 🟢 Survival | [lang] [↶↷] [🟢1] [⋮] [Deploy]
```

- Disparaît : `BranchSwitcher`, `DirtyBadge`, `Commit` button inline, `PromoteButton`, `MergeButton`, `HistoryPanel` inline, `CommitDialog` (déplacé dans History tab)
- Reste : `LangSwitcher`, `UndoRedoButtons`, `ServerStatusBadge` (simplifié pour 1 server), `TopBarKebabMenu`, `DeployButtons`
- Apparaît dans le header : "on 🟢 Survival" avec lien cliquable vers `/networks/:id`

### 8.3 History tab content

```
HISTORY                                            [Snapshot now]
────

▣ HEAD  ·  Deploy  ·  2 min ago  ·  iban           [Restore]
         "Deploy"
    Deploy  ·  1h ago  ·  iban                     [Restore]
         "Deploy"
    Manual snapshot  ·  3h ago  ·  iban            [Restore]
         "before refactor"
    Initial commit  ·  2d ago  ·  iban
    (current state — nothing to restore)
```

Implémentation : extension du `HistoryPanel` existant + bouton Restore par commit. "Snapshot now" ouvre le `CommitDialog` existant.

### 8.4 Restore action

Dual-mode, comme Deploy/Revert :
- **Session mode** : Restore HEAD-only utilise l'endpoint existant `getDeployedPack`. Restore d'un commit plus ancien désactivé en session mode V1 (le legacy session-snapshot ne sait restaurer que le head).
- **User-auth mode** : utilise le nouveau `GET /commits/:commitId/content` puis `replacePack(restored)`. Marche pour HEAD et tous les commits passés.

### 8.5 Dead code après cette section

Fichiers supprimés :
- `editor/src/features/branches/BranchSwitcher.tsx`
- `editor/src/features/branches/PromoteButton.tsx`
- `editor/src/features/branches/MergeButton.tsx`
- `editor/src/features/branches/MergeConflictModal.tsx`
- `editor/src/state/branchesStore.ts` (plus rien ne consomme `currentBranch` côté UI)

Survivants : `CommitDialog.tsx`, `HistoryPanel.tsx`, `editor/src/lib/api/branches.ts` (listCommits, createCommit, getBranchHead utilisés).

Backend code dormant (gardé pour V2) : `promote`, `merge-into`, `merge-into/.../resolve` endpoints + `mergeEngine.ts`. Pas utilisés en UI V1.

## 9. Migration

### 9.1 Stratégie

```sql
-- 1. Add nullable column
ALTER TABLE packs ADD COLUMN server_key_id text REFERENCES server_keys(id);

-- 2. Backfill : pick the oldest binding per pack
UPDATE packs p SET server_key_id = (
  SELECT pb.server_key_id
  FROM pack_bindings pb
  WHERE pb.pack_id = p.id
  ORDER BY pb.created_at ASC
  LIMIT 1
)
WHERE p.server_key_id IS NULL;

-- 3. DELETE orphan packs (no binding ever existed = unreachable from any plugin)
DELETE FROM packs WHERE server_key_id IS NULL;

-- 4. Enforce NOT NULL + cascade
ALTER TABLE packs ALTER COLUMN server_key_id SET NOT NULL;
ALTER TABLE packs ADD CONSTRAINT packs_server_key_fk
  FOREIGN KEY (server_key_id) REFERENCES server_keys(id) ON DELETE CASCADE;

-- 5. Drop the M:N table
DROP TABLE pack_bindings;
```

Migration générée via `bun run db:generate`. Commit le fichier `drizzle/00NN_*.sql`. Le backend Docker tourne `db:migrate` au boot → applique au prochain restart.

### 9.2 Cas multi-bindings (perte de données acceptée)

Si un pack a plusieurs bindings :
- Le 1ᵉʳ binding (par `createdAt` ASC) gagne, ses autres bindings sont silencieusement perdus.
- Aucun warning à l'utilisateur (V1 — pas de power user multi-binding en prod aujourd'hui).
- V2 pourra exposer un outil de migration sophistiqué si le besoin émerge.

## 10. i18n vocabulary

Mass-rename dans `editor/src/locales/{en,fr}.ts`.

| Avant | Après | EN | FR |
|---|---|---|---|
| `networkDetail.serverKeys` | `networkDetail.servers` | Servers | Serveurs |
| `networkDetail.deleteKey` | `networkDetail.deleteServer` | Delete server | Supprimer le serveur |
| `networkDetail.confirmDeleteKey` | `networkDetail.confirmDeleteServer` | Delete this server? N workspaces will also be deleted. | Supprimer ce serveur ? N workspaces seront aussi supprimés. |
| `networkDetail.serverKeyNoPacks` | DEL | — | — |
| `networkDetail.noServerKeys` | `networkDetail.noServers` | No server. Run `/artisan setup` in your MC console. | Aucun serveur. Tape `/artisan setup` dans ta console MC. |
| `networkDetail.helloAudit*` | déplacé sous `connectionHistoryModal.*` | (modal context) | (modal context) |
| `networkDetail.allowlist*` | déplacé sous `ipAllowlistModal.*` | (modal context) | (modal context) |
| `setupWizard.step2/step3.*` | swap step2 ↔ step3 keys | — | — |
| `servers.*` (workspace tab) | DEL | — | — |
| (nouveau) `newServerModal.*` | — | (modal labels) | — |
| (nouveau) `newWorkspaceModal.*` | — | (modal labels) | — |
| (nouveau) `serverCard.*` | — | (card labels) | — |
| (nouveau) `deleteServerDialog.*` | — | (dialog labels) | — |
| (nouveau) `historyTab.*` | — | (tab + snapshot/restore labels) | — |

Les clés `rotateKey`, `rotateRevealTitle/Hint/KeyLabel/ShownOnce` (RotatedKeyModal) restent — terme "key" légitime dans ce contexte technique (l'user copie-colle une clé).

Tests qui assertent par regex (`/Supprimer/i`, etc.) à mettre à jour ou remplacer par testids.

## 11. Tests

### Backend

- **Update** : `userNetworks.test.ts` — retire 4 cases de binding endpoints (create, delete, list, patch branch). Garde rotation, audit log, allowlist (inchangés en surface API).
- **Update** : `userPacks.test.ts` — `POST /packs` exige maintenant `serverKeyId` ; ajouter 422 `missing_server_key` + 403 cross-network.
- **Update** : `hub.test.ts` — `hello_ack.pack_hashes` cherche par `packs.serverKeyId` au lieu de `pack_bindings`.
- **Nouveau** : test du endpoint `GET /commits/:commitId/content` (200 avec editor+files, 404 commit inconnu, 403 non-membre).
- **Migration test** : un test isolé qui seed un dump pré-migration (avec multi-bindings), applique la migration Drizzle, vérifie le résultat (oldest binding wins, orphan packs deleted).

### Editor

- **Update** : `networks.$networkId.test.tsx` — assertions sur Server cards au lieu de server_keys + bindings. Test du kebab menu, des modals extraction.
- **Update** : tests qui mock `listPackBindings` deviennent caducs (deleted).
- **Update** : `ServerStatusBadge.test.tsx` — devient 1-server logic, pas N.
- **Nouveau** : tests pour `ServerCard`, `ConnectionHistoryModal`, `IpAllowlistModal`, `NewServerModal`, `NewWorkspaceModal`, `ServerDropdown`, History tab Restore action (HEAD + per-commit).

**Baseline cible** : au moins équivalent à la baseline actuelle (~971 éditeur + ~511 backend) après refactor — les suppressions sont compensées par les nouveaux composants.

## 12. Phasing

7 phases, chacune shippable séparément. Test suite verte entre chaque.

| Phase | Scope | Risque |
|---|---|---|
| **P1** | Schema migration + backend endpoints (`packs.serverKeyId` FK, drop binding endpoints, update pack creation + hub.ts) + tests backend | Moyen — migration |
| **P2** | Sidebar refactor : `ServerDropdown` + filter workspaces par server actif + `useServersStore` | Moyen |
| **P3** | `/networks/:id` refonte : Server cards + workspaces nichés + kebab menu + `NewServerModal` + `NewWorkspaceModal` | Moyen-haut |
| **P4** | Modals extraction : `ConnectionHistoryModal`, `IpAllowlistModal`, `DeleteServerDialog` (avec confirm-by-typing-label) | Bas |
| **P5** | Drop branch toolbar UI + ajout History tab + endpoint `GET /commits/:id/content` + Restore action dual-mode | Moyen |
| **P6** | `WorkspaceTopBarControls` cleanup (drop branch toolbar code, simplifie ServerStatusBadge) + workspace tabs (drop `servers` tab) | Bas |
| **P7** | Setup wizard step reorder + i18n vocabulary shift + delete dead components (BranchSwitcher, Promote, Merge, MergeConflictModal, branchesStore) | Bas |

Estimation grossière : P1 = 1 jour (migration + endpoints + tests), P2-P3 = 1 jour chacune, P4-P5 = 1 jour chacune, P6-P7 = ½ jour chacune. Total ~5-6 jours focused.

## 13. Future considerations (V2+)

**Sync workspaces entre servers**
- Action explicite "Sync this workspace to..." dans le kebab d'un workspace ou via un bouton dans le top bar
- Picker du server cible + nom du workspace cible (overwrite si existe avec confirmation, ou nouveau)
- V2.1 : auto-sync configurable (cron, hook on-deploy)
- V2.2 : conflict resolution si les 2 servers ont édité depuis le dernier sync (le merge engine dormant en backend peut être réveillé)

**Branches multiples + Promote/Merge**
- Réintroduire si un user réel demande staging/prod pattern
- Endpoints backend existent déjà, juste à recâbler en UI

**Modules (V1.5+)**
- Même pattern : 1 module instance = 1 server (FK directe)
- Module cards niches sous les workspaces sur la Server card

**Cross-server visibility**
- Une vue "tous les workspaces du network" qui transcende le server selector, utile quand le user a plein de servers
- Filtre/search sur tous les workspaces
- Hors scope V1 ; ajout simple plus tard si demande utilisateur émerge

**Server fingerprinting / multi-instance**
- Délibérément non-supporté en V1 (cf. spec server_key security model, commit e0d4b94a)
- Si V2 réintroduit multi-instance, la UI peut le surfacer comme "advanced" sans casser le modèle 1:1 par défaut
