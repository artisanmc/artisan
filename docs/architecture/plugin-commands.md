# Commandes plugin `/artisan`

Détail dev-facing. Source de vérité : `plugin/paper/src/main/kotlin/net/artisanmc/plugin/command/ArtisanCommand.kt`.
La table user-facing (EN) vit dans `docs/site/getting-started/install-admin.md` —
les deux doivent bouger ensemble.

| Sous-commande | Effet |
|---|---|
| `menu <menu_id>` | Permission `artisan.menu`. Ouvre un menu. Joueurs uniquement (`in_game_only` sinon). Résout la langue via `lang.playerLang(sender)`. |
| `reload` | Permission `artisan.admin`. `reinit(loadPluginConfig())`, qui recrée le provider et le charge : une seule relecture du disque. Reprend `language` / `per_player_language` et les éditions faites à la main sur le disque. Ne redémarre pas le serveur web : `web.*` demande un redémarrage. |
| `sync status` | Message fixe renvoyant aux logs (vestige de la synchro cloud). |
| `sync reject` | Permission `artisan.admin`. `menuProvider.unload()/load()` — recharge depuis le disque et, sur une feuille, reconnecte au hub. |
| `editor` | Lien de connexion à l'éditeur. Cf. ci-dessous. |
| `dump-title <menu_id> [lang]` | Permission `artisan.admin`. **Diagnostic**, non documenté côté user. Compile le titre du menu et imprime chaque étape : le MiniMessage exact émis, les advances d'offset, et le curseur X MC à chaque frontière de layer. À utiliser quand la position en jeu diffère de l'aperçu éditeur. |

Supprimés en phase F : `link <code>` (liaison au cloud), `member add <email>` (accès console),
et avec eux `editor.access_mode` / `editor.console_only`.

## `editor`

Sans `artisan.editor.view` : refus. Depuis la console : identité **Console** partagée
(`ArtisanCommand.CONSOLE_ID`, UUID nul, nom `Console`), avec les permissions de la console,
et le lien imprimé en clair (`editor_link_console`, rien à cliquer). Sans `web.url`, l'adresse
est `server-ip`, sinon `localhost`. La relecture des permissions ne touche jamais cette session
(elle ne lit que les joueurs en ligne) : elle vit jusqu'à expiration ou `editor logout`.

**Serveur seul ou hub** (`web.hub` vide, serveur web démarré) : imprime un lien
`<base>/login/<jeton>` à usage unique, valable 60 s, un par joueur et par minute
(`hub/Sessions.kt`). `<base>` vaut `web.url`, sinon `http://<adresse rejointe par le joueur>:<port>`.
La session ouverte porte l'UUID du joueur et ses permissions `artisan.editor.view|edit|publish|config`
au moment de la demande (`artisan.editor` les donne toutes). Serveur web absent (`web.enabled: false`,
port pris, Jetty non téléchargé) : `editor_disabled`.

**Feuille du réseau** (`web.hub` renseigné) : le serveur lit les mêmes permissions et demande le lien
au hub par `/ws/plugin` (`editor_link`, réponse `editor_link_result`). Le hub ne consulte aucune
permission lui-même. `<base>` vaut le `web.url` du hub, sinon l'adresse rejointe par le joueur avec
le port du hub. Hub injoignable : `editor_hub_offline`.

**Permissions relues** : chaque minute, le serveur envoie au hub les permissions éditeur de ses
joueurs en ligne (`editor_permissions` depuis une feuille, appel direct sur le hub). Elles
remplacent celles des sessions que **ce serveur** a émises (colonne `origin` = server id) ; sans
`artisan.editor.view`, ces sessions sont fermées. Un autre serveur ne touche pas aux sessions
qu'il n'a pas émises (permissions LuckPerms par serveur).

## `editor logout [joueur]`

Ferme toutes les sessions éditeur d'un joueur, quel que soit le serveur d'origine. Sans argument :
soi-même (en jeu), Console (depuis la console). `Console` se nomme comme un joueur. Avec un joueur (en ligne ou connu du serveur) : `artisan.admin`, console comprise.
Sur une feuille, passe par le hub (`editor_logout` → `editor_logout_result {ok, closed}`).
