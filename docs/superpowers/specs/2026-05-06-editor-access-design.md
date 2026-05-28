# Editor Access & Real-Time Collaboration — Design

> **Date :** 2026-05-06
> **Scope :** `/artisan editor` command, session tokens, WebSocket editor channel, menu-level real-time collaboration, security hardening.
> **Prérequis :** server linking (B1/B2) implémenté — le plugin a un `server_key` et une WS authentifiée vers le backend.

---

## 1. Principe directeur

Pas de compte requis pour utiliser l'éditeur. Le modèle est celui de LuckPerms : `/artisan editor` génère une URL temporaire, l'admin l'ouvre dans son navigateur, accès complet immédiat. Un compte Pro sera introduit plus tard pour les features avancées — ce n'est pas dans le scope de ce design.

---

## 2. Commande `/artisan editor`

### Usage

```
/artisan editor          # génère une session et affiche l'URL
/artisan editor revoke   # révoque toutes les sessions actives du serveur
```

### Permissions

- Gardée par le nœud de permission `artisan.editor` (configurable via LuckPerms, etc.)
- Option `editor.console_only: true` dans `config.yml` → refuse si le sender n'est pas la console

### Config plugin

```yaml
# plugins/Artisan/config.yml
server_key: "sk_..."
ws_url: "wss://editor.artisanmc.net/ws/plugin"
editor:
  console_only: false
```

### Flow

```
Admin tape /artisan editor
        │
        ▼  (sur la WS authentifiée existante)
Plugin → backend : { type: "editor_session_request", sender: "PlayerName|CONSOLE" }
        │
        ▼
Backend génère token (30 chars crypto-random), insère dans editor_sessions
(server_key_id, expires_at = now + 30 min)
        │
        ▼
Backend → plugin : { type: "editor_session_ready", url: "...", expires_at: "..." }
        │
        ▼
Plugin affiche dans le chat / console :
  [Artisan] Éditeur → https://editor.artisanmc.net/session?token=XXXXX
  (expire dans 30 min d'inactivité)
        │
        ▼
Admin ouvre l'URL → éditeur charge, valide le token via GET /api/editor-session/:token,
ouvre WS /ws/editor, accès complet aux packs du serveur
```

---

## 3. Backend

### Table `editor_sessions`

```sql
editor_sessions (
  token          text      PRIMARY KEY,        -- 30 chars crypto-random
  server_key_id  text      NOT NULL,           -- FK → server_keys.id
  created_by     text      NOT NULL,           -- "PlayerName" ou "CONSOLE"
  created_at     timestamp NOT NULL,
  expires_at     timestamp NOT NULL,           -- reset à chaque activité
  revoked_at     timestamp                     -- nullable
)
```

### Nouveaux messages WS plugin ↔ backend

```ts
// Plugin → backend (sur WS authentifiée)
{ type: "editor_session_request"; sender: string }
{ type: "editor_session_revoke" }   // déclenché par /artisan editor revoke

// Backend → plugin
{ type: "editor_session_ready"; url: string; expires_at: string }
```

### Nouveaux endpoints REST

| Méthode | Route | Auth | Usage |
|---|---|---|---|
| `GET` | `/api/editor-session/:token` | token | Valide le token, retourne `{ server_key_id }` — appelé à l'ouverture de l'éditeur |
| `POST` | `/api/editor-session/:token/refresh` | token | Extend `expires_at` de 30 min — appelé toutes les 10 min par l'éditeur actif |
| `DELETE` | `/api/editor-session` | token | Révoque la session courante (appelé par l'éditeur sur logout explicite — optionnel) |

Tous les autres appels API de l'éditeur (lire/écrire packs, publier) passent `Authorization: Bearer <token>`. Le backend valide le token et scope systématiquement toutes les réponses au `server_key_id` associé.

### WebSocket éditeur

```
GET /ws/editor?token=<token>
```

- Validé au moment de l'upgrade HTTP → WS (token invalide = 401, connexion refusée)
- Le backend enregistre le sender dans `editorSenders: Map<server_key_id, Set<sendFn>>`
- Utilisé pour : push `session_expired`, broadcast `draft_update` (collaboration), futures notifications

### Messages WS editor ↔ backend

```ts
// Backend → éditeur (push)
{ type: "session_expired" }
{ type: "draft_update"; menu_id: string; menu_yaml: string; updated_by: string }

// Éditeur → backend (futur, V1.5+)
// Les saves restent en REST pour l'instant
```

---

## 4. Collaboration temps réel (menu-level)

### Principe

Lorsqu'un admin sauvegarde un menu, le backend broadcaste le nouveau `menu_yaml` à tous les éditeurs actifs du même serveur (sauf l'émetteur).

### Comportement côté éditeur

| Situation | Comportement |
|---|---|
| Menu reçu = menu fermé (pas ouvert dans l'éditeur) | Mise à jour silencieuse du store |
| Menu reçu = menu actuellement ouvert | Notification : "Admin X a modifié ce menu — recharger ?" (ne s'applique pas automatiquement) |

### Pas de OT/CRDT

Last write wins si deux admins sauvegardent le même menu simultanément. La notification "en train d'éditer" limite ce cas en pratique. OT/CRDT est explicitement hors scope (V2+).

### Présence (V1.5)

Un curseur/badge "Admin X est sur ce menu" dans la sidebar — alimenté par un message WS `editor_presence { menu_id }` envoyé quand un éditeur ouvre un menu. Pas dans le scope V1 — la notification "en train d'éditer" est suffisante pour éviter les conflits en pratique.

---

## 5. Sécurité

### Token

- 30 caractères, alphabet 62 chars (A-Z a-z 0-9), `crypto.getRandomValues` → ~178 bits d'entropie
- Stocké en clair en DB (c'est un bearer token, pas un secret persistant — expire vite)
- Opaque : le backend répond identiquement à "inexistant", "expiré" et "révoqué" → `401 Unauthorized`
- Supprimé du URL dès le chargement de l'éditeur via `history.replaceState` (ne traîne pas dans l'historique navigateur)

### Transport

- HTTPS obligatoire en production (le token est en clair dans l'URL au premier chargement — TLS protège ce transit)
- Header `Authorization: Bearer <token>` pour tous les appels API suivants → immunisé CSRF (pas de cookies)
- OkHttp vérifie le certificat TLS du backend par défaut (côté plugin)

### Sessions multiples

- Plusieurs tokens actifs simultanément = OK (pas de révocation automatique à la génération)
- Un admin peut travailler depuis 1h sans craindre qu'un collègue lui coupe sa session
- `/artisan editor revoke` = seul kill-switch explicite, affiche la liste des sessions actives avant confirmation

### Rate limiting

| Endpoint / message | Limite |
|---|---|
| `GET /api/editor-session/:token` | 20 req/min par IP → 429 |
| `POST /api/link` | 5 req/min par IP |
| `editor_session_request` WS | 1 par 30s par connexion |

### Scope strict

Chaque token est lié à un `server_key_id`. Le backend refuse toute réponse hors de ce scope, même avec un token valide d'un autre serveur.

### Audit

Chaque génération de session logge : username Minecraft + UUID (ou "CONSOLE"), timestamp, IP du backend (via WS). Donne à l'admin de la visibilité sur qui a ouvert l'éditeur.

---

## 6. Route éditeur `/session`

```tsx
// editor/src/routes/session.tsx
// Chargement :
// 1. GET /api/editor-session/:token → valide, récupère server_key_id
// 2. Ouvre WS /ws/editor?token=...
// 3. Charge les packs du serveur
// 4. history.replaceState → retire le token de l'URL
// 5. Lance POST /api/editor-session/:token/refresh toutes les 10 min
```

---

## 7. Nouveaux fichiers

**Backend :**
- `backend/src/db/schema.ts` — table `editor_sessions`
- `backend/src/routes/editorSession.ts` — REST endpoints
- `backend/src/ws/hub.ts` — `editorSenders` map, handle `editor_session_request`, broadcast `draft_update`
- `backend/src/protocol.ts` — nouveaux types WS

**Plugin :**
- `plugin/.../command/ArtisanCommand.kt` — ajout `editor` et `editor revoke` subcommands
- `plugin/.../config/PluginConfig.kt` — ajout `editor.console_only`

**Editor :**
- `editor/src/routes/session.tsx` — route `/session`
- `editor/src/lib/editorSession.ts` — helpers REST (validate, refresh)
- `editor/src/lib/editorWs.ts` — WS editor (connect, handle draft_update, session_expired)

---

## 8. Ce qui est hors scope (notes pour plus tard)

- **Compte Pro / billing** : design séparé — pas de dépendance avec ce plan
- **OT/CRDT** : collaboration field-level (même menu, même moment) — V2+
- **Présence avancée** : "Admin X est en train de taper sur le slot 14" — V2+
- **MCModels import** : feature Pro, design séparé
