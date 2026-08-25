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

## P6 — Suppression

Découpée en quatre, parce que seule la dernière étape est irréversible et qu'il
n'y a aucune raison de la faire attendre les trois autres.

### P6a — le disque devient la seule source ✅ (2026-08-22)

Tous les replis sur la table retirés : liste, lecture, édition, duplication,
suppression, aperçu PNG, glyphe de police, construction du resource pack.

Ce que la table masquait et qu'il a fallu traiter : **un échec de lecture doit
être qualifié**. `readDiskAssets` rend `server_offline` / `read_error`, et
`diskLookup` y ajoute `not_found` — sans quoi un serveur éteint se lirait comme
une bibliothèque vide, et un geste de suppression porterait sur ce vide. Le pack
ne se reconstruit plus quand un Project est illisible : le précédent tient.

Deux bugs trouvés au passage : servir un glyphe de police depuis le disque
levait (cache refusant l'empreinte vide, celle de ces PNG), et le bras « table »
de la création était inatteignable depuis P5.

### P6b — supprimer les magasins backend ✅ (2026-08-22)

`codepointAllocator` et `fontStorage` supprimés ; leurs bornes de codepoints
déménagent dans `lib/codepoints.ts` (elles décrivent Minecraft, pas un
stockage). Défaut corrigé : `nextFreeCodepoint` sortait de la plage réservée.

### P6c — la migration ✅ (2026-08-25)

Le prérequis n'est plus une promesse tenue à la main : **il est dans la
migration**. `0031` compte les lignes, ne supprime que si le compte est nul, et
sinon conserve la table en journalisant un WARNING. Les deux branches sont
vérifiées contre un vrai Postgres.

Elle **n'échoue jamais**, et c'est structurel : l'entrypoint du conteneur boucle
(`until bun run db:migrate; do sleep 3; done`), donc une migration qui lève
empêcherait le backend de démarrer indéfiniment. Perdre la suppression est
rattrapable ; perdre la prod ne l'est pas.

Supprimés avec la table : `assetStorage`, `assetDescent`, la route
`/admin/assets/descend`, et `AssetRow` cesse d'être `typeof assets.$inferSelect`
— la forme décrit un asset, plus une ligne.

### P6d — question ouverte, à instruire séparément

La FK `assets.project_id → projects.id` disparue, plus rien de substantiel ne
pend à l'ancre : « faut-il encore une table `projects` ? » Elle ancre encore le
billing, les conversations et le cache d'assets — à vérifier avant d'en faire un
chantier.

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
