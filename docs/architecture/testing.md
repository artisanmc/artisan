# Tests — couverture par couche

Zones couvertes, pas liste de fichiers — `glob **/*.test.*` donne la liste exacte et à jour.

| Couche | Lancer | Zones couvertes |
|---|---|---|
| Backend (~47 fichiers) | `cd backend && bun run test` | hub WS, bundles, server-keys, ws-ticket, auth (signup/login/Discord/session), networks + branches + commits + merge engine, custom items, resource pack (builder / font json / asset index / space offsets / storage), assets (PATCH height, duplicate), version-conflict guard, project import. |
| Plugin (~45 fichiers) | `cd plugin && ./gradlew test` | bundle hash/download, conflict detection, full-sync intégration (MockWebServer), action parse/exec (incl. `show_title`), title parser/compiler + offset encoder, asset catalog, resource pack manager/delegator, config, project deleter, local push. |
| Éditeur (≥120 fichiers) | `cd editor && npm test` | expr DSL (lexer/parser/eval/template), canvas + édition de Document, export (transform/validate/zip), i18n, custom items & assets Library, title composer v3, merge/conflits, auth UI, networks/setup/account routes. |
| E2E éditeur | `cd editor && npx playwright test` | `smoke.spec.ts` — canvas charge, sidebar visible (1 test). |

E2E cross-stack (éditeur → backend → plugin de bout en bout) : **non automatisé**, test manuel via
Docker.

## Backend — `bun run test`, jamais `bun test`

Le wrapper `scripts/test.ts` redirige `DATABASE_URL` vers la DB `artisan_test` (auto-create +
migrate) avant de spawner vitest. `bun test` direct bypasse le wrapper, et les `beforeEach(clearAll)`
des tests vident alors la DB **dev** `artisan` — incident réel le 2026-06-01, toutes les données dev
wipées. Si tu vois `bun test src/...` dans un terminal d'agent, c'est un bug.

Garde mécanique : `db/index.ts` throw si `NODE_ENV=test` et que le nom de la DB ne contient pas
`test`.

Override l'URL admin via `ADMIN_DATABASE_URL` si Postgres n'est pas sur
`postgres/postgres@localhost:5432`.

## Vecteurs de conformance cross-langage

Trois vecteurs partagés verrouillent une égalité entre implémentations Kotlin et TS. Changer l'algo
= mettre à jour les deux côtés **et** régénérer le vecteur.

| Vecteur | Asservi par |
|---|---|
| `testdata/project-hash-conformance.json` | `BundleHashConformanceTest` (plugin) + `hashUtils.test.ts` (backend) |
| `testdata/lang-tree-conformance.json` | `LangFlattener` (plugin) + `langTree.ts` (éditeur) |
| `testdata/i18n-address-conformance.json` | `I18nAddresses.kt` (plugin) + sites i18n éditeur |
