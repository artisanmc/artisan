# Interfaze — Stack technique

Décisions consolidées sur la stack du produit, avec rationale et alternatives écartées. Document vivant : à mettre à jour quand on revisite un choix.

Dernière révision : 2026-04-29.

---

## Résumé en une table

| Couche | Choix | Alternative écartée | Pourquoi |
|---|---|---|---|
| **Plugin Minecraft** | Java 21 + Paper API + Gradle | Kotlin | Plus de doc, plus d'exemples, ce que je connais déjà — moins de friction en solo. |
| **Backend runtime** | Node 22 + TypeScript strict | Node + JS, Bun, Deno | TS strict pour cohérence avec le front et les types du schéma menu. Bun trop nouveau pour la prod. |
| **Backend framework** | Fastify | Express, Hono | JSON Schema validation intégrée — branchement direct de `schema/menu/v1/schema.json` sur les routes. |
| **ORM** | Drizzle | Sequelize, Prisma | TS-native, types parfaits, proche du SQL, pas de codegen ni de moteur séparé. |
| **DB** | PostgreSQL managé (Neon) | Self-hosted PG, Supabase, MySQL | Solo dev = pas d'astreinte ops. Neon free tier suffit jusqu'au revenu. |
| **Cache / sessions** | Postgres en V1, Redis plus tard | Redis dès le départ | Une pièce mobile en moins. Postgres tient les premiers milliers de users. |
| **Storage assets** | Cloudflare R2 | S3, Backblaze B2 | Pas de fees egress, CDN intégré, pricing prévisible. |
| **CDN** | Cloudflare | Fastly, AWS CloudFront | Cohérent avec R2, gratuit jusqu'à un volume substantiel. |
| **Auth** | Discord OAuth (lib légère custom) | NextAuth, Auth.js | NextAuth est bound à Next.js. On a juste besoin d'un OAuth flow simple côté Fastify. |
| **Paiement** | Stripe Subscriptions | Paddle, Lemon Squeezy | Standard de l'industrie. Webhooks fiables. |
| **Frontend framework** | React 19 + TypeScript strict | Vue, Svelte, Solid | Écosystème (@dnd-kit, shadcn, training data LLMs). |
| **Build** | Vite 6 | webpack, Parcel, Turbopack | Standard 2026. HMR rapide, config minimale. |
| **Router** | TanStack Router | React Router v7 | Routes/params type-safe. Si tu veux le safe pick avec plus de tutos, prends React Router. |
| **State client** | Zustand | Jotai, Redux Toolkit | Plus simple à raisonner pour un éditeur avec gros graphe de state. |
| **State serveur (data fetching)** | TanStack Query | SWR, RTK Query | Standard incontournable. Caching, refetch, optimistic, errors. |
| **UI components** | shadcn/ui + Tailwind v4 | Mantine, Chakra UI | Tu possèdes le code. Customisation libre, design soigné gratos. |
| **Drag & drop** | @dnd-kit/core | react-beautiful-dnd, react-dnd | Performant, accessible, maintenu. |
| **Canvas multi-menu (V1)** | React Flow | Konva, tldraw, Excalidraw | Standard 2026 pour éditeurs node-based. Pan/zoom/minimap built-in, custom node types, edges configurables. Utilisé par n8n, Retool clones, Storyblok. |
| **Forms** | React Hook Form + Zod | Formik, TanStack Form | Standard. Zod = bridge vers le schéma menu (cf. plus bas). |
| **WebSocket client** | partysocket (Cloudflare) | socket.io-client, ws natif | Léger (~3 KB), reconnect/heartbeat built-in. socket.io = trop lourd, protocole proprio. |
| **MiniMessage parser/renderer** | Custom TS (~500 LOC) | Iframe adventure-webui, fork adventure-webui, npm @minecraft-js/minimessage | adventure-webui (PaperMC, MIT) sert de référence visuelle. Custom parser = zéro dépendance, intégration native avec autocomplete i18n/PAPI. |
| **Font preview MC** | Minecraftia ou similaire OSS (.woff2) | Minecraft Standard (proprio) | ~30 KB, Open Source, fidélité visuelle pour la preview live des champs MiniMessage. |
| **Tests** | Vitest + Playwright | Jest, Cypress | Vitest s'intègre à Vite. Playwright > Cypress en 2026. |
| **Lint / format** | Biome | ESLint + Prettier | Un binaire, plus rapide. ESLint si tu veux l'écosystème de plugins. |

---

## Backend — détails

### Fastify

Framework HTTP Node. Plus rapide qu'Express, full TypeScript, **validation JSON Schema intégrée**. C'est le killer feature pour Interfaze : on plug `schema/menu/v1/schema.json` sur les routes `POST /menus/:id`, et toute requête malformée est rejetée automatiquement avec un message propre. Le contrat de l'API et le contrat des données convergent — un seul endroit à maintenir.

```ts
// Exemple
import schema from "../schema/menu/v1/schema.json";
fastify.post("/menus/:id", { schema: { body: schema } }, async (req) => {
  // req.body est déjà validé contre menu/v1
});
```

### Drizzle plutôt que Sequelize

Sequelize a 12 ans, créé pré-TypeScript. Son support TS est rétrofitté, verbeux, et perd des informations de type. Drizzle est TS-natif : tu déclares ta DB en TS, tu obtiens des types parfaits gratuitement, l'API est proche du SQL (peu de magie à apprendre), les requêtes sont 3x plus rapides.

```ts
// Drizzle
const users = pgTable("users", {
  id: serial("id").primaryKey(),
  discordId: text("discord_id").notNull().unique(),
  email: text("email"),
  tier: text("tier", { enum: ["free", "solo", "network", "unlimited"] }).default("free"),
});

const u = await db.select().from(users).where(eq(users.discordId, "abc"));
// u[0].tier est typé "free" | "solo" | "network" | "unlimited"
```

Prisma est l'autre ORM TS moderne. Plus connu, plus lourd (moteur Rust séparé, codegen), DX très polie pour démarrer mais devient gênante quand tu fais des choses non-standard. Drizzle reste plus prévisible.

### Pas de Redis en V1

La spec V1 parle de Redis pour les sessions et le state WebSocket. Tu peux t'en passer au démarrage : Postgres tient ces use cases jusqu'aux premiers milliers d'utilisateurs (UNLOGGED tables pour les sessions, ou simple table). Une pièce mobile en moins à monitorer. À rajouter quand les chiffres le justifient.

### Postgres managé (Neon)

Solo dev = zéro astreinte ops. Neon : Postgres serverless, free tier généreux (3 GB, branches dev/staging gratis), scaling automatique. Supabase est aussi excellent et apporte auth + storage en bundle, mais on n'a pas besoin de leur auth (Discord OAuth direct) ni de leur storage (R2 plus pertinent).

---

## Frontend — détails

### React + Vite + TS strict

React reste le safe default pour une app de cette complexité. Tout l'écosystème dont tu vas dépendre est React-first : @dnd-kit, shadcn, recharts si tu en as besoin. C'est aussi le langage que les LLMs maîtrisent le mieux — important quand tu codes en solo avec assistance IA.

Vite 6 pour le build, TS strict (`"strict": true, "noUncheckedIndexedAccess": true`).

### shadcn/ui + Tailwind v4

shadcn n'est pas une library installée — c'est un set de composants Radix + Tailwind que tu **copies dans ton repo** via `npx shadcn add button`. Tu possèdes le code, tu modifies librement, pas de fight contre la lib quand tu personnalises. C'est devenu le standard de fait pour les produits SaaS modernes en 2026.

Mantine reste défendable mais une fois que tu customises lourdement (pour un éditeur visuel, c'est inévitable), tu te retrouves à fighter ses primitives.

### Zustand pour le state client

Pour un éditeur, tu vas avoir un gros graphe de state à maintenir : menu courant, slot sélectionné, état du drag, état du WS, undo/redo, panels expandés, etc. Zustand donne une vérité claire (un store, des actions, des sélecteurs). Jotai (atom-based) est plus granulaire mais te fait te poser en permanence "où vit cet atom ?".

Pour l'undo/redo spécifiquement, regarder `zundo` (middleware Zustand pour l'history).

### TanStack Query pour le data fetching

Manquant de ta spec mais incontournable. Tout le data-fetching API (liste menus, fetch asset, billing info, etc.) doit passer par là. Tu obtiens caching, refetch, optimistic updates, gestion d'erreur, polling — tu ne veux absolument pas réécrire ça.

### React Hook Form + Zod

Pour les formulaires (panel de propriétés des slots, settings du compte, gestion des équipes). Standard incontesté en 2026.

**Bonus important** : il existe `json-schema-to-zod` qui peut générer des schémas Zod **depuis ton `schema/menu/v1/schema.json`**. Donc le menu/v1 reste la source de vérité unique, et le front a automatiquement la même validation côté UI. À setup en build step ou au runtime.

### TanStack Router (ou React Router v7)

TanStack Router : routes et search params type-safe. Tu déclares tes routes, et `params.menuId` est typé `string` au lieu de `string | undefined`. Ça évite des bugs réels. Moins de tutos en ligne que React Router cependant.

React Router v7 (qui a fusionné avec Remix) reste le safe pick si tu veux maximum de docs/exemples. Différence à l'usage : 5%.

### partysocket pour le WebSocket

Surtout **pas socket.io**. Pour Interfaze, le protocole WS est custom (mutations sur le menu, échanges JSON) et tu veux contrôler le format. socket.io ajoute son protocole proprio par-dessus, du poids, et tu te retrouves à fighter des features dont tu n'as pas besoin.

partysocket de Cloudflare : ~3 KB, reconnect/heartbeat/buffering automatiques, API proche du WebSocket natif. Alternative : implémenter à la main avec le WebSocket natif + un wrapper de reconnect (~50 lignes de code).

### MiniMessage parser/renderer (custom TS)

Tous les champs texte sont en MiniMessage (format Adventure / Paper). On a besoin d'un parser + d'un renderer côté éditeur pour la **preview live**.

**Décision** : composant React natif, parser MiniMessage TypeScript écrit by us (~500 lignes pour le subset qu'on supporte), renderer qui produit du HTML/CSS mimant le rendu Minecraft. Une font Minecraft-like Open Source (Minecraftia, Mojangles ou similaire, ~30 KB woff2) est bundlée pour la preview.

**Inspiration visuelle** : `https://github.com/PaperMC/adventure-webui` (MIT). On l'a regardé pour caler la fidélité du rendu (couleurs MC, espacement, gradients), mais on n'iframe pas et on ne fork pas — leur stack est Kotlin/JS, hors de notre stack TS-natif. Notre parser cible exactement les tags qu'on supporte côté plugin (Paper Adventure 4.18+), zéro dépendance runtime.

**Alternative envisagée** : npm packages type `@minecraft-js/minimessage` ou similaires — à auditer avant de coder le nôtre, mais l'écriture from-scratch est cadrée (le format est documenté formellement).

---

## Tests, qualité, ops

- **Vitest** pour les tests unitaires (compatible Vite, plus rapide que Jest).
- **Playwright** pour l'e2e — y compris pour tester le live-edit (un client Playwright simule un admin dans l'éditeur, un autre simule le plugin via WS).
- **Biome** pour lint + format en un binaire (plus rapide qu'ESLint+Prettier). Si tu veux l'écosystème de plugins ESLint, garde l'ancien combo.
- **Sentry** pour les erreurs prod (cohérent avec ta spec).
- **PostHog** pour les analytics produit (alternative à Plausible si tu veux funnels + heatmaps en plus du tracking simple).

---

## Hosting

- **Plugin Minecraft** : pas hosté côté Interfaze, exécuté chez les admins.
- **Backend Node** : Fly.io (ce que ta spec recommande, bon choix), ou Railway. Les deux sont OK. Fly = multi-région built-in. Railway = DX plus simple. Fly pour ce produit (les WS persistants bénéficient de la régionalité).
- **Frontend** : Cloudflare Pages (cohérent avec R2 + CDN, free tier généreux). Vercel marche aussi mais coûte vite cher au scale.
- **Workers de génération de packs** : Fly Machines (containers à la demande pour les jobs lourds — sharp + archiver) ou un service Node séparé.

---

## Choses encore ouvertes / à revisiter

- **Vault vs alternatives économies** : V1 = Vault uniquement, comme la spec le dit. Réévaluer après le launch selon les retours.
- **PlaceholderAPI : direct ou abstraction ?** Probablement direct pour V1, abstraction si on veut auto-completion riche.
- **Format de signature des bundles** : ECDSA P-256 dans la spec. À confirmer au moment d'implémenter.
- **i18n du backend (messages d'erreur)** : pas critique au MVP, à reprendre après FR + EN front.
- **Migration runtime du JSON menu** (v1 → v2 etc.) : où vit le moteur de migrations ? Côté plugin uniquement, côté backend, ou les deux ? À trancher en V1.5.

---

## Ce qu'on a écarté et pourquoi (mémo rapide)

- **Sequelize** : pré-TS, verbeux, écosystème en déclin.
- **Prisma** : excellent mais lourd (moteur Rust séparé, codegen) ; Drizzle est plus prévisible.
- **Express** : 5x plus lent que Fastify, pas de validation JSON Schema intégrée.
- **socket.io** : protocole proprio, lourd, inadapté à un contrat JSON simple.
- **NextAuth** : bound à Next.js, on est sur Fastify.
- **Mantine** : excellent en 2022, mais en 2026 shadcn s'est imposé pour les produits qui veulent un design owned.
- **Redux** : trop de boilerplate pour ce projet ; Zustand couvre les besoins.
- **Jest** : remplacé par Vitest qui s'intègre à Vite et tourne plus vite.
- **AWS S3** direct : R2 est moins cher (pas d'egress) avec un CDN inclus.
- **Iframe d'adventure-webui** : pas d'intégration avec notre state, dépendance externe ; on écrit notre parser MiniMessage TS-natif.
- **Système translatable_key vanilla Minecraft** : limité à la locale client, pas de composition avec PAPI ; on fait l'i18n server-side.
