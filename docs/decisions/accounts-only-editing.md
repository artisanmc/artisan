# Accounts-only editing — removing the anonymous session mode

**Status: superseded (phase F, 2026-10)** — no more accounts: identity is the player who requested the `/artisan editor` link, and rights are their `artisan.editor.*` permissions. See [editor-web-server](editor-web-server.md).

**Status: accepted (2026-07-11).** Decision from a grill-with-docs session; the terms `Link` and `Membership` were fixed in `CONTEXT.md` the same day.

Web editing now requires an account: the anonymous session link issued by `/artisan editor` (`trusteditor` trust dance, `/api/v1/editor-session/:token/*` REST surface, editor `sessionStore`) is removed — a hard cutover, no coexistence window. `/artisan editor` becomes purely informational (link code if the Server is blank, editor URL otherwise), permission to edit is carried by the **Membership** (owner/member, Network scope, centralized capability checks), and team entry is by invitation (link + email — Scaleway TEM infra). The plugin ↔ backend sync (server key, bundles, `local_push`/FTP) is not affected: it is server auth, not a browser session.

## Why

**Limited amendment — hosted demo (2026-09-13).** A guest session may edit only
its temporary hosted project. It creates no User, Network or Server; the shared
authorization receives a guest principal bounded to the project. Servers, billed
AI and other projects' data remain reserved for authorized accounts. After
sign-in, a durable claim attaches the same project to an authorized Network and
revokes the guest. This flow does not bring back the old anonymous sessions tied
to servers.

Session mode dates from V1, before the accounts/networks system. Since then it has been a **second complete auth model**: every feature pays the tax twice (twin REST routes `editor-session/*` vs `user/*`, session/user branches in auto-save, deploy, presence, the assistant). The week of 2026-07-07 gave an empirical measure: five distinct bugs attributable to the duality, including a UX ejection in dual-auth mode (cookie 403 on a network authorized by session), orphan server keys created by `/artisan setup` rerun against an incomprehensible UI, a backend crash (uncaught duplicate key) triggered by that same setup, and user-auth deploys that lost module files (modules only registered in session mode).

## Rejected alternatives

- **Keep both modes**: the tax is structural, not transitional — every new screen/endpoint would have to reason about both identities forever.
- **Deprecation window**: a tool for not breaking existing clients; the product is pre-launch, there are none.
- **Anonymous session "upgradeable" to an account**: keeps all the session machinery for a marginal onboarding benefit compared to the accounts claim flow (in-game link → Discord OAuth → linked server, ~30 s, once).

## Consequences

- Accepted friction on first contact (sign-in wall) — a trade-off accepted against removing a whole class of bugs; billing assumes accounts anyway.
- The trust dance disappears **with no replacement**: the proof "I am admin of this server" is given once at the Link; after that the Membership authorizes.
- Sequencing: ① accounts-only cutover → ② email infra (Scaleway TEM) → ③ Members (roles + invitations). Each block ships on its own.
