# Deep link serveur + demande d'accès — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `/artisan editor` imprime le lien **exact** de la page serveur ; un anonyme qui clique passe par le login puis atterrit dessus ; un connecté **sans permission** voit une interface de demande d'accès (owners notifiés, approbation = membership) au lieu d'un rebond.

**Architecture:** (1) le backend construit `server_url` dans `hello_ack` (slugs si présents) et le plugin l'imprime à la place de l'URL racine ; (2) les routes network de l'éditeur redirigent les anonymes vers `/login?next=<url courante>` (mécanisme `safeNext` existant) ; (3) nouvelle feature **access requests** : table `network_access_requests` + routes (créer une demande via le networkId/slug de l'URL, lister/approuver/refuser côté managers) + email best-effort aux owners + UI : panneau « Demander l'accès » rendu par les layouts network sur 403, et sous-liste « Demandes en attente » dans MembersSection.

**Tech Stack:** existants — hub hello (skRow/netRow déjà chargés, hub.ts:306-311), `/login?next=` (`safeNext` de login.tsx), capacités (`manage_members`), inviteStorage comme modèle, mail (`sendSafely`).

## Global Constraints

- Backend : **TOUJOURS `bun run test`, JAMAIS `bun test`** ; `schema.ts` → migration `db:generate` committée. Éditeur : `npm test`, i18n en+fr même commit, tokens design. Plugin : `./gradlew test`, lang en+fr miroir.
- Une demande d'accès accordée crée une membership **role `member`** (promotion ensuite via Members). Refus = soft (row marquée), le demandeur peut re-demander après refus ; anti-spam minimal : une seule demande **pending** par (user, network) — 409 sinon.
- Le 403 réseau ne rebondit plus vers `/networks` quand l'utilisateur est connecté : il rend le panneau de demande d'accès (le rebond reste pour les 404). Anonyme → `/login?next=`.
- Email owners = best-effort (`sendSafely`), la demande existe même sans SMTP.
- Docs same-commit : rest-endpoints/entities/ws-protocol/CHANGELOG.

---

### Task 1: `server_url` dans hello_ack + plugin l'imprime

**Files:** `backend/src/protocol.ts`, `backend/src/ws/hub.ts` (~:306-325), test hub hello ; `plugin/.../provider/SyncedMenuProvider.kt` (+`MenuProvider.editorInfo` passe à l'URL profonde), `plugin/.../command/ArtisanCommand.kt` (message `editor_linked` inchangé — seule l'URL change), `plugin/src/test/.../EditorCommandTest.kt` (ajuster), `docs/architecture/ws-protocol.md`, `CHANGELOG.md`.
**Interfaces:** hello_ack + `server_url: string` = `${EDITOR_URL}/networks/${netRow.slug ?? netRow.id}/servers/${skRow.slug ?? skRow.id}` (fallback `EDITOR_URL` si rows introuvables). Plugin : `editorInfo()` retourne (server_url, network_name) — l'ancienne `editor_url` reste parsée en fallback pour un backend plus vieux.

- [ ] Backend : champ + test hello (asserte l'URL avec slug) → GREEN → plugin : stocker `server_url` (fallback `editor_url`), EditorCommandTest ajusté (l'URL affichée = deep link) → `./gradlew test` GREEN → docs → commit `feat: hello_ack carries the exact server deep link; /artisan editor prints it`.

---

### Task 2: Anonyme sur les routes network → `/login?next=`

**Files:** `editor/src/routes/networks.tsx`, `networks.$networkId.tsx`, `networks.$networkId.servers.$serverId.tsx` (+ tests) — LIRE d'abord comment chacun gère l'anonyme aujourd'hui (probablement : getNetwork 401 → console.error → page bloquée en loading).
**Interfaces:** pattern uniforme : `const user = useAuthStore(s => s.currentUser); const authLoading = useAuthStore(s => s.isLoading);` — quand `!authLoading && !user` → `navigate({ to: "/login", search: { next: <pathname+search courants> } })` (même shape que invite.tsx). Le `next` inclut le search (`?…`) si présent.

- [ ] Tests RED (anonyme → navigate /login avec next = URL courante, sur les 3 routes) → implémenter → `npm test` GREEN → commit `feat(editor): anonymous visitors on network routes are sent to login with a return path`.

---

### Task 3: Access requests — schéma + routes + email owners

**Files:** `backend/src/db/schema.ts` (+ table) + migration ; `backend/src/lib/accessRequestStorage.ts` (create) ; `backend/src/routes/userNetworks.ts` (routes managers) + `backend/src/routes/accessRequests.ts` (create — POST du demandeur) + mount app.ts ; `backend/src/lib/mail/templates.ts` (+`accessRequestEmail`) ; tests (storage + routes) ; `entities.md`, `rest-endpoints.md`, `CHANGELOG.md`.
**Interfaces:**
- Table `network_access_requests` : id (`acr_`+rand), networkId FK cascade, userId FK cascade, message (text nullable, ≤500), status (text : pending/approved/denied), resolvedBy (nullable), createdAt, resolvedAt (nullable). Index unique partiel impossible en drizzle simple → contrainte applicative : POST refuse (409 `already_pending`) si une row pending existe pour (user, network).
- `POST /api/v1/networks/:idOrSlug/access-requests` (userAuth ; résout id **ou** slug comme `networks/:id` le fait déjà) body `{ message? }` → 201 `{ request: { id, status } }` ; déjà membre → 409 `already_member` ; pending existant → 409 `already_pending`. Fire-and-forget : `sendSafely(accessRequestEmail(...))` à CHAQUE owner/admin du network (emails via memberships→users).
- Managers (`manage_members`) : `GET /api/v1/networks/:id/access-requests` (pending d'abord) ; `POST /api/v1/networks/:id/access-requests/:requestId/approve` → addMembership(role member, idempotent via le catch 23505 existant) + status approved ; `.../deny` → status denied. 404 hors network.
- `accessRequestEmail({ to, networkName, requesterName, requesterEmail, message, url, locale? })` — url = page network (deep link Members) ; valeurs user-controlled échappées dans le html.

- [ ] TDD storage (create/pending-unique/approve→membership/deny/re-demande après deny OK) → routes (403 member sur les routes managers ; le POST demandeur exige juste un compte NON membre) → email capturé au POST (fake mailer) → suite GREEN → migration committée → docs → commit `feat(backend): network access requests (request → owner approval → membership)`.

---

### Task 4: UI — panneau « Demander l'accès » + gestion dans Members

**Files:** `editor/src/lib/api/accessRequests.ts` (create) ; `editor/src/components/network-detail/RequestAccessPanel.tsx` (create) ; `networks.$networkId.tsx` + `networks.$networkId.servers.$serverId.tsx` (403 connecté → rendre le panneau au lieu de naviguer ; 404 garde le bounce) ; `MembersSection.tsx` (+ sous-liste « Demandes en attente » avec Approve/Deny, visible managers) ; locales en+fr ; tests (panneau sur 403, POST au clic, états already_pending/already_member ; MembersSection approve appelle l'API et ajoute à la liste).
**Interfaces:** `RequestAccessPanel({ networkIdOrSlug })` : états idle (bouton + textarea message optionnel) / sent (« Demande envoyée — un owner doit l'approuver ») / already_pending / error. Les layouts passent l'id/slug de l'URL. Design tokens, pattern card des pages voisines.

- [ ] Tests RED → implémenter → `npm test` GREEN → commit `feat(editor): request-access panel on 403 + approvals in Members`.

---

### Task 5: Docs + checklist

**Files:** `docs-site/.../install-admin.md` (§ Open the editor : le lien mène à la page du serveur ; § accès : demande d'accès), `docs/superpowers/specs/2026-07-13-deeplink-access-validation.md` (create), CHANGELOG relecture.

- [ ] Checklist :

```markdown
# Validation deep link + access request — manuel
1. /artisan editor → lien vers /networks/<slug>/servers/<slug> exact.
2. Anonyme clique → login (next) → atterrit sur la page serveur après connexion.
3. Compte SANS membership ouvre le lien → panneau « Demander l'accès » (pas de rebond) → envoie une demande (message optionnel).
4. Owner : email reçu (si SMTP) + demande visible dans Members → Approve → le demandeur voit le network au rechargement.
5. Re-demande pendant pending → « déjà en attente » ; après deny → nouvelle demande possible.
6. 404 réel (network supprimé) → rebond /networks conservé.
```

- [ ] Commit `docs: server deep link + access requests shipped`.

## Risques
- Résolution slug/id au POST demandeur : suivre EXACTEMENT le résolveur des routes `networks/:id` existantes.
- Le panneau 403 remplace le bounce : vérifier que le fix « dual-auth » historique (supprimé en T8 du cutover) ne réapparaît sous aucune forme — ici l'utilisateur est TOUJOURS cookie-auth, un 403 est fiable.
- Notification owners : N emails par demande (petits networks — OK) ; pas de digest V1.
