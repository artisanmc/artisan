# Commandes plugin `/artisan`

Détail dev-facing. Source de vérité : `plugin/paper/src/main/kotlin/net/artisanmc/plugin/command/ArtisanCommand.kt`.
La table user-facing (EN) vit dans `docs-site/src/content/docs/getting-started/install-admin.md` —
les deux doivent bouger ensemble.

| Sous-commande | Effet |
|---|---|
| `menu <menu_id>` | Ouvre un menu. Joueurs uniquement (`in_game_only` sinon). Résout la langue via `lang.playerLang(sender)`. |
| `reload` | `reinit(loadPluginConfig())` + `menuProvider.unload()/load()`. Reprend `language` / `per_player_language` et les éditions faites à la main sur le disque. Ne redémarre pas le serveur web : `web.*` demande un redémarrage. |
| `sync status` | Message fixe renvoyant aux logs (vestige de la synchro cloud). |
| `sync reject` | `menuProvider.unload()/load()` — recharge depuis le disque et, sur une feuille, reconnecte au hub. |
| `editor` | Lien de connexion à l'éditeur. Cf. ci-dessous. |
| `dump-title <menu_id> [lang]` | **Diagnostic**, non documenté côté user. Compile le titre du menu et imprime chaque étape : le MiniMessage exact émis, les advances d'offset, et le curseur X MC à chaque frontière de layer. À utiliser quand la position en jeu diffère de l'aperçu éditeur. |

Supprimés en phase F : `link <code>` (liaison au cloud), `member add <email>` (accès console),
et avec eux `editor.access_mode` / `editor.console_only`.

## `editor`

En jeu seulement (`editor_in_game_only` sinon) ; sans `artisan.editor.view` : refus.

**Serveur seul ou hub** (`web.role: hub`, serveur web démarré) : imprime un lien
`<base>/login/<jeton>` à usage unique, valable 60 s, un par joueur et par minute
(`hub/Sessions.kt`). `<base>` vaut `web.url`, sinon `http://<adresse rejointe par le joueur>:<port>`.
La session ouverte porte l'UUID du joueur et ses permissions `artisan.editor.view|edit|publish|config`
au moment de la demande (`artisan.editor` les donne toutes). Serveur web absent (`web.enabled: false`,
port pris, Jetty non téléchargé) : `editor_disabled`.

**Feuille du réseau** (`web.role: leaf`) : le serveur lit les mêmes permissions et demande le lien
au hub par `/ws/plugin` (`editor_link`, réponse `editor_link_result`). Le hub ne consulte aucune
permission lui-même. `<base>` vaut le `web.url` du hub, sinon l'adresse rejointe par le joueur avec
le port du hub. Hub injoignable : `editor_hub_offline`.
