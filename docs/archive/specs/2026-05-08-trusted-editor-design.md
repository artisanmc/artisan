# Trusted Editor — Design

**Date:** 2026-05-08  
**Scope:** Sécurisation des sessions éditeur via refresh tokens + trust in-game + IP binding

---

## Problème

Le token de session éditeur actuel est un token unique 30 min présent dans l'URL. Si ce token est partagé accidentellement ou volé, n'importe qui peut déclencher un deploy sur le serveur Minecraft sans autre vérification.

---

## Objectifs

1. Sessions longues (7 jours) sans sacrifier la sécurité
2. L'URL de l'éditeur est one-time — inutilisable après la première visite
3. Le deploy requiert une confirmation in-game (`/artisan trusteditor`) même avec un token valide
4. Un changement d'IP re-déclenche la confirmation in-game (sans invalider la session)

---

## Architecture des tokens

### Avant
```
url_token (30 min) → utilisé pour tous les appels API
```

### Après
```
url_token (one-time) → échangé à la 1ère visite
    ↓
access_token (5 min, mémoire JS) → appels API
refresh_token (7 jours, HttpOnly cookie) → renouvelle l'access token
```

---

## Schema DB — `editor_sessions` (colonnes ajoutées)

| Colonne | Type | Description |
|---|---|---|
| `exchanged_at` | timestamp nullable | Posé lors de l'échange du url_token — bloque toute réutilisation |
| `refresh_token` | text nullable | Token de refresh (HttpOnly cookie, 7 jours) |
| `access_token` | text nullable | Access token courant (5 min) |
| `access_expires_at` | timestamp nullable | Expiry de l'access token |
| `trust_code` | text nullable | Code 6 chars généré à la création, affiché dans l'éditeur |
| `trusted_at` | timestamp nullable | Posé quand `/artisan trusteditor` est tapé |
| `trusted_ip` | text nullable | IP capturée au moment du trust |

`expires_at` passe de 30 min à **7 jours**.

---

## Flows

### A. Exchange (visite initiale)

```
/artisan editor
    → backend crée session : url_token + trust_code (6 chars), expires_at = now + 7j
    → éditorSessionReadyMessage inclut trust_code

Editor charge /session?token=<url_token>
    → POST /api/editor-session/exchange { url_token }
    → SI exchanged_at IS NOT NULL → 401 { error: "already_used" }
    → SI token expiré ou inexistant → 401
    → pose exchanged_at, génère access_token (5 min) + refresh_token (7j)
    → retourne { access_token, expires_in: 300, trust_code }
    → Set-Cookie: refresh=<refresh_token>; HttpOnly; Secure; SameSite=Strict; Max-Age=604800
```

### B. Refresh (toutes les 4 min, silencieux)

```
POST /api/editor-session/refresh
    → lit le cookie refresh_token
    → SI introuvable ou révoqué → 401 { error: "session_expired" }
    → invalide l'ancien refresh_token (rotation)
    → génère nouveau access_token (5 min) + nouveau refresh_token (7j)
    → retourne { access_token, expires_in: 300 }
    → Set-Cookie: refresh=<nouveau_refresh_token>; HttpOnly; ...
```

### C. Trust in-game

```
Editor affiche banner : "Tapez /artisan trusteditor <trust_code> en jeu"

Admin → /artisan trusteditor <code>
    → plugin envoie WS : editor_trust_request { trust_code }
    → backend : cherche session par trust_code
    → capture IP depuis editorTokenToIp[session.access_token]
    → pose trusted_at + trusted_ip en DB
    → pousse WS éditeur : session_trusted {}

Editor : banner disparaît, deploy débloqué
```

### D. Re-trust sur changement d'IP

```
POST /:token/packs/:packId/deploy
    → SI trusted_ip ≠ request_ip → 403 { error: "session_not_trusted" }

Editor : réaffiche le banner trust (même flow que C)
Admin retape /artisan trusteditor → trusted_ip mis à jour
```

---

## Endpoints modifiés / ajoutés

| Endpoint | Changement |
|---|---|
| `POST /api/editor-session/:url_token/exchange` | **Nouveau** — échange url_token → access + refresh. `:url_token` est le token one-time de l'URL. |
| `POST /api/editor-session/refresh` | **Nouveau** (path fixe, sans token) — lit cookie HttpOnly, rotate refresh token |
| `POST /api/editor-session/:token/refresh` | **Supprimé** — remplacé par la route `/refresh` ci-dessus |
| `GET /api/editor-session/:token` | **Modifié** — accepte access_token, retourne `{ server_key_id, trusted, trust_code }` |
| `POST /:token/packs/:packId/deploy` | **Modifié** — vérifie trusted_at + trusted_ip |
| Tous les `/:token/...` (hors exchange) | **Modifié** — token dans le path est maintenant l'access_token |

---

## IP capture

Le hub maintient `editorTokenToIp: Map<string, string>` (access_token → IP). Alimenté par deux sources :
1. **HTTP** : `trackEditorIp(access_token, ip)` appelé dans `validateEditorToken` à chaque appel authentifié
2. **WS** : lors du `onOpen` de `/ws/editor`, l'IP est lue depuis les headers HTTP de l'upgrade et stockée dans la map (fallback si aucun appel HTTP encore reçu)

Lors du trust request, le backend résout `session.access_token` → `editorTokenToIp.get(access_token)` pour obtenir l'IP à persister. Si la map ne contient pas encore l'IP (cas extrêmement rare), le trust est refusé avec `{ error: "editor_not_connected" }`.

Le `trust_code` est valide pour toute la durée de la session (7 jours). Il n'a pas d'expiry propre. "Code invalide" dans le feedback plugin signifie : session introuvable, déjà révoquée, ou code ne correspondant à aucune session active.

---

## Protocole WS — nouveaux messages

| Message | Sens | Champs |
|---|---|---|
| `editor_trust_request` | plugin → backend | `trust_code: string` |
| `session_trusted` | backend → éditeur WS | `{}` |

`EditorSessionReadyMessage` (backend → plugin) : ajout du champ `trust_code: string`.

---

## Éditeur — changements UX

- **Exchange au chargement** de `/session?token=...` : POST exchange → `access_token` en mémoire Zustand
- **Error states** :
  - `already_used` → page "Ce lien a déjà été utilisé — relancez `/artisan editor`"
  - refresh 401 → "Session expirée — relancez `/artisan editor`"
- **Banner trust** : affiché si `trusted: false` à la validation, ou sur 403 `session_not_trusted` après un deploy
- **WS `session_trusted`** → banner disparaît
- **Refresh silencieux** : `setInterval` 4 min, rotation transparente

---

## Plugin — changements

- `/artisan trusteditor <code>` : nouveau subcommand
- Envoie `editor_trust_request { trust_code }` via WS principal
- Feedback : "Session éditeur autorisée." / "Code invalide ou expiré."
- Tab-complete sur `trusteditor`
- `EditorSessionReadyMessage` : champ `trust_code` lu et stocké pour affichage en jeu si besoin

---

## Couverture de sécurité

| Scénario | Protection |
|---|---|
| URL partagée accidentellement | ✅ One-time token, inutilisable après 1ère visite |
| Access token volé, session non trustée | ✅ Deploy bloqué (trusted_at null) |
| Access token volé, session trustée, même IP | ⚠️ Fenêtre 5 min (acceptable) |
| Refresh token volé (autre machine = autre IP) | ✅ Re-trust requis, impossible sans accès serveur Minecraft |
| IP change légitime (VPN, 4G) | ✅ Session intacte, re-trust suffit |

---

## Tests à écrire

| Scope | Cas |
|---|---|
| Backend unit | exchange consomme le token (2ème appel → 401), refresh rotate le cookie, trust pose trusted_ip, deploy bloqué si non-trusted, deploy bloqué si IP mismatch |
| Backend intégration | flow complet exchange → trust → deploy |
| Editor unit | sessionStore exchange flow, banner trust affiché/masqué, refresh silencieux |
| Plugin unit | commande trusteditor envoie le bon message WS |
