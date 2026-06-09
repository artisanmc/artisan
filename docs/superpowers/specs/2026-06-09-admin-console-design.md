# Console super-admin plateforme — config IA (v1), onglets extensibles

**Statut :** design approuvé, prêt pour le plan d'implémentation
**Auteur :** brainstorm 2026-06-09
**Déclencheur :** la config IA (`ASSISTANT_*`) vit en env vars ; besoin d'un espace admin pour l'éditer (et, plus tard, gérer users/logs).
**Code lié :** `backend/src/db/schema.ts` (users, nouvelle table `app_settings`), `backend/src/middleware/userAuth.ts`, `backend/src/modules/assistant/provider/config.ts` (chargement config), `editor/src/routes/` (route `/admin`).

## Contexte

- **Auth** : table `users` (login email/Discord) → `AuthUser {id,email,…}` via cookie `artisan_user_session` + middleware `userAuth`. Le rôle `memberships.role` est **au niveau network** (owner/member), **pas** un admin plateforme. → **aucun super-admin aujourd'hui.**
- **Config IA** : env vars `ASSISTANT_PROVIDER`/`ASSISTANT_BASE_URL`/`ASSISTANT_API_KEY`/`ASSISTANT_MODEL`, lues par `resolveProviderConfig(env)`. Le provider est **global plateforme** (l'admin fournit la clé/crédits) — pas par network.
- **Audit** : `serverKeyHelloes` (hellos plugin, par serveur) — base d'un futur onglet « logs ».

Ce spec couvre une **console super-admin plateforme** : v1 = un onglet **config IA** ; la structure d'onglets est prête pour `users`/`logs` plus tard (hors v1).

## Décisions du brainstorm

| Question | Choix |
|---|---|
| Modèle d'accès | **`users.isAdmin` (DB)** + amorçage par env `ADMIN_BOOTSTRAP_EMAILS` (au login). |
| Stockage config IA | **Une seule table générique `app_settings` (key/value JSON)**. Clé API **chiffrée at-rest** (AES-256-GCM, `CONFIG_ENC_KEY`). Env `ASSISTANT_*` = défaut bootstrap (DB override). |
| Scope v1 | Shell admin + **onglet IA seulement**. `users`/`logs` = hors-scope, structure prête. |

## Goals

- Un **espace `/admin`** (éditeur) gardé super-admin, à **onglets extensibles**.
- Configurer le provider IA (**provider / baseURL / model / clé**) depuis l'UI, sans toucher les env ni redéployer.
- **Clé jamais exposée** (chiffrée at-rest, jamais renvoyée au client, jamais loggée).
- Le moteur IA lit la config **DB d'abord, env en fallback**.

## Non-goals (v1)

- Onglets **users** (gestion comptes / promotion admin) et **logs** (audit) — structure prête, non construits.
- RBAC fine / multi-rôles admin (un seul booléen `isAdmin`).
- Secret manager externe (chiffrement at-rest en DB suffit en v1).
- Rotation automatique de `CONFIG_ENC_KEY`.

## Architecture

### 1. Contrôle d'accès

- **Migration** : colonne `users.isAdmin` (boolean, default false). Générée via `bun run db:generate`, committée.
- **Amorçage** : au login (route auth), si l'email de l'utilisateur ∈ `ADMIN_BOOTSTRAP_EMAILS` (env, CSV) et `isAdmin` est false → le passer true. Garantit qu'un premier admin existe sans intervention DB manuelle.
- **Middleware `requireAdmin`** (`backend/src/middleware/`) : applique `userAuth`, puis 403 si `!user?.isAdmin`. Garde tout `/api/v1/admin/*`.
- **Exposition UI** : `/api/v1/auth/me` (route existante ou ajoutée) renvoie `isAdmin` dans le profil. L'éditeur affiche l'entrée admin **uniquement si** `isAdmin`, et la route `/admin` redirige sinon.

### 2. Persistance — table `app_settings` générique

- **Table** : `app_settings (key text PK, value text NOT NULL, updatedAt timestamp, updatedBy text → users.id)`. `value` = JSON stringifié (cohérent avec le pattern `filesJson` du repo).
- **Config IA** : une ligne `key = "assistant"`, `value` = JSON `{ provider, baseUrl, model, apiKeyEncrypted }`. `apiKeyEncrypted` = ciphertext base64 (la clé n'est jamais stockée en clair).
- **Extensibilité** : un futur réglage global = une nouvelle `key` (pas de migration).

### 3. Chiffrement des secrets

- `backend/src/lib/secretBox.ts` : `encryptSecret(plain): string` / `decryptSecret(cipher): string` en **AES-256-GCM** avec `CONFIG_ENC_KEY` (env, 32 bytes hex). Format `iv:tag:ciphertext` base64.
- Si `CONFIG_ENC_KEY` absent : la **config DB est désactivée** (lecture/écriture de la clé impossible) → le moteur retombe sur les env. (Log WARN au boot.)

### 4. Chargement de la config par le moteur (DB → env)

- Nouveau `loadAssistantProviderConfig(): Promise<ProviderConfig | null>` (dans `provider/config.ts` ou `provider/dbConfig.ts`) :
  1. lit `app_settings["assistant"]` ; si présent + `CONFIG_ENC_KEY` set → `{ baseURL, model, apiKey: decryptSecret(apiKeyEncrypted) }` (baseURL résolu via preset si `provider` sans baseURL explicite).
  2. sinon → `resolveProviderConfig(process.env)` (le resolver env sync existant, **inchangé**).
- Les routes assistant (2d, `resolve()`) appellent ce loader **async** (elles sont déjà async). `resolveProviderConfig(env)` reste tel quel (réutilisé en fallback + tests).

### 5. Endpoints admin (`/api/v1/admin/*`, `requireAdmin`)

| Méthode | Route | Effet |
|---|---|---|
| `GET` | `/api/v1/admin/assistant-config` | `{ provider, baseUrl, model, keySet: boolean }` — **jamais la clé**. |
| `PUT` | `/api/v1/admin/assistant-config` | upsert `app_settings["assistant"]` ; si `apiKey` fourni (non vide) → chiffre + stocke ; si vide/absent → garde l'existant. `updatedBy = user.id`. |
| `POST` | `/api/v1/admin/assistant-config/test` | mini-appel via `OpenAICompatibleProvider` (config courante ou celle du body) → `{ ok, error? }`. |

`/api/v1/auth/me` étendu avec `isAdmin`.

### 6. UI admin (`editor/`)

- Route **`/admin`** (TanStack Router) = **shell à onglets** : v1 = un onglet **« IA »** ; ajouter un onglet = une entrée + une route enfant (`/admin/users`, `/admin/logs`). Gardée : redirige vers `/networks` si `!isAdmin`.
- **Onglet IA** : `<select>` provider (presets openai/deepseek/mistral/openrouter/local), inputs baseURL (optionnel) + model, champ clé **write-only** (placeholder « •••• définie » si `keySet`, vide = inchangé), bouton **« Tester la connexion »** (appelle `/test`), bouton Enregistrer (PUT). Toasts succès/erreur. Toutes strings i18n (en+fr, même commit).
- **Entrée vers `/admin`** : lien dans le menu compte/topbar, visible si `isAdmin`.

## Sécurité

- `requireAdmin` sur **tout** `/api/v1/admin/*`.
- Clé : chiffrée at-rest ; **jamais** renvoyée par `GET` ; jamais loggée (ni dans les erreurs `/test`).
- `CONFIG_ENC_KEY` requis pour la config DB des secrets ; absent → fallback env + WARN.
- `isAdmin` non auto-accordé hors `ADMIN_BOOTSTRAP_EMAILS`.

## Gestion d'erreurs

| Cas | Comportement |
|---|---|
| Non-admin sur `/api/v1/admin/*` | 403. |
| `/admin` UI sans `isAdmin` | redirect `/networks`. |
| `CONFIG_ENC_KEY` absent au `PUT` clé | 503 « chiffrement non configuré » ; provider/model éditables quand même. |
| `/test` échoue (provider) | `{ ok:false, error }` (message provider sans secret). |
| Config DB absente | moteur = fallback env (assistant désactivé si ni DB ni env). |

## Variables d'environnement (backend)

| Variable | Défaut | Usage |
|---|---|---|
| `ADMIN_BOOTSTRAP_EMAILS` | (vide) | CSV d'emails promus `isAdmin` au login. |
| `CONFIG_ENC_KEY` | (vide) | Clé hex 32 bytes pour chiffrer les secrets en DB. Vide → config DB des secrets désactivée (fallback env). |
| (`ASSISTANT_*` existants) | — | Défaut bootstrap, override par la config DB. |

## Tests

| Couche | Couverture |
|---|---|
| `secretBox` | encrypt→decrypt round-trip ; ciphertext ≠ plain ; déchiffrement échoue sur clé absente/altérée. |
| `requireAdmin` | 403 anonyme / 403 user non-admin / pass si `isAdmin`. |
| Bootstrap login | email ∈ `ADMIN_BOOTSTRAP_EMAILS` → `isAdmin` true ; hors liste → inchangé. |
| `loadAssistantProviderConfig` | DB présent → DB (clé déchiffrée) ; DB absent → env ; `CONFIG_ENC_KEY` absent → env. |
| Routes config | `GET` masque la clé (`keySet`) ; `PUT` chiffre + upsert + ne pas écraser la clé si vide ; `/test` ok/erreur. |
| UI | form admin (testing-library) : charge `keySet`, masque la clé, PUT sur Enregistrer, bouton tester ; route `/admin` redirige si non-admin. |

## Docs à mettre à jour

- `docs/architecture/entities.md` : table `app_settings` + `users.isAdmin` + migration.
- `docs/architecture/rest-endpoints.md` : `/api/v1/admin/*`.
- `.env.example` + `CLAUDE.md` : `ADMIN_BOOTSTRAP_EMAILS`, `CONFIG_ENC_KEY`.
- `docs-site/.../admin/console.md` (doc admin, créer).
- `CHANGELOG.md` `[Unreleased]`.

## Découpage / suite

- **Plan 1** : accès (`users.isAdmin` + bootstrap + `requireAdmin` + `auth/me`) + `secretBox` + table `app_settings`. *(socle, testable seul)*
- **Plan 2** : config IA backend (`loadAssistantProviderConfig` DB→env + endpoints GET/PUT/test + branchement du moteur).
- **Plan 3** : UI `/admin` (shell onglets + onglet IA + i18n + entrée gardée).
- **Suite (hors v1)** : onglet **users** (lister/promouvoir, lien vers crédits du sous-plan IA 3), onglet **logs** (audit `serverKeyHelloes` + actions admin), RBAC.
