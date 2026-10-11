# Artisan prête la base de données à la suite — `environment.yml`, un pool par plugin

**Status :** accepted (2026-10-11).

## Contexte

Artisan devient le socle d'une suite de plugins distribuables séparément (Quests,
Guilds, Lands, Boosts, Warps…), chacun en `depend: [Artisan]`. Aujourd'hui ces
plugins tiennent leur base de données d'un autre plugin d'infrastructure (MSCore :
un pool statique de 5 connexions, driver MySQL en dur, identifiants dans sa config)
ou de leur propre code (MSQuests : HikariCP + H2/MySQL embarqués). Artisan n'a aucun
lien avec cet autre plugin : il ne le remplace pas en place, il coexiste avec lui,
et chaque plugin de la suite passe de l'un à l'autre quand il est prêt.

Deux questions : où vivent les identifiants, et comment une connexion arrive au
plugin.

## Décisions

1. **`environment.yml` remplace `connection.yml`.** Il dit où et qui est ce serveur :
   le lien backend (`server_key`, `ws_url`, inchangés) et la section `database`.
   Lu par le plugin Artisan uniquement : jamais rapporté dans `hello`, jamais écrit
   par l'éditeur (le critère de l'ADR `server-config-from-editor` s'applique
   tel quel à des identifiants de base), jamais copié d'un serveur à l'autre.
   *Migration* : au démarrage, un `connection.yml` existant est repris dans
   `environment.yml` puis supprimé ; les clés d'un `config.yml` pré-split le sont
   aussi. Un `environment.yml` existant n'est jamais réécrit.
2. **`${NOM}` dans une valeur** est remplacé par la variable d'environnement NOM
   (Docker, Pterodactyl), pour ne pas écrire un mot de passe sur le disque. Une
   variable absente donne une chaîne vide et un avertissement.
3. **Un pool HikariCP par plugin**, ouvert au premier `api.database.dataSource(plugin)`
   et fermé à la désactivation de ce plugin. Un plugin qui fuit des connexions
   n'affame jamais les autres. Taille commune `database.pool-size` (4 par défaut)
   dans `config.yml`, donc modifiable depuis l'éditeur ; les identifiants, non.
4. **Seul `javax.sql.DataSource` traverse l'API.** Pas de HikariCP, de JDBI ni de
   driver dans `modules.api` : aucun conflit de classloader possible. Chaque plugin
   garde sa couche d'accès et **ses propres migrations** (aucune API de migration
   imposée : les plugins existants en ont déjà une).
5. **Dialectes** : `h2` (défaut, un fichier par plugin sous `plugins/Artisan/database/`,
   aucune installation), `mysql`, `mariadb` (une base partagée : chaque plugin
   préfixe ses tables). `DatabaseDialect` est un enum Java, comme `FieldKind`.
6. **HikariCP et les drivers ne sont pas embarqués** : `libraries:` du `plugin.yml`,
   téléchargés par Paper au démarrage dans le classloader d'Artisan. Le jar reste
   léger et rien n'est relocalisé. Contrepartie : le premier démarrage a besoin de
   Maven Central (~7 Mo), y compris sur un serveur qui n'utilise aucun plugin de
   la suite.
7. **API `@Beta`** (`ArtisanAPI.database`, depuis 1.7.0) : le réseau (messagerie,
   présence, téléportation) suivra dans la même facade, avec `server_name` et
   `redis` dans `environment.yml`.

*Rejeté :* un pool partagé (une fuite dans un plugin bloque toute la suite) ;
garder le nom `connection.yml` (le fichier ne contient plus seulement la connexion
au backend) ; drivers shadés et relocalisés (~7 Mo de plus dans chaque jar
d'Artisan pour un usage optionnel) ; une API de migration commune (les plugins à
migrer ont déjà la leur, la remplacer ajoute un risque sans rien apporter).
