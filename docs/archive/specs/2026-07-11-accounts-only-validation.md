# Validation accounts-only — smoke manuel (Docker)

1. Serveur keyless : `/artisan editor` → hint + flow Link ; `/artisan setup` → code → claim web (compte requis) → clé poussée → connecté.
2. Serveur linké : `/artisan setup` → refus « déjà lié au network X » ; `/artisan editor` → URL éditeur + nom du network, aucun code.
3. Éditeur connecté (compte membre) : projects visibles, module Boutique monté (presence user), assets éditables, deploy OK, draft co-edit entre deux onglets, module_event live.
4. Non-membre : aucun accès au network/projects (403 propres, pas de boucle réseau).
5. `/session?token=whatever` → redirect login avec message.
6. `/artisan trusteditor X` → n'existe plus (usage).
7. Grep d'extinction backend + éditeur (cf. Tasks 7/8) revérifiés sur main.
