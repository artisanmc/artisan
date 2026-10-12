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

**⑦ Items et textures vanilla sans backend.** Le catalogue d'items (`backend/data/items`)
voyage dans le jar ; les icônes 3D (`backend/assets-seed`) aussi avec `-PwithEditor`. Les
textures sont extraites du jar client Mojang, téléchargé et vérifié (SHA-1) à la première
texture demandée, dans `plugins/Artisan/cache/minecraft/<version>/`. Les items custom se
lisent directement dans `CustomItemsManager` (`ItemRoutes`, `VanillaAssets`).
*Rejeté :* télécharger les icônes depuis les releases GitHub (dépôt privé).

**⑧ Le pack, servi par le serveur.** L'éditeur envoie le zip qu'il construit ; le hub le
garde sous son SHA-1 (`PackStore`, trois derniers), le sert publiquement sous
`/resource-pack/<sha1>.zip` et le remet au `ResourcePackManager` avec cette URL. Délégation
et envoi direct restent tels quels : seul l'émetteur du zip change.
*Rejeté :* supprimer l'envoi direct (prévu au plan) ; il ne coûte rien et sert les serveurs sans hôte de pack.

*Rejeté :* Javalin (deux runtimes Kotlin), le serveur HTTP du JDK (pas de
WebSocket), embarquer Jetty dans le jar (+3 Mo, à relocaliser).

## Conséquences

- Un changement de `web` demande un redémarrage : le serveur web survit à `/artisan reload`.
- Les sessions vivent en mémoire : un redémarrage demande un nouveau lien.
