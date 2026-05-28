# Accounts × Networks UX — Design

**Date** : 2026-05-22
**Status** : Approved, ready for planning
**Author** : Iban + Claude (brainstorming session)

## Context

Plan 1A (accounts foundation), 1B (Multi-server Networks), 1C (logged-in pack management), Phase 2 (branches), Phase 3 (merge) sont tous mergés sur `main`. Côté backend, le modèle est complet : `users`, `user_sessions`, `discord_accounts`, `networks`, `memberships`, `packs`, `pack_bindings`, `server_keys`, `editor_sessions`. Côté éditeur, les routes auth (`/login`, `/signup`, `/account`) et la session éditeur (trust dance via `/session?token=XXX`) fonctionnent.

**Le trou** : la commande `/artisan setup` du plugin crée des Networks **anonymes** (aucun login requis, le `claim` ne demande pas de cookie user). Conséquences :

- Un setup réussi laisse un Network sans owner Membership → invisible dans le futur `/networks`.
- Les routes `/api/networks/*` exposent les Networks de l'utilisateur loggué via `memberships`. Networks anonymes inaccessibles.
- Aucune UI éditeur pour : lister ses Networks, en créer un, voir/manager les server_keys, transférer la propriété.
- Aucun mécanisme pour bootstrapper l'éditeur avec des packs déjà présents sur disque (le plugin a un `local_push` mais c'est manuel via `/artisan pushLocal`).

## Decisions (depuis le brainstorming)

| # | Décision | Justification |
|---|---|---|
| 1 | **Hard break** sur le legacy `/artisan setup` : login requis | Projet jeune, peu d'utilisateurs, on évite la dette et les "ghost networks" |
| 2 | Lien `/link?code=...` non-loggué → redirect `/login?next=...` | Reuse de l'UI auth existante, code TTL 10min couvre le détour |
| 3 | Choix network destination **smart par count** | 0 → auto-crée, 1 → confirme, 2+ → picker |
| 4 | UI Networks via routes dédiées `/networks`, `/networks/:id`, `/networks/:id/settings` | Architecture qui scale ; `/account` reste léger (profil) |
| 5 | Memberships UI **déférée** (section "1 member, you" + placeholder) | Iban solo pour l'instant, table existe déjà côté backend |
| 6 | Transfert via **commande dédiée UI** (pas `/artisan setup`) | Sépare la responsabilité : setup = ajout, transfer = changement de propriété |
| 7 | Transfert = **Network entier** (server_keys + packs en bloc) | Granularité grosse maille, évite la complexité de mutation cross-network par pack |
| 8 | Désaffectation d'un serveur sans transfert = delete server_key + re-setup | Réutilise l'auto-push bootstrap, pas de logique destructive cross-account |
| 9 | Bootstrap **auto-push au hello** | Plus de `/artisan pushLocal` manuel pour le first-time |
| 10 | Initiation transfert = **lien partageable** (TTL 24h), pas d'email transactionnel | MVP minimal, pas d'infra SMTP/Resend à mettre en place |

## Architecture

### Flow 1 — Setup d'un nouveau serveur (`/artisan setup`)

```
[Plugin]  /artisan setup
   ↓ setup_request (WS) → backend génère link_code (TTL 10min)
   ↓ Plugin chat : lien cliquable → ${EDITOR_URL}/link?code=ABC123

[Browser hits /link?code=ABC123]
   ↓ Auth gate :
      • Pas de cookie `artisan_user_session` → redirect /login?next=/link?code=ABC123
      • Loggué → continue
   ↓ Fetch GET /api/networks → wizard claim :
      • 0 networks → auto-crée "Mon Network", proceed
      • 1 network  → "Lier ce serveur à <name> ?" + bouton confirm
      • 2+         → picker (cards) + bouton "+ Créer nouveau"

[On submit]
   ↓ POST /api/link/:code/claim { network_id }
   ↓ Backend :
      • Require user_session cookie (401 sinon)
      • Membership check sur network_id (403 sinon)
      • Crée server_key dans le network choisi (label = "Server <prefix>")
      • Broadcast link_confirmed (WS) au plugin
   ↓ Plugin écrit server_key dans config.yml + reinit
```

**Erreurs gérées** :
- Code expiré → page : "Lien expiré, retape `/artisan setup`"
- Code déjà claim → "Ce setup a déjà été utilisé"
- Pas membre du network choisi → 403 + message UI
- 401 si pas de cookie → redirect /login (couvre le cas session expirée pendant le wizard)

### Flow 2 — Transfert d'un Network entier

```
[Initiateur — owner actuel]
   /networks/:id/settings → section "Transfer ownership"
   Affiche un avertissement : "Transférer le Network <name> donnera à un autre user
   la propriété de X packs + Y server_keys. Vous perdrez tous vos droits dessus."
   Bouton "Générer un lien de transfert"

[Backend]
   POST /api/networks/:id/transfer/init
   → INSERT INTO network_transfers (token, networkId, initiatedByUserId, expiresAt = now+24h)
   → Return { url: "${EDITOR_URL}/transfer?token=XXX", expiresAt }

[Initiateur copie le lien et le partage hors plateforme (Discord/email)]

[Destinataire ouvre /transfer?token=XXX]
   ↓ Auth gate (login required)
   ↓ Fetch GET /api/networks/transfer/:token
      → Return { networkName, packCount, serverKeyCount, initiatedBy: email } ou 410 si expired/consumed
   ↓ Page confirmation : "Acceptez-vous de devenir owner de <networkName> ?"
   ↓ Bouton "Accepter"

[On submit]
   POST /api/networks/transfer/:token/accept
   → Backend :
     • Valide token (not expired, not consumed)
     • DELETE FROM memberships WHERE networkId = X (ancien owner perd accès — clean break)
     • INSERT INTO memberships (userId = current, networkId = X, role = 'owner')
     • UPDATE network_transfers SET consumedAt = NOW(), consumedByUserId = current
   → Plugin runtime intact : les server_keys n'ont pas changé, les plugins continuent leur WS
```

### Flow 3 — Désaffecter un serveur sans transférer le Network

```
[Owner — décide qu'un de ses servers ne fait plus partie de son network]
   /networks/:id → liste des server_keys → bouton "Delete" sur le key concerné
   DELETE /api/networks/:id/server-keys/:keyId
   → Backend : DELETE pack_bindings WHERE serverKeyId = X, DELETE server_keys WHERE id = X
   → Plugin sur ce serveur perd la connexion (backend ne reconnaît plus la clé au prochain hello)

[Nouveau admin sur le serveur récupéré]
   /artisan setup → claim normal dans SON network
   → Auto-push bootstrap (Flow 4) recharge les packs disque dans le nouveau network
   → L'ancien owner garde sa copie des packs intacts dans son network
```

### Flow 4 — Bootstrap auto-push au hello

Modification du handler `hello` côté **plugin** :

```kotlin
// SyncedMenuProvider.handleHelloAck (après réception du hello_ack)
val packHashes = ackPackHashes  // de hello_ack.pack_hashes
for (packDir in packsDir.listFiles { it.isDirectory && !it.name.startsWith(".") }) {
    val packId = packDir.name
    val diskHash = BundleHasher.hash(packDir)
    if (diskHash == "") continue  // pack disque vide → skip
    val backendHash = packHashes[packId] ?: ""
    if (backendHash == "") {
        // Backend ne connaît pas ce pack OU il est vide côté backend → auto-push
        sendLocalPush(packId, packDir)
        logger?.info("Auto-pushed local pack '$packId' (backend was empty)")
    } else if (backendHash != diskHash) {
        // Les deux ont du contenu différent → conflit, ne pas écraser
        logger?.warning("Local pack '$packId' diverges from backend — NOT auto-pushed (use /artisan pushLocal to force)")
    }
}
```

**Backend** : le handler `local_push` existant (Plan 1C) est ré-utilisé tel quel — il créé pack + binding si manquant, upsert content, broadcast `bundle_available`.

## UI éditeur

| Route | Contenu | Status |
|---|---|---|
| `/` | Pas loggué → redirect `/login`. Loggué → render `/networks` (ou redirect) | **REVAMP** |
| `/login` | Email + password OU "Continue with Discord". Lien "Créer un compte". Support `?next=` après login | **EXTEND** (`?next=`) |
| `/signup` | Existant | Pas de changement |
| `/account` | Profil user (email, name, avatar, logout). Lien "Mes Networks" → `/networks` | **EXTEND** (lien) |
| `/networks` | **NEW** — Liste des networks de l'user (`GET /api/networks`). Une carte par network avec : name, nb packs, nb server_keys. Bouton "+ Créer un Network" |
| `/networks/:id` | **NEW** — Détail : sections Packs (liens vers `/pack/:id`), Server Keys (liste + bouton "Generate new key" + delete par key), Members (read-only "1 member: you" + placeholder "Invitations coming soon") |
| `/networks/:id/settings` | **NEW** — Rename, Delete, Transfer ownership |
| `/link?code=ABC` | **REVAMP** — Wizard claim (Flow 1) |
| `/transfer?token=XXX` | **NEW** — Page accept transfer (Flow 2) |
| `/session?token=XYZ` | **EXTEND** — Header banner "Network: <name>" (récupéré via `validateEditorSession` qui retourne désormais `networkId`) |

## Backend changes

### Endpoints modifiés

| Endpoint | Changement |
|---|---|
| `POST /api/link/:code/claim` | Require `artisan_user_session` cookie. Body `{network_id?}`. Si absent : 0 networks → auto-crée "Mon Network", 1 → use it, 2+ → 400 `must_choose_network`. Check membership (403). Supprime le code path "anonymous network auto-create". |
| `GET /api/editor-session/:token` | Ajoute `network_id` à la réponse |
| `GET /api/networks` | Existant — pas de changement |
| `POST /api/networks` | Existant — pas de changement |

### Endpoints nouveaux

| Endpoint | Description |
|---|---|
| `POST /api/networks/:id/transfer/init` | Owner-only. Crée un `network_transfers` row. Returns `{url, expiresAt}`. |
| `GET /api/networks/transfer/:token` | Public auth-required. Returns infos sur le transfert pour la page confirmation, ou 410 si expiré/consommé. |
| `POST /api/networks/transfer/:token/accept` | Auth required. Swap memberships : ancien → supprimé, nouveau → owner. Marque `consumedAt`. |
| `DELETE /api/networks/:id/server-keys/:keyId` | Owner-only. Delete server_key + cascade pack_bindings. |

### Nouvelle table

```sql
CREATE TABLE network_transfers (
    token TEXT PRIMARY KEY,
    network_id TEXT NOT NULL REFERENCES networks(id) ON DELETE CASCADE,
    initiated_by_user_id TEXT NOT NULL REFERENCES users(id),
    expires_at TIMESTAMP NOT NULL,
    consumed_at TIMESTAMP,
    consumed_by_user_id TEXT REFERENCES users(id),
    created_at TIMESTAMP NOT NULL
);
CREATE INDEX network_transfers_network_idx ON network_transfers(network_id);
```

Tokens : 32 chars random, base62 (réutilise `generateEditorToken` ou helper équivalent).

### Plugin (Kotlin) changes

- `SyncedMenuProvider.handleHelloAck` : après réception du `hello_ack`, walk `packsDir`, pour chaque pack non-vide en disque mais vide côté backend → auto-send `local_push` (Flow 4).
- Aucun changement à `/artisan setup` (côté plugin) — la commande envoie déjà `setup_request` au backend, le backend gère le reste.

## Migration de l'existant

État actuel d'Iban (le seul utilisateur affecté pour l'instant) :
- 1 Network anonyme `net_ebe57cf700fd` (créé via legacy `/artisan setup` aujourd'hui)
- 1 server_key dedans
- 1 pack `test` avec contenu
- Aucune membership row → sans intervention, Iban perdrait l'accès après le hard break

**Option retenue** : SQL one-shot dans la session de déploiement, à exécuter manuellement après merge :

```sql
-- À adapter avec le user_id réel d'Iban
INSERT INTO memberships (user_id, network_id, role, created_at)
VALUES ('<iban_user_id>', 'net_ebe57cf700fd', 'owner', NOW());
```

Documenté dans le plan d'implémentation (étape finale).

## Tests

### Backend

- `claim 401` sans cookie `artisan_user_session`
- `claim` auto-crée Network si user a 0 networks
- `claim 400 must_choose_network` si user a 2+ networks et body sans `network_id`
- `claim 403` si `network_id` appartient à un autre user (pas de membership)
- `claim` crée server_key dans le network choisi + retourne success
- `transfer/init` owner-only (403 sinon)
- `transfer/accept` swap memberships correctement
- `transfer/accept 410` si token expired ou consommé
- `transfer/accept` réussit même si user a 0 networks préalablement (devient owner d'un Network existant)
- `DELETE server-keys` cascade les bindings, ne touche pas les packs (ils peuvent rester bound à d'autres server_keys ou orphelins)
- Hello handler : auto-push reçu si disque non-vide + backend vide

### Editor

- `/link?code=ABC` redirect `/login?next=/link?code=ABC` si pas authentifié
- Après login, retour sur `/link` et claim normal
- `/link` smart count : 0 networks (auto-create), 1 (confirm), 2+ (picker)
- `/networks` liste + état loading + état empty + état error
- `/networks/:id` rendu (packs, server_keys, members)
- `/networks/:id/settings` rename + delete + transfer init
- `/transfer?token=XXX` flow accept end-to-end (mock backend)
- `/transfer` 410 page si token invalide

### Plugin

- Au hello, pack avec disque non-vide + `pack_hashes[id] = ""` → envoie `local_push`
- Au hello, pack avec disque == backend → no-op
- Au hello, pack avec disque ≠ backend (les deux non-vides) → WARN, pas d'auto-push

## Out of scope (post-MVP)

- **UI Memberships** (invitations, roles editor/viewer). Table existe déjà côté DB. À ajouter quand un user demande la collaboration multi-personne.
- **Email transactionnel** pour transferts et invitations. MVP utilise lien partageable manuellement.
- **Sidebar global** network switcher (style Discord/Slack). Routes dédiées suffisent pour l'instant.
- **Audit log** des transferts et créations de server_keys.
- **Rate limiting** sur les claims et transferts.
- **Network deletion** UI (route existe peut-être déjà côté backend, à exposer côté UI dans une itération future).
- **Server key rotation manuelle** (sans transfert).
- **Notifications in-app** pour transferts (alternative à l'email).
