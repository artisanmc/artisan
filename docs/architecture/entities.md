# Modèle d'entités & données

> Source de vérité du schéma : `backend/src/db/schema.ts` (+ migrations dans `backend/drizzle/`).
> Ce doc décrit le modèle **courant** puis l'historique des phases qui y ont mené.

## Modèle courant (depuis 2026-06-03 — "Servers UX simplification")

**1 pack = 1 server_key** (relation **1:N**). `packs.serverKeyId` est NOT NULL avec FK cascade vers `server_keys.id`. La table `pack_bindings` (ancien M:N) a été supprimée.

```
User ── Membership ──┐
                     ▼
                 Network (id, name, tier="free")
                   │ owns
       ┌───────────┼───────────┐
       ▼                       ▼
   ServerKey (1) ───────────► Pack (N, first-class)
                              packs.serverKeyId (NOT NULL, FK cascade)
                              1 server_key → N packs

                              Pack → PackBranch ← PackCommit  (DAG, branches + commits)
```

- **Pack** : entité first-class — `id`, `networkId`, `serverKeyId`, `name`, `description`, `hash`, `filesJson`, `editorJson`, `deployedEditorJson`, `deletedAt`. `filesJson`/`editorJson`/`hash` = buffer éditeur **WIP** live.
- **server_keys.networkId** NOT NULL. À la création (claim / `/api/server-keys` / WS `setup_claim`), un Network par défaut `Network <prefix>` est auto-créé.
- **IDs server_key** (`generateServerKey` dans `lib/auth.ts`) : row id = `srv_<hex>` (utilisé dans les URLs `/networks/.../servers/srv_xxx`), clé plaintext = `sk_<hex>` (montrée une seule fois). Préfixes distincts volontairement pour ne pas confondre l'identifiant de ligne et le secret. Affichage UI via `displayServerLabel()`.
- **Assets per-pack** : `assets.packId`, codepoint allocator scopé au pack, disque `data/assets/{packId}/...`.
- **WS hub** : `hello_ack.pack_hashes` et `pushBundleAvailable(packId, hash)` résolvent les targets via `packs.serverKeyId`. `pushPackDeleted(packId)` idem.

### Branches + commits (DAG)

- **pack_commits** : `(id, packId, parentId, parentId2?, contentHash, filesJson, editorJson, authorUserId, message, createdAt)`. Snapshot complet par commit. Dedup par `(packId, contentHash)`. `parentId` nullable pour le commit racine (auto-créé à `createPack`). `parentId2` = 2ᵉ parent des merge commits, `null` sur les commits linéaires.
- **pack_branches** : `(packId, name, headCommitId, createdAt, updatedAt)`. Unique par `(packId, name)`. V1 : toujours `"main"` (pas d'UI branches).
- **WIP vs commit** : les plugins lisent **uniquement les commits** via `pack_branches.headCommitId` → `pack_commits.filesJson`. Le WIP (`packs.filesJson`) est le buffer éditeur.
- **LCA** : `branchStorage.findLCA(a, b)` — BFS bidirectionnel borné à 10 000 steps, walk `parentId` + `parentId2`.

### Merge sémantique par item (Phase 3)

- **Granularité** : par item top-level uniquement (`menus`, `commands`, `dialogs`, `templates`, `dataSources` indexés par `id` ; `i18nKeys`, `canvasLayout` en map ; scalaires `defaultLang`/`name`/`description`). Pas de merge field-level intra-item — un item conflictuel est résolu en entier ("use src" / "use dst").
- **Auto-merge** : changement non-collisionnel (un seul côté a touché l'item depuis le LCA) → entre dans `mergedState` sans conflit.
- **Conflit** : modify-modify OU delete-modify. Clés : `"<collection>:<id>"` ou `"scalar:<field>"`.
- **`mergeEngine.merge`** est pur (pas de DB), opère sur `EditorState` désérialisé, retourne `{ mergedState, conflicts[] }`. Sur conflit, `mergedState` garde `dst` par défaut (renderable avant résolution).
- **`assets[]` / `importedConnectors[]`** sont SKIP du merge (APIs propres, scope per-pack) — le merge commit hérite de `dst`.
- **contentHash collision** : `/resolve` ajoute un marker `merge-meta` (lca + src + dst commit ids) au contentHash pour différencier deux merges identiques (sinon viole `pack_commits_pack_content_uniq`).

## Auth & comptes

- Tables : `users`, `user_sessions`, `discord_accounts`.
- Cookies : `artisan_user_session` (HttpOnly, 30j → `user_sessions.id`), `artisan_oauth_state` (HttpOnly, 10min, anti-CSRF Discord).
- Distinct du flow trust dance (server_keys + editor_sessions) — les deux cookies coexistent.
- **`users.editor_language`** (TEXT nullable) : langue UI préférée. Source de vérité client = `localStorage["i18nextLng"]`. Logged-in : `authStore.hydrate()` lit depuis `GET /me` au boot (backend wins) ; changement via `EditorLangSwitcher` → PATCH fire-and-forget. Anonymous → localStorage only.

## Transferts & désaffectation

- **`network_transfers`** : `(token, network_id, initiated_by_user_id, expires_at, consumed_at, consumed_by_user_id, created_at)`. Token partageable 24h pour transférer la propriété d'un Network entier. Memberships swap **clean break** — ancien owner perd l'accès.
- **Server key deletion** : DELETE server_key (owner-only) → cascade les packs liés (`packs.serverKeyId` FK cascade). Le plugin perd la connexion au prochain hello.
- **Désaffectation sans transfert** : delete la server_key, re-setup côté plugin → l'auto-push (`local_push` au hello) recharge les packs dans le nouveau network. Pas de mutation cross-account.
- **Bootstrap auto-push** : au hello, les packs disque inconnus du backend (`disk_hash != "" && backend_hash == ""`) sont auto-pushés via `local_push` (plus de `/artisan pushLocal` manuel pour le first-time setup).

## Custom items cache

Cache disque : `backend/data/custom-items/{server_key_id}/{hash.txt, items.json, textures/}`. Peuplé par le plugin via WS `custom_items_bundle`.

**Invariant hash** : `CustomItemsManager.buildBundle()` calcule le hash inline depuis les items/textures déjà collectés (ne rappelle pas `computeHash()` séparément) — cohérence hash ↔ data.

---

## Historique des phases (récit — pas la référence courante)

L'évolution qui a mené au modèle ci-dessus. Conservé pour comprendre les migrations.

- **Plan 1A — accounts foundation** : `users`, `user_sessions`, `discord_accounts`.
- **Plan 1B — multi-server networks** : Pack devient first-class (plus de scope par `server_key`). Tables ajoutées : `networks`, `memberships`, `packs`, ~~`pack_bindings`~~. Table supprimée : `pack_bundles` (fusionnée dans `packs`). Le **M:N `pack_bindings`** (un pack ↔ N server_keys) a existé ici **puis a été supprimé en 2026-06-03** au profit du 1:N.
- **Phase 2 — branches + commits** : tables `pack_commits`, `pack_branches`. (À l'époque, `pack_bindings.branchName` ciblait une branche ; disparu avec `pack_bindings`.)
- **Phase 3 — merge sémantique par item** : column `pack_commits.parentId2` (DAG / LCA).
- **Accounts × networks UX** : claim login-required + smart-count, `network_transfers`, rotation/audit/allowlist server_key.
- **Servers UX simplification (2026-06-03)** : M:N → 1:N (`pack_bindings` supprimée, `packs.serverKeyId` NOT NULL). UI branches retirée (toujours `"main"` backend) → onglet History + Restore par commit. Sync multi-serveur = V2 hors-scope. Spec : `docs/superpowers/specs/2026-06-03-servers-ux-simplification-design.md`.
