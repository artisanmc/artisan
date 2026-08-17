# Plan — les assets descendent sur le disque du serveur

Met en œuvre l'ADR `assets-on-server-disk`. Découpé pour que **chaque phase soit
déployable seule** et que la production ne casse à aucun moment : la lecture
tolérante arrive avant l'écriture, la descente avant la bascule, la suppression
en dernier.

## P0 — Protocole : lire et écrire un binaire par chemin

- `asset_read` / `asset_read_result` (chemin → octets base64 + hash) et
  `asset_write` / `asset_write_result` (compare-and-swap sur `base_hash`, mêmes
  règles que `project_write` : tout ou rien, conflit = contenu disque renvoyé).
- Le plugin sert depuis son **instantané** comme pour le reste (sémantique de
  reload) ; `api.project.reload()` reste le point de reprise.
- `project_read` annonce les chemins `assets/**` avec leur hash **sans** leur
  contenu — l'éditeur doit savoir ce qui existe sans tout télécharger.
- Vecteur de conformance : un PNG écrit puis relu rend les **octets exacts**
  (base64 ne doit rien normaliser).

Livrable : plugin + backend + protocole, aucun changement visible.

## P1 — Cache backend, clé par contenu

- Table (ou volume) de cache `(serverKeyId, projectDiskId, path, contentHash)`.
- Alimentée à la lecture, invalidée par le hash annoncé dans l'arbre.
- Route de lecture d'asset côté éditeur : cache d'abord, `asset_read` sinon,
  **jamais** de repli sur une version d'un hash différent.
- Serveur injoignable **et** cache vide → « indisponible », pas une image d'hier.

Livrable : les aperçus continuent de marcher, plus vite, depuis la même source.

## P2 — Lecture tolérante des refs, des deux côtés

- Plugin et éditeur acceptent `asset: <nom>` **et** `asset_id: <id opaque>`.
- Rien n'écrit encore la forme nouvelle : c'est la marche que la descente
  montera.

Livrable : la prod sait lire l'après avant d'y être.

## P3 — Descente des assets existants

- Commande d'administration, idempotente, pilotée par le hash :
  pour chaque Project, `asset_write` de chaque octet sous
  `assets/{textures,glyphs,fonts}/<nom>.<ext>` + le `.yaml` frère
  (ascent, codepoint, `contentWidth`, dimensions).
- Dé-collision des noms (`fond`, `fond-2`) — le nom devient l'identité.
- Réécriture des refs dans les Documents du Project, dans la même passe.
- Journal explicite de ce qui a été descendu, et de ce qui a résisté.

Livrable : le disque du serveur porte tout ; le backend n'est plus la source.

## P4 — Bascule de la construction du resource pack

- `rebuildResourcePack` lit le cache (donc le disque) au lieu de la table.
- Reconstruction déclenchée par un `asset_write` ou un reload qui change un hash.
- Les codepoints viennent des `.yaml` ; `mergeCodepoints` reste l'arbitre et
  **journalise** les collisions au lieu de les refuser (ADR décision 6).

Livrable : le pack se construit depuis la vérité.

## P5 — Écriture depuis l'éditeur

- Téléverser / renommer / supprimer un asset passe par `asset_write`.
- Serveur hors ligne : les gestes d'écriture sont **hors de portée**, comme pour
  les menus. L'aperçu reste, par le cache.
- Attribution de codepoint : l'éditeur propose le premier libre du Project.

Livrable : le flux complet, sans backend propriétaire.

## P6 — Suppression (BLOQUÉE tant que la descente n'a pas tourné en prod)

Prérequis opérationnel : `POST /api/v1/admin/assets/descend`, rejoué jusqu'à ce
qu'aucun serveur ne soit plus « sauté ». Supprimer la table avant, c'est perdre
les assets des serveurs qui n'étaient pas là.


- Table `assets`, `codepointAllocator`, `assetStorage`, routes d'upload backend.
- Migration Drizzle (destructive, forward-only).
- La FK `assets.project_id → projects.id` disparaît : plus rien de substantiel ne
  pend à l'ancre, ce qui ouvre le débat « faut-il encore une table `projects` ? ».

## Risques identifiés

- **Taille de l'arbre.** Si un jour `project_read` doit porter les binaires, tout
  s'effondre : la règle « annoncer, pas transporter » (P0) est structurelle, pas
  une optimisation.
- **Polices dépliées.** Une police, c'est N fichiers ; en déplier une grosse peut
  faire exploser le nombre de fichiers d'un Project. À mesurer en P3 sur une
  police réelle avant de généraliser (question ouverte de l'ADR).
- **Descente partielle.** Un serveur hors ligne au moment de la descente laisse
  son Project à moitié migré. D'où l'idempotence et le pilotage par hash : on
  rejoue, on ne reprend pas un curseur.
