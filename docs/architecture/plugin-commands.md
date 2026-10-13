# Commandes plugin `/artisan`

Détail dev-facing. Source de vérité : `plugin/paper/src/main/kotlin/net/artisanmc/plugin/command/ArtisanCommand.kt`.
La table user-facing (EN) vit dans `docs-site/src/content/docs/getting-started/install-admin.md` §5 —
les deux doivent bouger ensemble.

| Sous-commande | Effet |
|---|---|
| `menu <menu_id>` | Ouvre un menu. Joueurs uniquement (`in_game_only` sinon). Résout la langue via `lang.playerLang(sender)`. |
| `reload` | `reloadConfig()` + `reinit(PluginConfig.from(...))` + `menuProvider.unload()/load()`. Reprend donc aussi les options `language` / `per_player_language` sans restart, pas seulement les YAML. |
| `sync status` | Imprime le dernier statut de synchro. |
| `sync reject` | `menuProvider.unload()/load()` — recharge depuis le disque et reconnecte. |
| `link <code>` | Editor-first linking, cf. ci-dessous. |
| `editor` | Lien de connexion à l'éditeur servi par le plugin ; sinon informatif (cloud). Cf. ci-dessous. |
| `member add <email>` | Console/RCON uniquement, `editor.access_mode: console` requis. Ajoute un compte existant comme membre de tout le réseau du serveur, sans changer un rôle existant. |
| `dump-title <menu_id> [lang]` | **Diagnostic**, non documenté côté user. Compile le titre du menu et imprime chaque étape : le MiniMessage exact émis, les advances d'offset, et le curseur X MC à chaque frontière de layer. À utiliser quand la position en jeu diffère de l'aperçu éditeur. |

## `link <code>`

Editor-first linking — cf. ADR `editor-first-server-linking`. Le code est **minté par l'éditeur**
quand on ajoute un serveur ; la commande le redeem via `POST /api/v1/link/:code/redeem` (la base HTTP
est dérivée de `ws_url`), écrit le `server_key` dans `config.yml` (`ConfigWriter.writeServerKey`),
puis reinit + connecte.

Sur un serveur **déjà lié** → **écrase** la clé (rotation / bascule), WARN log, **pas de refus**.

`/artisan setup` (+ le pairing WS `SetupClient`) a été supprimé le 2026-07-15.

## `editor`

**Éditeur servi par le plugin** (`web.enabled`, serveur web démarré) : en jeu seulement, imprime
un lien `<base>/login/<jeton>` à usage unique, valable 60 s, un par joueur et par minute
(`hub/Sessions.kt`). `<base>` vaut `web.url`, sinon `http://<adresse rejointe par le joueur>:<port>`.
La session ouverte porte l'UUID du joueur et ses permissions `artisan.editor.view|edit|publish|config`
au moment de la demande (`artisan.editor` les donne toutes). Sans `view` : refus.

**Sur une feuille du réseau** (`web.role: leaf`) : le serveur lit les mêmes permissions et
demande le lien au hub par `/ws/plugin` (`editor_link`, réponse `editor_link_result`). Le hub
ne consulte aucune permission lui-même. `<base>` vaut le `web.url` du hub, sinon l'adresse
rejointe par le joueur avec le port du hub. Hub injoignable : `editor_hub_offline`.

**Sinon (cloud), purement informatif**, accounts-only — aucune session ni trust en jeu.

- Linké + connecté → imprime le deep-link `server_url` + le nom du network (depuis `hello_ack`).
- Linké mais pas encore connecté → « connecting, retry shortly ».
- Pas linké → imprime l'URL home de l'éditeur (dérivée de `ws_url`) pour aller créer le serveur.

