# Artisan — Stack technique

Décisions consolidées sur la stack du produit, avec rationale et alternatives écartées. Document vivant : à mettre à jour quand on revisite un choix.

Dernière révision : 2026-06-19.

---

## Résumé en une table

| Couche | Choix | Alternative écartée | Pourquoi |
|---|---|---|---|
| **Plugin Minecraft** | Kotlin 2.0 + Paper API + Gradle | Java 21 | Kotlin offre null-safety, data classes et coroutines — moins de boilerplate pour les modèles de domaine complexes. |
| **Backend runtime** | Bun 1.x | Node 22, Deno | Startup rapide, TypeScript natif sans transpilation, `bun:sqlite` intégré. Suffisant pour le MVP et la prod à faible concurrence. |
| **Backend framework** | Hono 4 | Fastify, Express | Léger, TypeScript-first, WebSocket via `hono/bun`. Zéro config. Pour le MVP, Fastify n'apporte rien de concret. |
| **ORM** | Drizzle | Sequelize, Prisma | TS-native, types parfaits, proche du SQL, pas de codegen ni de moteur séparé. Dialecte swappable (SQLite → PostgreSQL en changeant 3 lignes). |
| **DB** | PostgreSQL 16 (`drizzle-orm/postgres-js`) | SQLite (`bun:sqlite`) | SaaS multi-tenant : visualisation données, backups, requêtes ad-hoc, préparation multi-instance. Drizzle abstrait le dialecte — le switch depuis SQLite n'a nécessité que 3 lignes de config. |
| **Canvas éditeur** | Konva + react-konva | React Flow | Un seul canvas Konva avec inventaires inlines. React Flow (node-based) ne correspond pas au modèle visuel : les menus ne sont pas des nœuds connectés, ce sont des compositions d'items dans une grille. |
| **WS client (éditeur)** | Custom `pluginBridge.ts` (~60 LOC) | partysocket, socket.io | On contrôle le protocole JSON. partysocket n'est utile que si on veut le reconnect auto sans l'écrire — 60 lignes suffisent. |
| **WS client (plugin)** | OkHttp 4 WebSocket | socket.io, Ktor | OkHttp est déjà la dépendance HTTP du plugin (bundle download). Un seul client HTTP+WS. Reconnect exponential backoff inclus. |
| **Frontend framework** | React 19 + TypeScript strict | Vue, Svelte, Solid | Écosystème (@dnd-kit, shadcn, training data LLMs). |
| **Build** | Vite 6 | webpack, Parcel, Turbopack | Standard 2026. HMR rapide, config minimale. |
| **Router** | TanStack Router | React Router v7 | Routes/params type-safe. |
| **State client** | Zustand + Zundo | Jotai, Redux Toolkit | Store clair pour un éditeur avec gros graphe de state. Zundo = undo/redo gratis. |
| **UI components** | shadcn/ui + Tailwind v4 | Mantine, Chakra UI | On possède le code. Customisation libre, design soigné. |
| **Drag & drop** | @dnd-kit/core | react-beautiful-dnd | Performant, accessible, maintenu. |
| **MiniMessage** | Custom TS parser (~500 LOC) | npm @minecraft-js/minimessage, adventure-webui | Zéro dépendance, intégration native avec l'autocomplete i18n/PAPI. adventure-webui sert de référence visuelle (MIT). |
| **Tests backend** | `bun:test` | Vitest, Jest | Natif Bun, zero config. |
| **Google ID tokens** | `jose` 6 (RS256 + cached remote Google JWKS) | Hand-written JWT/signature verification | Standard verification of issuer, audience and expiry on Bun; Google authorization-code flow additionally binds state, nonce and PKCE. |
| **Tests editor** | Vitest + Playwright | Jest, Cypress | Vitest s'intègre à Vite. Playwright > Cypress en 2026. |
| **Tests plugin** | JUnit 5 + MockBukkit + MockWebServer | - | Standards Paper/Bukkit. MockWebServer (OkHttp) pour simuler le backend en intégration. |
| **Lint / format** | Biome (editor) | ESLint + Prettier | Un binaire, plus rapide. |
| **Hosting production** | OVH VPS 4 vCPU/8 Go, Ubuntu 26.04, Coolify, PostgreSQL 16 privé, nginx, Cloudflare Tunnel + Access, livraison GitHub Actions gated | Hébergement managé réparti | Une stack regroupée réduit la fragmentation opérationnelle tout en restant exploitable par une seule personne. Le Tunnel masque l'origine et évite d'exposer des ports web entrants. |
| **Emails transactionnels** | Scaleway TEM via SMTP (nodemailer) — 2026-07-11 | API HTTP dédiée | SMTP suffit pour un volume transactionnel faible (welcome, notifications) ; nodemailer est zero-config sur `createTransport`, pas de SDK propriétaire supplémentaire. |

---

## Pivots depuis la spec initiale (avril 2026)

La spec initiale documentait Node 22 + Fastify + PostgreSQL + React Flow. L'implémentation a divergé sur quatre points — décisions actées en mai 2026 lors du scaffolding :

| Spec initiale | Implémenté | Raison du pivot |
|---|---|---|
| Java 21 | **Kotlin 2.0** | Null-safety et data classes réduisent le boilerplate sur les modèles de domaine. |
| Node 22 + Fastify | **Bun + Hono** | MVP : Bun simplifie le toolchain (pas de transpilation). Fastify n'apporte rien de concret à cette échelle. |
| React Flow | **Konva** | Le modèle visuel est un canvas d'inventaires Minecraft, pas un graphe de nœuds. Konva donne le contrôle pixel-perfect nécessaire. |
| Hébergement managé réparti entre plusieurs fournisseurs | **OVH + Coolify + PostgreSQL privé + nginx + Cloudflare Tunnel/Access** | Moins de fragmentation opérationnelle et une exploitation solo plus pratique, avec des releases toujours conditionnées par la CI GitHub Actions. |

**Condition de migration vers Fastify :** si on a besoin de la validation JSON Schema intégrée sur les routes bundle upload (quand le schéma menu v2 arrive), ou si on atteint les limites de Hono en production.

---

## Backend — détails

### Bun + Hono

Bun exécute TypeScript natif, expose `bun:sqlite` sans dépendance, et `Bun.serve` gère HTTP + WebSocket dans le même process. Hono est un framework HTTP ultra-léger avec une API proche d'Express — `createBunWebSocket()` intègre le WS upgrade proprement.

```ts
const { upgradeWebSocket, websocket } = createBunWebSocket();
app.get("/ws/plugin", upgradeWebSocket(() => ({
  onMessage(evt, ws) { ... },
  onClose() { ... },
})));
export default { port, fetch: app.fetch, websocket };
```

### PostgreSQL + Drizzle

```ts
// db/index.ts
const client = postgres(process.env.DATABASE_URL ?? "postgresql://postgres:postgres@localhost:5432/artisan");
export const db = drizzle(client, { schema });
```

Le switch depuis SQLite n'a nécessité que : remplacer `drizzle-orm/bun-sqlite` par `drizzle-orm/postgres-js`, changer le dialecte dans `drizzle.config.ts`, et `sqliteTable` → `pgTable` dans le schéma. Les requêtes Drizzle n'ont pas changé.

### Sessions WS

Les sessions sont en mémoire (`activeSessions`, `sessionSenders` dans `hub.ts`). C'est suffisant pour un backend single-instance. Si on passe multi-instance, il faudra une couche partagée (Redis ou table PostgreSQL).

---

## Frontend — détails

### Konva

Le canvas est un `<Stage>` Konva unique. Les menus sont des `<Group>` positionnés avec `menuLayout.ts`, les items des `<Rect>` + `<Image>`, le texte en MiniMessage rendu par `MiniMessageKonvaText.tsx`. Pan/zoom géré par `usePanZoom.ts`.

Pas de React Flow : les menus Artisan ne sont pas des nœuds dans un graphe. Ce sont des compositions d'items dans une grille. Les "edges" visuelles entre menus (actions `open_menu`) sont rendues custom avec `deriveEdges.ts`.

### Zustand + Zundo

`accountStore.ts` est le store principal — mutations pack/menu/element/command + undo/redo via Zundo. `uiStore.ts` porte l'état UI pur (onglet actif, langue, dimensions). `wsStore.ts` porte la connexion WS et la fonction `publish()`.

TanStack Query n'est pas utilisé (pas de data fetching server-side côté editor dans le MVP — l'état vit en localStorage).

---

## Plugin — détails

### Kotlin 2.0 + OkHttp

`WsClient.kt` gère la connexion WS avec reconnect exponentiel. Le téléchargement de bundles (`BundleDownloader.kt`) s'exécute sur `httpClient.dispatcher.executorService` pour ne pas bloquer le thread WS callback d'OkHttp.

`SyncedMenuProvider.kt` est le point d'entrée unique : charge les menus depuis le disque, ouvre le WS si `server_key` est configuré, gère le live-reload sur `bundle_available`.

### Hash déterministe

`BundleHasher.kt` et `hashUtils.ts` doivent produire le même hash pour les mêmes fichiers. Invariant critique : **tri byte-order** (`<`/`>` natif Kotlin/JS), pas `localeCompare` ni `compareTo` locale-aware. L'empty string `""` est le sentinel universel pour "pas de contenu".

---

## Hosting (cible production)

- **Plugin** : distribué aux admins, pas hosté par nous.
- **Hôte** : VPS OVH 4 vCPU / 8 Go sous Ubuntu 26.04, administré par Coolify.
- **Backend** : image Docker Bun gérée par Coolify, volume persistant `/app/data`.
- **Editor** : image Docker multi-stage, fichiers statiques servis par nginx.
- **Données** : PostgreSQL 16 privé sur le réseau Coolify ; assets et bundles sur `/app/data` sauvegardé hors hôte.
- **Entrée web** : Cloudflare Tunnel nommé pour `api.artisanmc.net`, `editor.artisanmc.net` et `coolify.artisanmc.net`; Cloudflare Access protège Coolify.
- **Livraison** : GitHub Actions déploie uniquement la révision `main` validée par CI ; l'auto-deploy direct de Coolify est désactivé.
- **Auth** : Discord OAuth custom (pas NextAuth — bound à Next.js).
- **Paiement** : Stripe Subscriptions.

---

## Rendu Markdown de l'assistant

L'éditeur utilise `react-markdown` et `remark-gfm` pour afficher les réponses IA
(CommonMark et tableaux GFM) dans le chat et le suivi des tâches. Le rendu produit
des éléments React, ignore le HTML brut et conserve le filtrage des URL par défaut.

## Choses encore ouvertes

- **Signature des bundles** : champ `signature` présent dans le protocole, non implémenté. ECDSA P-256 prévu.
- **Auth** : non implémentée. `server_key` manuel pour l'instant. Deux providers prévus : Discord OAuth + email/password (bcrypt + JWT). `server_key` reste le vecteur d'auth plugin → backend (ne change pas).
- **TanStack Query** : non utilisé. À introduire si on ajoute du data fetching server-side (billing, équipes).
- **Migration JSON menu v1 → v2** : moteur côté plugin uniquement, côté backend, ou les deux ? À trancher en V1.5.
- **PlaceholderAPI** : intégration directe pour V1, abstraction si auto-completion riche nécessaire.
