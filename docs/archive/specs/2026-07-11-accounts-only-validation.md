# Accounts-only validation — manual smoke test (Docker)

1. Keyless server: `/artisan editor` → hint + Link flow; `/artisan setup` → code → web claim (account required) → key pushed → connected.
2. Linked server: `/artisan setup` → refusal "already linked to network X"; `/artisan editor` → editor URL + network name, no code.
3. Signed-in editor (member account): projects visible, Boutique module mounted (user presence), assets editable, deploy OK, draft co-edit between two tabs, live module_event.
4. Non-member: no access to the network/projects (clean 403s, no network loop).
5. `/session?token=whatever` → redirect to login with a message.
6. `/artisan trusteditor X` → no longer exists (usage).
7. Backend + editor extinction grep (cf. Tasks 7/8) rechecked on main.
