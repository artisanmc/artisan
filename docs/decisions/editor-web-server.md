# Le serveur web de l'éditeur auto-hébergé

**Statut :** accepté (2026-10-12). Phase B du plan d'auto-hébergement.

## Contexte

Sans backend, le plugin sert lui-même l'éditeur, son API et ses WebSockets. Le plan
prévoyait Javalin. Javalin 7 est écrit en Kotlin et tire `kotlin-stdlib` 2.2 ; chargé
par `libraries:`, il cohabiterait avec le Kotlin 2.0 embarqué dans le jar, et tout
appel qui fait passer un type `kotlin.*` d'un côté à l'autre casse au chargement
(la famille de `LinkageError` déjà rencontrée, cf. `paper/build.gradle.kts`).

## Décisions

**① Jetty 12, sans surcouche.** Java pur, cinq dépendances (`jetty-server`,
`jetty-websocket-jetty-server` et leurs transitives, slf4j déjà fourni par Paper).
Le routage tient dans `hub/Http.kt` : une table de routes `méthode + /segments/:param`.

**② Téléchargé par Paper.** Déclaré dans `libraries:` de `plugin.yml`, comme HikariCP.
Un serveur sans accès sortant démarre sans éditeur (le `LinkageError` est rattrapé).

**③ Module `hub`, sans Bukkit.** Il ne voit le jeu qu'à travers les ports de `core`.
`paper` le construit dans `ArtisanPlugin` et l'arrête dans `onDisable`.

**④ Configuration dans `environment.yml`** (`web.enabled|port|bind|url`), jamais
écrite par l'éditeur : une erreur depuis la page de configuration ne doit pas
couper l'accès à l'éditeur lui-même.

**⑤ Connexion par lien en jeu.** `/artisan editor` donne un jeton à usage unique
(60 s, un par joueur et par minute) ; `/login/<jeton>` ouvre une session (cookie
`HttpOnly`, `SameSite=Strict`, 12 h). L'identité est l'UUID du joueur, les droits
sont ses permissions `artisan.editor.*` au moment de la demande. Toute route de
l'API exige une session ; une requête qui modifie quelque chose ou ouvre un
WebSocket doit venir de la même origine que la page.

**⑥ Mêmes routes que le backend, en attendant l'éditeur réécrit.** Le hub sert le
sous-ensemble des routes REST que l'éditeur appelle (`AccountRoutes`, `ServerRoutes`,
`ProjectRoutes`), avec un réseau et un serveur uniques nommés `local` et l'identité
d'un Project égale au nom de son dossier. Chaque route traduit sa requête en message
du protocole (`project_read`, `project_write`, `project_draft_request`…) passé par
`ServerLink` aux gestionnaires existants : aucune logique de Project n'est dupliquée.
Les brouillons privés restent sur le disque du serveur, un jeu par UUID de joueur.
Sans équivalent pour l'instant : Versions (vides).

**⑦ Items et textures vanilla sans backend.** Le catalogue d'items (`tools/minecraft-assets/items`)
voyage dans le jar ; les icônes 3D (`tools/minecraft-assets/icons`) aussi avec `-PwithEditor`. Les
textures sont extraites du jar client Mojang, téléchargé et vérifié (SHA-1) à la première
texture demandée, dans `plugins/Artisan/cache/minecraft/<version>/`. Les items custom se
lisent directement dans `CustomItemsManager` (`ItemRoutes`, `VanillaAssets`).
*Rejeté :* télécharger les icônes depuis les releases GitHub (dépôt privé).

**⑧ Le pack, servi par le serveur.** L'éditeur envoie le zip qu'il construit ; le hub le
garde sous son SHA-1 (`PackStore`, trois derniers), le sert publiquement sous
`/resource-pack/<sha1>.zip` et le remet au `ResourcePackManager` avec cette URL. Délégation
et envoi direct restent tels quels : seul l'émetteur du zip change.
*Rejeté :* supprimer l'envoi direct (prévu au plan) ; il ne coûte rien et sert les serveurs sans hôte de pack.

**⑨ Le réseau, relié au hub par `/ws/plugin`.** Les autres serveurs gardent leur client du
backend (`WsClient`, `SyncedMenuProvider`) et le pointent vers le hub. Leur `hello` porte le
secret partagé en `server_key` et leur nom en `proxy_name` ; le hub garde ce qu'il annonce
(`RemoteServer`) et relaie chaque requête de l'éditeur par `request_id`. Un serveur déconnecté
reste listé hors ligne (503 `server_offline`). Un Project hors du serveur du hub s'identifie
`<serveur>.<dossier>` (`Servers.project`) : deux serveurs peuvent avoir le même dossier.
*Rejeté :* un identifiant opaque par Project (il faudrait une base pour le retrouver).

**⑩ Rôles `hub` et `leaf`.** `web.role: leaf` coupe le serveur web et pointe le client vers
`web.hub-url` avec le secret du réseau pour clé : `web.secret`, sinon le secret de transfert
Velocity (`config/paper-global.yml`), sinon celui que le hub génère dans `network-secret`.
MySQL n'est pas exigé : les brouillons restent sur le disque de chaque serveur et les sessions
dans la mémoire du hub. Une feuille sur H2 le signale au démarrage, car les données de la
suite n'y sont pas partagées.
*Rejeté :* refuser le démarrage sans MySQL (prévu au plan) ; rien du hub n'en a besoin.
*Amendement 2026-10-13 :* `web.role` est supprimé : un serveur est une feuille exactement quand
`web.hub` est renseigné, vide il est le hub. `web.hub` (ex-`web.hub-url`) prend `hôte[:port]`
(port 8765 par défaut, ou une adresse `https://` de proxy) et le plugin en dérive l'URL
WebSocket `ws(s)://…/ws/plugin`. `web.name` devient la clé racine `name`.

**⑪ Version du protocole.** Le `hello` porte `ProtocolVersion.CURRENT` (`1.0`). Une majeure
différente de celle du hub : le serveur reste listé « mise à jour requise » et le hub ne lui
envoie plus rien (503 `plugin_update_required`). Une mineure différente ne fait qu'ajouter
des champs. Une release publie tous les jars sous un seul numéro.

*Rejeté :* Javalin (deux runtimes Kotlin), le serveur HTTP du JDK (pas de
WebSocket), embarquer Jetty dans le jar (+3 Mo, à relocaliser).

## Conséquences

- Un changement de `web` demande un redémarrage : le serveur web survit à `/artisan reload`.
- Les sessions vivent en mémoire : un redémarrage demande un nouveau lien.
