# E2E manuel — Sync model (suppressions + divergences + DELETE project)

Scénario à exécuter manuellement après le merge du feature `sync-deletion`. Cross-stack : backend + editor + plugin Docker.

## Préparation

```bash
cd /path/to/Artisan
docker compose up -d
```

Attendre que les trois services soient up : backend (3001), editor (5173), minecraft (25565).

## Bug A — suppressions éditeur propagées sur disque

1. Ouvrir l'éditeur (URL via `/artisan editor` en jeu), créer un project `e2e_test`.
2. Ajouter 3 menus : `menu_a`, `menu_b`, `menu_c`. Publier.
3. Sur le serveur Minecraft, vérifier que `/server-data/plugins/Artisan/projects/e2e_test/menus/` contient les 3 YAML.
4. Dans l'éditeur, supprimer `menu_b`. Publier.
5. **Attendu :** `menus/menu_b.yaml` disparait du disque serveur. `menu_a.yaml` et `menu_c.yaml` restent. `.artisan-sync.yaml` conservé.

## Bug B — divergence disque ↔ backend détectée et résolue

### Sous-scénario 1 : LOCAL_ONLY, "Garder l'éditeur"

1. Stopper le serveur Minecraft (`docker compose stop minecraft`).
2. SSH (ou exec) dans le container, supprimer un YAML manuellement : `rm /server-data/plugins/Artisan/projects/e2e_test/menus/menu_c.yaml`.
3. Redémarrer le serveur.
4. Ouvrir l'éditeur. **Attendu :** banner conflit en haut du canvas avec "1 conflit détecté".
5. Cliquer "Voir détails" → modal liste `e2e_test` avec `- 1 fichier supprimé (menus/menu_c.yaml)`.
6. Cliquer "Garder l'éditeur".
7. **Attendu :** banner disparait, `menu_c.yaml` réapparait sur disque serveur.

### Sous-scénario 2 : modification, "Utiliser le serveur"

1. Stopper, modifier `menus/menu_a.yaml` côté disque (changer la taille ou un texte), redémarrer.
2. Ouvrir l'éditeur → banner.
3. Cliquer "Utiliser le serveur".
4. **Attendu :** le contenu de `menu_a` dans l'éditeur reflète la modif disque.

### Sous-scénario 3 : aucun éditeur ouvert au moment de la détection

1. Stopper, supprimer un fichier, redémarrer.
2. Vérifier qu'aucun éditeur n'est ouvert. Pas de modal de pop-up évidemment.
3. Ouvrir l'éditeur plus tard. **Attendu :** banner apparait.

## DELETE project — flux complet

1. Dans l'éditeur, ouvrir le menu d'action du project `e2e_test`, cliquer "Supprimer le project".
2. **Attendu :** modal "Supprimer le project «e2e_test» ?" avec champ type-to-confirm.
3. Taper "e2e_test" exactement. Bouton "Supprimer" s'active.
4. Cliquer "Supprimer".
5. **Attendu :**
   - Le project disparait de la liste éditeur.
   - Sur le disque serveur, le dossier `projects/e2e_test/` est déplacé vers `projects/.artisan-trash/e2e_test-<timestamp>/`.
   - Aucune erreur dans les logs plugin.

## Edge cases à observer

- **Multi-onglets** : ouvrir deux onglets éditeur. Provoquer un conflit. Un onglet résout. Vérifier que l'autre onglet voit le banner disparaître automatiquement (via `pack_conflict_resolved`).
- **Publish pendant conflit** : provoquer un conflit, vérifier que le bouton Publier est désactivé pour le project en question.
- **Reload pendant freeze** : provoquer un conflit, ne pas le résoudre, exécuter `/artisan reload` en jeu. Vérifier qu'aucun `bundle_available` n'est broadcast (le project reste sur sa version disque actuelle).
