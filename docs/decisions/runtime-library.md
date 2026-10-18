# Le runtime d'Artisan est une librairie — un module de la suite démarre sans le plugin

**Statut :** accepté (2026-10-18) pour ① et ② ; ③, ④ et ⑤ **retirés** le même jour (voir
l'amendement en fin de document). Le module Gradle `runtime` reste, consommé par `paper` ; il
n'est pas publié et aucun plugin de la suite n'en porte de copie.

## Contexte

Chaque plugin de la suite (Quests, Guilds, Lands, Boosts, Warps) déclare Artisan en dépendance
requise et tient de son `ArtisanAPI` le moteur d'actions (récompenses), les conditions
(prérequis), la comparaison d'items (objectifs), les traductions et, pour certains, la base de
données. Si le plugin Artisan ne démarre pas, aucun d'eux ne démarre : un serveur sans quêtes, sans
guildes, sans terrains, pour un problème d'éditeur.

Ce que ces plugins tirent d'Artisan se range en deux catégories :

- **du code pur** — parser et exécuter une chaîne, évaluer une condition, bâtir ou comparer un
  item, charger un bundle de messages, ouvrir un pool : une copie par plugin ne gêne personne ;
- **de l'état partagé** — les registres (actions, sources de données, kinds de Documents, modèles),
  la présence vers l'éditeur, le rendu des menus et dialogs, le pack de ressources : il faut
  exactement un propriétaire dans la JVM.

Une librairie règle la première catégorie et ne peut rien pour la seconde. L'option « tout en
librairie, menus compris » a été écartée : N moteurs de menus de versions différentes face à un
seul éditeur, et la fin des références et des sources de données entre modules.

## Décisions

**① Un module Gradle `runtime`, entre `core` et `paper`.** Il contient ce qui exécute le contenu
d'un Project sur un serveur Paper sans l'éditeur : `engine/` (`ActionExecutor`,
`ConditionEvaluator`, `ContextBinder`, `TemplateScope`, les actions core et leur table
`CoreActionHandlers`, `MenuProvider` et `MenuSessionStore` comme interfaces et stores),
`session/` (historique de navigation), `integrations/` (Vault, PlaceholderAPI, WorldGuard,
HeadDatabase), `customitems/` (Nexo, Oraxen, ItemsAdder), `items/` (specs, items capturés,
`ItemDetails`), `text/`, `scheduling/`, `lang/` (bundles et `TranslationsApi`), `database/`
(`PooledDatabase`) et `config/EnvironmentFile`. Il dépend de `api`, `core`, `database` et de
`paper-api` en `compileOnly`. Les packages ne changent pas (règle ② de `plugin-gradle-modules`).

**② `paper` garde l'état partagé** : `SyncedMenuProvider` et le rendu, les listeners, les
paquets, la présence et le hub, le pack de ressources, les commandes `/artisan`, la racine de
composition. Il dépend de `runtime` et l'utilise tel quel : un seul moteur, une seule
implémentation des actions core, le jar d'Artisan est le même qu'avant.

**③ `artisan-runtime` est publié** sur `repo.artisanmc.net`, versionné avec le plugin
(`-PartisanVersion`), un jar qui embarque `artisan-core`, `artisan-database` et Jackson sans
relocation, avec `artisan-core-api` en `provided` dans son POM. Un consommateur le **shade
relocalisé** (`net.artisanmc.plugin` et `com.fasterxml.jackson` au moins) : chaque plugin sa
copie, aucune trouvée par la recherche de classes inter-plugins de Bukkit. `artisan-core-api`
reste `compileOnly`, jamais shadé : `ServicesManager.load(ArtisanAPI.class)` compare des
identités de classe.
Le jar porte aussi `kotlin-stdlib` et `kotlin-reflect`, non relocalisés comme dans le jar
d'Artisan (relocaliser `kotlin` casse `kotlin-reflect`) : chaque plugin charge sa copie avant la
recherche globale, et aucun type Kotlin ne traverse l'API, qui est Java.

*Rejeté :* une librairie shadée **sans** relocation. Le classloader Bukkit résout les classes à
travers les plugins : la version chargée en premier gagnerait pour tous, sans que personne l'ait
choisi — pire qu'un plugin de dépendance.

**④ Un module de la suite passe en dépendance optionnelle d'Artisan.** Avec Artisan, il s'y
enregistre comme aujourd'hui (actions, sources, kinds, écran d'éditeur) et exécute ses chaînes par
`api.getActions()`. Sans Artisan, il instancie le runtime de sa copie : les actions core
(`give_item`, `send_message`, `run_command`, …) s'exécutent, une action d'un autre module est
absente du registre local, journalisée une fois et sautée ; les conditions s'évaluent en local ;
les Documents de ses kinds sont lus depuis le disque par `artisan-core`, rechargés par sa
propre commande ; ses menus répondent « interface indisponible ». Le choix se fait une fois, à
`onEnable`. Le gameplay et la persistance ne dépendent plus d'Artisan ; les menus, les actions
inter-modules et le rechargement poussé par l'éditeur, oui.

**⑤ La base de données suit la même règle** (amendement de `suite-foundation-database`,
`ModuleDatabase` dans le runtime) : un module ouvre son pool par la librairie. Au démarrage, si
`plugins/Artisan/environment.yml` existe, sa section `database` est lue, jamais écrite ; sinon le
module écrit une section par défaut (H2) dans sa propre config et l'utilise ; `database.own: true`
chez le module garde sa section quoi qu'il y ait chez Artisan, et le log dit laquelle des deux est
lue. Rien n'est créé sous `plugins/Artisan/`. En H2, un fichier par module ; une seule base en
MySQL/MariaDB, les tables préfixées comme aujourd'hui.

## Conséquences

- `ActionExecutor` prend déjà le registre en paramètre ; l'étape ① est un déplacement de fichiers
  et trois visibilités `internal` ouvertes (`ItemSpecs`, `ContextBinder.shape/interpolateValues`,
  `MenuSlots.Client`), lues par `paper` depuis un autre module.
- Les tests suivent leur code : ceux qui chargent `ArtisanPlugin` par MockBukkit restent dans
  `paper`, les autres vont dans `runtime` (MockBukkit y est une dépendance de test).
- `RuntimePackageCyclesTest` garde le DAG des packages du runtime, comme `core` et `paper`.
- Un consommateur en mode dégradé reste à écrire plugin par plugin (ArtisanQuests en pilote) ;
  ce que ça exige du runtime (un `MenuProvider` qui ne trouve rien et le dit) viendra avec lui.

## Amendement 2026-10-18 — pas de copie du runtime : le plugin Artisan reste requis

Le pilote ArtisanQuests (PR msquests#23, fermée sans merge) a montré ce que ③ et ④ coûtent :
l'API doit être embarquée **relocalisée** à côté du runtime (sans le plugin Artisan ses classes
n'existent pas, et `ModuleDatabase` comme le moteur les référencent, ce que ③ n'avait pas vu),
donc deux copies des mêmes classes dans la JVM et un pont de conversion entre elles ; un
aiguillage « Artisan présent ou absent » et un adaptateur par service dans chaque plugin ; une
passe de relocalisation supplémentaire pour les descripteurs JVM que `@kotlin.Metadata` garde en
texte ; 13 Mo de runtime par plugin. Le mettre dans la librairie (une façade qui rend
l'`ArtisanAPI` du plugin ou une locale) exigeait de découpler les 28 fichiers du runtime qui
importent le package API. Un jar bibliothèque passif partagé règle tout cela mais revient à un
jar dont tous dépendent, ce que le propriétaire refuse.

Ce que ④ visait, c'est qu'un problème d'Artisan n'immobilise pas quêtes, guildes et terrains. Or
la copie n'y change rien : un bug du moteur est le même dans la copie, et ce qui casse un
plugin actif (hub, port, base, paquets, synchronisation) est déjà hors du chemin des
dépendants. `ArtisanPlugin.onEnable` construit et enregistre l'API avant toute étape qui peut
échouer ; l'échec de PacketEvents, de la base de la suite et de l'éditeur est attrapé ; et
depuis cet amendement la commande, le listener des menus et tout le côté jeu sont en place
avant le démarrage de l'éditeur, lui-même sous une garde qui journalise en SEVERE et laisse le
plugin activé (`ArtisanPluginEnableResilienceTest`). Il reste deux cas où tout tombe : le jar
Artisan absent ou refusé au chargement, et un bug du moteur, qu'une copie n'aurait pas évités.

Décisions retirées : ③ (publication de `artisan-runtime`, `ModuleDatabase`), ④ (dépendance
optionnelle et mode dégradé), ⑤ (pool ouvert par le module ; l'amendement de
`suite-foundation-database` est retiré avec lui, `api.database` reste la voie). Les plugins de
la suite déclarent Artisan `required: true` et prennent tout de son `ArtisanAPI`.
