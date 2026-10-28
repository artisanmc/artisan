# Multi-server, Networks & Branches — Exploration

**Status:** Exploration — no implementation commitment (to be picked up when it is time to plan)
**Date:** 2026-05-20
**Scope:** backend (data model + auth + sync) + editor (login + bindings/branches UI) + plugin (bindings config + pull/push semantics)

---

## TL;DR

The pack goes from a **server_key-scoped entity** to a **first-class entity** owned by a **Network** (group of MC servers). An MC server is represented by a `server_key` that **subscribes** to a pack on a given branch. Multi-server sync = N server_keys of the same Network bound to the same `(pack, branch)`. Test→prod = bindings on different branches.

The initial idea "store in GitHub" was explored and ruled out: GitHub does not help with semantic merge (which is custom anyway), complicates multi-server sync (webhooks vs direct WS), and its only real gain — public sharing/fork — was deprioritized. We keep a custom backend, with a native account system (Discord OAuth + email/password) since we no longer use GitHub as an identity provider either.

Artisan positioning: **freemium SaaS**. Subscription scoped to the Network. Stripe deferred to a future phase; Phases 1-3 are account-aware without billing.

Simplified sync conflict: **backend = source of truth**. Local YAML = cache + boot resilience. `/artisan pushLocal` to explicitly push FTP changes. No interactive resolution UI (the recently merged conflicts UI is to be removed, except deletion auto-resolve).

---

## 1. Context and motivation

The current architecture ties a `Pack` to a single `server_key`. Several use cases go beyond it:

- **Multi-server sync**: `survival + creative + lobby` share the same main menu without copy-pasting the config.
- **Test → prod pipeline**: a staging server iterates on a version, we promote to prod when validated, ideally with branches + git-like merge.
- **Future**: public pack ecosystem (fork, marketplace) — deprioritized but to keep in mind.

The triggering idea was: "what if we replaced the backend with GitHub?" — explored in depth, ruled out. See §10.

---

## 2. Strategic positioning

- **Freemium SaaS** (not self-hostable OSS, not paid-only)
- **Subscription scoped to the Network** (not the User). The same user can manage several Networks with independent plans.
- **Stripe deferred**: Phases 1-3 add accounts and the notion of tier, but without payment integration. Phase 4 (separate) integrates Stripe when the time comes.
- **Paywall axis not settled**: we build account-aware without active gating. Decision pushed to Phase 4.

---

## 3. Entity model

```
User (human identity, 1 per person)
  ├─ email, name, oauth_providers (Discord)
  └─ Membership → Networks (role: owner / admin)

Network (ownership + billing entity)
  ├─ id, name, tier="free", subscription_id?
  ├─ Members (user_id, role)
  ├─ Packs (N)
  └─ ServerKeys (N)

Pack (belongs to Network)
  ├─ id, name, description, visibility (private by default)
  ├─ Assets (scoped to the pack, see §6)
  └─ Branches (Phase 2+) with head_commit_hash

ServerKey (credential — N physical instances can share a key)
  └─ PackBindings (server_key_id, pack_id, branch_name)
```

### Notes

- **Pack no longer attaches to a server_key**: the `PackBinding` makes the link, many-to-many.
- **Multi-server sync** is free in the data model: several server_keys of the same Network bound to the same `(pack_id, branch)` → all receive the same `bundle_available`.
- **Membership** prepares future multi-collab (Phase 3+) without complicating Phase 1.

---

## 4. Anonymous vs logged-in editor

`/artisan editor` keeps opening an **anonymous** session via the trust dance. No login to type for daily edits. The account only comes into play at **setup**.

| Action | Anonymous | Logged-in |
|---|---|---|
| Edit the packs bound to *this* server_key | ✓ | ✓ |
| See / edit other packs of the Network | ✗ | ✓ |
| Create / delete a pack | ✗ | ✓ |
| Change bindings (`server_key → pack/branch`) | ✗ | ✓ |
| Manage members, billing | ✗ | ✓ (owner) |

Day to day, the admin types `/artisan editor`, is trust-confirmed, can edit the packs linked to their server — this is the current scenario. Login unlocks the "structural" operations (pack creation, binding switch, network management).

---

## 5. `server_key` semantics

A `server_key` is a **credential** representing a logical configuration slot. Three deployment patterns fall out of the same data model:

1. **Single server** — 1 server_key, 1 MC instance. Standard case.
2. **Clone-at-setup** — N distinct server_keys, bindings copied from a source at setup. Distinct so they can be individualized later (e.g. switch one of the three to the `dev` branch).
3. **Shared key (autoscale)** — N MC instances use the *same* server_key. Typical autoscaled infra case: a secret baked into the image, N pods connect with it. The DB makes no difference; the hub accepts N WS connections on the same key (see §11 — `connectionsByServer` must handle a `Set<WS>`).

Pattern 3 presupposes identical instances (image-based, immutable files). In case of divergence, "latest reporter wins" for conflict detection. Documented as "advanced".

---

## 6. Pack-scoped assets

Today: assets stored at `data/assets/{server_key_id}/...` with codepoint allocation per server_key.

New: `data/assets/{pack_id}/...`, codepoint allocation per pack. Assets travel with the pack on a cross-server_key share.

**Consequence on the resource pack zip**: today the assets of a server_key are merged into `assets/artisan/`. With pack scope, several packs on the same server_key may want to coexist in the RP. Solution: **on-the-fly merge with codepoint re-allocation** at RP build (the internal pack in the zip stays `assets/artisan/`, but the allocator accounts for collisions between packs). More complex than the naive "per-pack sub-namespaces" solution, but avoids breaking codepoint resolution in the existing YAMLs.

Migration: Iban accepts a full wipe (he only has a test environment). We rebuild clean.

---

## 7. Conflict model — backend = source of truth

The YAML files on the MC server's disk serve **two purposes only**:

1. **Resilience**: the server can boot and work if the backend is down.
2. **Cache**: what is served to players until the next backend sync.

### Normal flow (boot or /artisan reload)

```
plugin loads local → connects WS → hello { current_bundle_hash: H_local }
  if H_local == H_backend → no-op
  if H_local != H_backend → backend → bundle_available
    plugin downloads + overwrites local
    (1 one-line WARN log for post-mortem trace; no delay, no prompt)
```

### Backend unreachable

The plugin operates on local files indefinitely. Sync resumes when the backend comes back.

### Manual push (FTP case)

```
admin types: /artisan pushLocal <pack_id> | --all
  plugin reads the local files
  plugin → WS local_push { pack_id, files, hash }
  backend accepts without resolution → broadcasts bundle_available to the other instances
```

### pushLocal guarantees

- Creates the pack on the backend if it did not exist (dir added via FTP).
- Updates / creates the files present in the push.
- **Deletes nothing on the backend** (safe by default). To delete, go through the editor (DeletePackDialog).
- If concurrent editing in the editor: last-write-wins, the editor's WIP is overwritten. Rare edge case.

### Consequence: removal of the recent conflicts UI

The `sync-deletion` merge (commits `2e466927`, `d89dbe7b`, `05efa710`, `f50cb83e`) introduced an editor ↔ disk conflict resolution UI. **This UI is invalidated** by this model. To remove:

- `ConflictResolutionModal`, `ConflictBanner`, `conflictsStore`
- `/api/.../conflicts/*` endpoints
- `pack_conflicts` table
- WS messages `pack_conflict_detected` / `pack_conflict_resolved`
- Associated tests (`conflicts.test.ts`, `ConflictDetectionTest`, etc.)

**To keep**: auto-resolution on pack DELETE (`pack_deleted` flow), already consistent with the "editor is authoritative" principle.

### Not in conflict with the Phase 3 semantic merge

The resolution we remove is between `(local disk)` and `(backend)`. The Phase 3 semantic merge is between `(branch A)` and `(branch B)`, both in the backend — another problem, another UI, we keep it.

---

## 8. Phasing

### Phase 1 — Accounts + foundations (~2.5-3 wk)

- `User` (email, name, avatar, oauth_providers) — tier lives on the Network, not on the User
- Auth: email+password + Discord OAuth, session/JWT
- Login/signup UI in the editor
- `Network` + ownership + `Membership`
- `Pack` first-class (belongs to Network)
- `Assets` re-scoped to the pack + codepoint allocator refactor + on-the-fly re-alloc at RP build
- `ServerKey` belongs to Network
- `PackBinding (server_key, pack)` — without `branch_name` for now
- Setup flow: login → pick/create Network → pick/create Pack → clone-or-new server_key → trust dance
- Removal of the conflicts UI (backend-as-truth model)
- **Value delivered:** multi-server sync works. Native account. The system is ready for future billing without gating.

### Phase 2 — Branches + promotion (~1.5 wk)

- `pack_branches (pack_id, name, head_commit_hash)`
- `pack_commits (id, pack_id, parent_id, content_hash, author_user_id, message, createdAt)`
- `PackBinding` extended with `branch_name` (default `"main"`)
- Plugin config binds to a branch
- One-way promotion ("Promote dev → prod" UI — fast-forward, no conflict possible)
- History view in the editor
- **Value delivered:** test/prod pipeline. Native history via commits.

### Phase 3 — Semantic merge (~2-3 wk)

- Stable IDs on arrays (`Menu.title.layers`, slots, actions, dialog branches, ...) — data migration
- Field-level diff engine (schema-aware)
- Field-level merge engine with per-field conflict detection
- Per-field conflict resolution UI (take the dev or prod value for that field)
- **Value delivered:** complete git-like workflow, concurrent branches can be reconciled.

### Phase 4 — Billing (deferred, ~1.5 wk when triggered)

- Stripe integration (Customer per Network, not per User)
- Actionable `Network.tier` (free → paid)
- Feature gating by tier
- Customer portal
- **Paywall axis to settle when tackling this phase.**

---

## 9. Decisions made during the brainstorm

- **WIP vs commit**: separate. The editor "save" stays in the backend cache (live preview via WS). "Commit & deploy" will be an explicit action (in Phase 2+, where the commit really exists).
- **Per-pack assets** + codepoint allocator refactor with on-the-fly merge at RP build.
- **OAuth provider**: Discord first (target = MC admins). Email/password as fallback. GitHub ruled out (only had value as storage, which is custom).
- **Data migration**: aggressive. Iban has a single test environment, accepts a wipe to start clean.
- **Backend = source of truth** for sync conflicts. Local = cache + resilience. `/artisan pushLocal` for FTP cases.
- **`server_key` = credential**: autoscale natively supported (N instances, same key). No dedicated UI for this case, "advanced".

---

## 10. Alternatives considered (and ruled out)

### GitHub as backend storage

Initial idea. **Pros:** free versioning, native branches/merge, free public sharing/fork. **Cons (decisive):**

- Field-level semantic merge is custom anyway; text-based `git merge` does not help us (and risks generating conflicts where we would have none with a semantic merge).
- Multi-server sync via GitHub webhook is more complicated than direct WS broadcast.
- Adds external failure modes (API rate limits, revoked OAuth, repo permissions, etc.).
- The only real gain — public sharing/fork — was deprioritized by Iban (main motivations = versioning + fork; but versioning is built the same way in both cases, so only the sharing dimension weighed for GitHub).

**Verdict**: custom storage. GitHub OAuth-only was briefly considered as an identity provider, abandoned when Iban opted for native accounts (Discord OAuth is a better fit).

### One-way promotion only (no merge)

Considered as a Phase 2 simplification. Ruled out because Iban explicitly wants real diverging branches + merge for cases like "prod hotfix while a rework is in progress on dev". Phase 2 still keeps a one-way promotion (fast-forward) as an intermediate delivery, and the semantic merge comes in Phase 3.

### `server_key` strictly = 1 MC server

Considered. Ruled out because of the autoscale case: a big network can auto-deploy MC instances from an image and wants to bake a `server_key` into N deployments. The data model supports both (N:1 autoscale, 1:1 typical) without product complexity.

### Interactive boot-time resolution for conflicts (5s delay + prompt)

Considered. Ruled out — nobody watches the MC server console at boot; the delay would be theater code. See memory `feedback_no_theater_code`.

### Accounts at the User level (not Network)

Considered implicitly. Ruled out when Iban proposed `Network` as the billing unit: lets the same user manage several Networks with different plans.

---

## 11. Open points to settle at implementation-plan time

- **Email verification**: mandatory at signup or deferred?
- **Discord OAuth scope**: identity-only or email scope too (useful as fallback if Discord disconnects)?
- **Free tier limits**: can a user have N free Networks? Otherwise, do we impose 1 free Network per user and the others are paid?
- **Member invitation mechanism** (Phase 3+): email link, in-app invite by username, both?
- **First-server setup flow**: if the user creates their first Network, no Pack yet → do we guide to "create a first empty pack" or a welcome screen with templates?
- **Trust dance UX with shared server_key (autoscale)**: which instance shows the `trust_code`? Probable answer: none, the admin generates a trust_code via a dedicated endpoint when configuring autoscale.
- **Cross-pack asset dedup within a Network**: today dedup by contentHash within a server_key. With pack scope, two packs uploading the same image = two blobs? Or dedup at the Network level?
- **Multi-connection WS hub per server_key**: today `Map<serverId, WS>` 1:1. To extend to `Map<serverId, Set<WS>>` for autoscale. Minor fix but to validate.
- **Exact data wipe plan**: table drop order, initial state to recreate for manual E2E tests.

---

## 12. Out of scope of this exploration

- Marketplace UI / public pack discovery.
- Detailed implementation of the public visibility toggle.
- Multi-member collaboration UX (the data model carries `Membership` but the invites/permissions UI is pushed back).
- Stripe details (price points, plans, coupons, prorations).
- Field-level conflict resolution UI per field type (to design at Phase 3 time).

---

## Next step

When Iban is ready to move to "we build" mode: run a planning session on **Phase 1 only**, which will produce `docs/superpowers/plans/YYYY-MM-DD-multi-server-networks-phase-1.md` with the Drizzle schema, migration sequence, endpoints, detailed UI flows, and implementation task plan.
