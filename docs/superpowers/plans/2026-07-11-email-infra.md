# Infra Email Scaleway TEM (bloc ②) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Une brique d'envoi d'emails transactionnels (SMTP Scaleway TEM) réutilisable, avec un premier consommateur réel (email de bienvenue au signup) qui prouve le pipeline de bout en bout.

**Architecture:** Une lib backend (`lib/mail/`) — pas un module domaine : interface `Mailer` + transport SMTP (nodemailer) + transport fake injectable pour les tests ; config par env, **no-op silencieux quand non configuré** (dev/tests) avec un WARN au premier envoi tenté ; templates = fonctions typées bilingues (en/fr), pas de moteur. Pas de queue ni retry (posture single-instance actuelle — backlog prod-readiness). Consommateurs futurs : invitations Members (bloc ③), billing (payment failed…).

**Tech Stack:** Bun + Hono, nodemailer (SMTP), Scaleway TEM comme fournisseur (SMTP standard — rien de propriétaire dans le code).

## Global Constraints

- Backend : **TOUJOURS `bun run test`, JAMAIS `bun test`**.
- Aucun secret en dur ; env vars : `SMTP_HOST`, `SMTP_PORT` (défaut 587), `SMTP_USER`, `SMTP_PASS`, `MAIL_FROM` (ex. `Artisan <no-reply@artisanmc.net>`). Toutes vides = mailer désactivé.
- Les envois sont fire-and-forget côté appelant : un échec SMTP ne fait JAMAIS échouer la requête HTTP porteuse (log ERROR + continue).
- Docs same-commit : `.env.example` + tableau env de `CLAUDE.md` ; `docs/decisions/stack.md` (ligne Scaleway TEM) ; CHANGELOG.
- **Verify-first nodemailer×Bun** (Task 1 Step 0) : si `createTransport`/`sendMail` s'avèrent incompatibles Bun, pivoter vers l'API HTTP Scaleway TEM (fetch + `X-Auth-Token`) derrière la MÊME interface `Mailer` — le reste du plan ne change pas ; documenter le pivot dans stack.md.
- Git : conventional commits, chemins explicites.

---

### Task 1: `Mailer` — interface, transport SMTP, no-op, fake de test

**Files:**
- Create: `backend/src/lib/mail/mailer.ts`
- Modify: `backend/package.json` (+ nodemailer, + `@types/nodemailer` dev)
- Test: `backend/src/lib/mail/mailer.test.ts` (create)

**Interfaces:**
- Produces:

```typescript
export interface MailMessage { to: string; subject: string; text: string; html?: string; }
export interface Mailer { send(msg: MailMessage): Promise<void>; readonly enabled: boolean; }
export function createMailerFromEnv(env?: Record<string, string | undefined>): Mailer;
export function __setMailerForTests(m: Mailer | null): void; // court-circuite getMailer()
export function getMailer(): Mailer; // singleton paresseux depuis process.env
```

Sémantique : env incomplet → mailer `enabled: false`, `send()` = no-op qui log UN `console.warn` la première fois seulement (« mailer disabled — SMTP_* not configured ») ; env complet → nodemailer `createTransport({host, port, auth})`, `send` mappe vers `sendMail({from: MAIL_FROM, ...})` ; toute erreur de transport est catchée, loggée `console.error`, jamais relancée.

- [ ] **Step 0 (verify-first):** `cd backend && bun add nodemailer && bun add -d @types/nodemailer`, puis un script jetable dans le scratchpad qui fait `createTransport({host:"localhost",port:1}).verify().catch(e=>console.log("transport constructible, erreur réseau attendue:", e.code))` — le but est UNIQUEMENT de vérifier que nodemailer se charge et se construit sous Bun sans crash d'import. S'il ne charge pas : pivot API HTTP (constraint globale) et adapter l'implémentation du transport (interface inchangée).

- [ ] **Step 1: Test qui échoue**

```typescript
import { describe, expect, it, beforeEach } from "bun:test";
import { createMailerFromEnv, getMailer, __setMailerForTests, type MailMessage } from "./mailer";

describe("mailer", () => {
  beforeEach(() => __setMailerForTests(null));

  it("is disabled and no-ops when env is incomplete", async () => {
    const m = createMailerFromEnv({});
    expect(m.enabled).toBe(false);
    await m.send({ to: "a@b.c", subject: "s", text: "t" }); // ne throw pas
  });

  it("is enabled when all SMTP vars are present", () => {
    const m = createMailerFromEnv({
      SMTP_HOST: "smtp.tem.scw.cloud", SMTP_PORT: "587",
      SMTP_USER: "u", SMTP_PASS: "p", MAIL_FROM: "Artisan <no-reply@artisanmc.net>",
    });
    expect(m.enabled).toBe(true);
  });

  it("getMailer honors the test override", async () => {
    const sent: MailMessage[] = [];
    __setMailerForTests({ enabled: true, send: async (msg) => { sent.push(msg); } });
    await getMailer().send({ to: "x@y.z", subject: "hello", text: "body" });
    expect(sent).toHaveLength(1);
    expect(sent[0].subject).toBe("hello");
  });

  it("transport errors are swallowed and logged, never thrown", async () => {
    // mailer enabled pointant vers un host invalide → send résout sans throw
    const m = createMailerFromEnv({
      SMTP_HOST: "127.0.0.1", SMTP_PORT: "1",
      SMTP_USER: "u", SMTP_PASS: "p", MAIL_FROM: "t@t.t",
    });
    await m.send({ to: "a@b.c", subject: "s", text: "t" }); // catch interne
  });
});
```

- [ ] **Step 2: RED** — `cd backend && bun run test` (module absent).
- [ ] **Step 3: Implémenter** `mailer.ts` selon la sémantique ci-dessus (~60 lignes ; le singleton `getMailer` lit `process.env` au premier appel ; `__setMailerForTests` prime).
- [ ] **Step 4: GREEN suite complète.**
- [ ] **Step 5: Commit** — `rtk git add backend/src/lib/mail/mailer.ts backend/src/lib/mail/mailer.test.ts backend/package.json backend/bun.lock && rtk git commit -m "feat(backend): transactional mailer (SMTP, env-gated no-op, test override)"` (adapter le nom du lockfile réel).

---

### Task 2: Templates bilingues typés

**Files:**
- Create: `backend/src/lib/mail/templates.ts`
- Test: `backend/src/lib/mail/templates.test.ts` (create)

**Interfaces:**
- Produces:

```typescript
export type MailLocale = "en" | "fr";
export function welcomeEmail(params: { to: string; displayName: string; locale?: MailLocale }): MailMessage;
```

`welcomeEmail` : subject en `Welcome to Artisan` / fr `Bienvenue sur Artisan` ; text = 3-4 lignes (bienvenue, lien éditeur `EDITOR_URL` env — défaut `http://localhost:5173` —, signature) ; html = même contenu dans un template inline minimal (un `<div>` stylé inline, pas de framework). Locale défaut `"en"`. Le pattern (params typés → `MailMessage`) est le contrat pour les templates futurs (invitation, billing).

- [ ] **Step 1: Test qui échoue**

```typescript
import { describe, expect, it } from "bun:test";
import { welcomeEmail } from "./templates";

describe("welcomeEmail", () => {
  it("builds an english message by default", () => {
    const msg = welcomeEmail({ to: "iban@example.com", displayName: "Iban" });
    expect(msg.to).toBe("iban@example.com");
    expect(msg.subject).toBe("Welcome to Artisan");
    expect(msg.text).toContain("Iban");
    expect(msg.html).toContain("Iban");
  });

  it("builds french when asked", () => {
    const msg = welcomeEmail({ to: "a@b.c", displayName: "Iban", locale: "fr" });
    expect(msg.subject).toBe("Bienvenue sur Artisan");
  });
});
```

- [ ] **Step 2-4: RED → implémenter → GREEN.**
- [ ] **Step 5: Commit** `feat(backend): typed bilingual mail templates (welcome)`.

---

### Task 3: Premier consommateur — bienvenue au signup + docs env

**Files:**
- Modify: `backend/src/routes/auth.ts` (handler signup :27)
- Modify: `.env.example`, `CLAUDE.md` (tableau env), `docs/decisions/stack.md`, `CHANGELOG.md`
- Test: `backend/src/routes/auth.test.ts` (étendre)

**Interfaces:**
- Consumes: `getMailer()` + `welcomeEmail` (Tasks 1-2).
- Produces: à la fin d'un signup réussi (email/password — repérer aussi le callback Discord si un compte y est créé et l'ajouter là aussi), fire-and-forget : `getMailer().send(welcomeEmail({ to: email, displayName }))` — hors du chemin de réponse (pas d'await bloquant la réponse : `void ...send(...)` ou `.catch(()=>{})` selon le style du fichier ; l'échec ne casse jamais le signup).

- [ ] **Step 1: Test qui échoue** (dans auth.test.ts, harness du fichier) : `__setMailerForTests` avec un fake accumulateur → POST signup → un message capturé, `to` = email du signup, subject contient Welcome ; ET un test signup avec fake qui throw → signup répond quand même 200/201.
- [ ] **Step 2-3: RED → wiring → GREEN suite.**
- [ ] **Step 4: Docs** — `.env.example` : bloc SMTP commenté avec les 5 vars + note Scaleway TEM (`smtp.tem.scw.cloud:587`) ; CLAUDE.md tableau env : 5 lignes ; stack.md : ligne « Emails transactionnels : Scaleway TEM via SMTP (nodemailer) — 2026-07-11 » (+ pivot HTTP si Task 1 a pivoté) ; CHANGELOG `### Added — transactional mail infra (Scaleway TEM SMTP) + welcome email on signup`.
- [ ] **Step 5: Commit** `feat(backend): welcome email on signup (fire-and-forget) + SMTP env docs`.

---

### Task 4: Script d'envoi réel + checklist

**Files:**
- Create: `backend/scripts/send-test-email.ts`
- Create: `docs/superpowers/specs/2026-07-11-email-validation.md`

- [ ] **Step 1: Script** (pattern des scripts existants du dossier) :

```typescript
// Usage: bun backend/scripts/send-test-email.ts <adresse> [locale]
// Requiert SMTP_* + MAIL_FROM dans l'environnement (.env). Échoue bruyamment.
import { createMailerFromEnv } from "../src/lib/mail/mailer";
import { welcomeEmail } from "../src/lib/mail/templates";

const to = process.argv[2];
if (!to) { console.error("Usage: bun scripts/send-test-email.ts <adresse> [en|fr]"); process.exit(1); }
const mailer = createMailerFromEnv(process.env);
if (!mailer.enabled) { console.error("SMTP_* non configurées."); process.exit(1); }
await mailer.send(welcomeEmail({ to, displayName: to.split("@")[0], locale: (process.argv[3] as "en" | "fr") ?? "en" }));
console.log(`Envoyé à ${to}.`);
```

(le `send` de Task 1 avale les erreurs — pour ce script, exposer aussi l'erreur : soit un mode strict optionnel sur `send`, soit le script utilise directement le transport ; choisir la plus simple et la noter.)

- [ ] **Step 2: Checklist** (`2026-07-11-email-validation.md`) :

```markdown
# Validation email — manuel (nécessite un domaine TEM configuré)

Pré-requis utilisateur : projet Scaleway + domaine TEM validé (SPF/DKIM/DMARC), credentials SMTP.
1. Renseigner SMTP_HOST=smtp.tem.scw.cloud, SMTP_PORT=587, SMTP_USER, SMTP_PASS, MAIL_FROM dans backend/.env.
2. `bun backend/scripts/send-test-email.ts <ton adresse>` → mail reçu (vérifier spam), FROM correct, rendu html.
3. Variante fr : `... <adresse> fr`.
4. Signup réel sur l'éditeur local → mail de bienvenue reçu ; signup avec SMTP_* vides → aucun envoi, aucun WARN répété (un seul au premier essai).
5. Coolify prod : ajouter les env vars au service backend avant de compter dessus.
```

- [ ] **Step 3: Commit** `chore(backend): real-send test script + email validation checklist`.

---

## Vérification finale
- [ ] `cd backend && bun run test` vert (jamais `bun test`).
- [ ] `.env.example`/CLAUDE.md/stack.md/CHANGELOG à jour.
- [ ] Checklist manuelle à dérouler quand le domaine TEM existera (bloquant utilisateur : création du domaine + credentials).

## Risques
- **nodemailer × Bun** : verify-first en Task 1 Step 0 ; pivot API HTTP Scaleway prévu derrière la même interface.
- Pas de queue/retry : assumé (single-instance) ; à revisiter avec le backlog prod-readiness.
- Le domaine TEM (SPF/DKIM) est un prérequis UTILISATEUR pour la validation réelle — le code ship avant, désactivé par défaut.
