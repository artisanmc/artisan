# Miroir d'instantané, brouillons et Versions côté backend pour les projets serveur

**Status :** accepted (2026-09-26) — **rien n'est implémenté**. Révise
[server-disk-only-storage](server-disk-only-storage.md) (décisions 1, 5 et 7) et
[project-storage-modes](project-storage-modes.md) (brouillons serveur dans
`.artisan/drafts/`) pour les projets serveur uniquement.

## Contexte

**Le moteur est la cohérence produit à long terme, pas la performance** (le
propriétaire, 2026-09-26). Le partage visé : le serveur Minecraft possède ce qui
est **publié**, puisque c'est ce qu'il exécute ; le backend possède tout ce qui
relève du **travail** — brouillons, historique restaurable « à la git », accès au
Project serveur éteint, et à terme des Servers non reliés qui remplacent les
projets hébergés. Mettre le travail privé sur le disque d'un serveur qui n'en fait
rien avant publication était l'incohérence.

`server-disk-only-storage` avait écarté « garder la copie backend en cache
dérivé » parce qu'elle ne servait que l'historique et l'édition hors ligne, alors
jugés non essentiels. Le propriétaire les réclame désormais. Les lectures plus
rapides (au moins trois allers-retours WS vers le plugin à chaque ouverture
aujourd'hui) sont un bénéfice de bord.

## Décisions

1. **Miroir d'instantané.** Le backend conserve, par `(server_key_id, dossier)`,
   l'instantané du plugin (**Snapshot** au glossaire) : les octets chargés au
   dernier démarrage ou `/artisan reload`, c'est-à-dire ce que le serveur exécute.
   « Miroir » désigne la copie backend, qui peut être en retard ; c'est un terme
   d'implémentation, absent du glossaire. Pas le disque en
   continu : une édition à la main n'y entre qu'au reload (sémantique inchangée
   depuis le retrait du `SyncScanner`).

2. **Valide seulement si son hash égale le dernier hash annoncé.** Le `hello`
   porte le hash d'instantané de chaque Project (capacité `snapshot_mirror_v1`) ;
   `projects_reloaded` reste le signal en cours de session. Un écart déclenche la
   récupération des seuls fichiers changés. Tant que les hashes concordent, les
   lectures sont servies sans aller-retour. Une écriture éditeur attend l'ack
   (qui porte le nouveau hash) avant de répondre. Un plugin sans la capacité
   garde le chemin actuel : le miroir est ignoré, jamais cru.

3. **Le miroir est jetable.** Il n'est jamais une autorité ni une base de
   compare-and-swap : la publication reste un CAS par fichier contre le disque.
   Vider la table ne perd rien.

4. **Les brouillons des projets serveur reviennent en source de vérité backend.**
   Un brouillon est un travail privé non publié ; le serveur n'en fait rien avant
   publication. La migration inverse celle du 2026-09-13 avec le même protocole
   (gel, copie, vérification, puis retrait de `.artisan/drafts/`).

5. **Résolution de conflits par fichier, à l'ouverture du brouillon.** On compare
   la base du brouillon au miroir courant. Fichier modifié seulement côté serveur :
   le brouillon prend la version serveur et sa base avance, en silence. Modifié
   des deux côtés : conflit sur ce fichier, choix explicite. Même calcul quand
   l'éditeur ouvert reçoit `projects_reloaded`. Grain = fichier, y compris
   `lang/*.yaml` et `.artisan/editor.yaml` : les faux conflits sur ces fichiers
   partagés sont un coût accepté, à revoir sur usage.

6. **Versions en base, la corbeille disque disparaît.** Chaque instantané reçu qui
   diffère du précédent devient une Version (date, auteur : l'utilisateur qui a
   publié ou le serveur après édition à la main, hash). Stockage adressé par
   contenu : manifeste chemin → hash, chaque contenu stocké une fois. Vues par
   fichier et par Project. **Restaurer ne publie rien** : la Version va dans le
   brouillon, publié ensuite normalement. `.artisan/history/` n'est plus alimenté
   et son contenu n'est pas importé. Plusieurs éditions à la main entre deux
   reloads ne forment qu'une Version.

7. **Serveur éteint : le Project s'ouvre.** Depuis le miroir, badgé avec la date
   du dernier instantané. Le brouillon reste éditable. Publication, données live,
   capture en jeu restent indisponibles. Rien n'est purgé pour un serveur qui ne
   revient pas : miroir, brouillons et Versions vivent tant que la server key
   existe.

## Conséquences

- **L'historique ne vit que dans le backend.** Perdre la base perd les Versions,
  jamais le contenu publié. Les sauvegardes PostgreSQL deviennent porteuses de
  valeur utilisateur.
- **Le cache navigateur `projectCacheStore` perd sa raison d'être** et peut être
  retiré une fois le miroir en place. Le secours local du brouillon
  (`projectDraftStore`) reste.
- **`no-branch-conflict-resolution` tient** : aucune fusion de contenu, un choix
  par fichier.
- **Projets hébergés hors périmètre.** Ils gardent leur volume et leurs révisions ;
  l'éditeur présente la même vue Versions pour les deux modes derrière
  `ProjectStorage`.

## Direction décidée, épopée suivante

Les projets hébergés n'ont plus lieu d'exister : un **Server non relié** (clé
créée, jamais `/artisan link`) porte des Projects faits de brouillons seuls, et
la publication crée les fichiers au premier link (CAS base `null`). Ordre :
(1) cet ADR, (2) Server non relié porteur de brouillons, (3) migration des projets
hébergés existants, sort de la démo, puis retrait du mode hébergé. Démo et
migration des hébergés restent à trancher.

## Mesure (2026-09-26, stack locale, `projet_test`)

| Requête isolée | Durée |
|---|---|
| `GET …/drafts` (liste, via plugin) | **2,4–2,8 s** (4,6 s à froid) |
| `GET …/drafts/:id` (un brouillon) | 154 ms |
| `GET …/files?if_hash=` (arbre, via plugin) | 23–43 ms |
| `GET …/items` (backend seul) | 26 ms |

La liste des brouillons domine. Le plugin relit et parse **tous** les
`draft.json` du Project (21 brouillons, dont 20 publiés conservés, ~140 Ko
chacun, 3 Mo), puis renvoie les brouillons actifs **avec leur instantané
complet** (142 Ko pour une liste). Le disque local est un bind mount Windows,
plus lent que la prod ; en prod, chaque requête via plugin paie en plus l'aller-
retour réseau backend ↔ serveur Minecraft, que le miroir supprime.

Pas de correctif provisoire côté plugin : le code serait jeté avec le retour des
brouillons côté backend.
