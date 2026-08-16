# Le disque du serveur est le seul store — le backend ne stocke plus de contenu de Project

**Status :** accepted (2026-08-12) — **rien n'est implémenté**. Révise
`files-first-source-of-truth` (décisions 2 et 6) et répond à la question ouverte
laissée par `module-config-screens` (« Live-only généralisé au canvas […] Grill
dédié requis »).

## Contexte

`files-first-source-of-truth` a fait des fichiers la vérité *de forme* : le
backend a cessé de stocker une représentation riche (`editorJson` démoli) pour ne
garder que l'arbre de fichiers (`filesJson`). Mais il gardait cet arbre comme une
**copie publiée** : le plugin téléchargeait depuis le backend (`bundle_available`
→ `BundleDownloader`), et l'éditeur écrivait dans le backend. Deux écrivains
durables sur la même vérité.

Tout ce qui a coûté cher depuis découle de cette topologie : `syncedHash` et son
état à trois branches, `detectSyncAction` (LOCAL_ONLY / CONFLICT / `force`),
`sync_divergence`, le `SyncScanner` comme mécanisme de *correction*, et un hash
qui devait s'accorder au byte entre deux implémentations (Kotlin / TS) sous peine
d'inventer des divergences. La note de `module-config-screens` le disait déjà :
*« la machinerie de sync a été la première source de bugs du projet »*.

Deux constats ont débloqué la décision :

- **Le mécanisme cible existe déjà et tourne en prod, sur une surface.** Les
  Config screens lisent (`config_read`) et écrivent (`config_write`) les fichiers
  via le hub WS ; **le plugin écrit le disque**, le backend relaie. Ce qu'on
  décide ici est la généralisation de ce chemin au canvas.
- **Le propriétaire a retiré les deux contraintes qui rendaient un store backend
  obligatoire** (2026-08-12) : l'historique/restauration *« n'est pas le cœur du
  produit »*, et l'édition serveur éteint *« n'est pas vraiment nécessaire »*. Le
  cœur énoncé : **configurer facilement ses menus/commandes depuis un éditeur web
  au lieu de passer par les fichiers.** Sans ces deux contraintes, plus rien
  n'oblige à stocker le contenu ailleurs que sur le serveur.

## Décisions

1. **Le backend ne stocke aucun contenu de Project.** `projects.filesJson`,
   `project_commits`, `project_branches` et le journal disparaissent. Le backend
   reste indispensable pour tout le reste — comptes, networks, serveurs et
   server keys, billing, assistant IA, hébergement de l'éditeur — et il **continue
   de stocker les assets binaires et les artefacts dérivés** (resource pack,
   icônes 3D) : ce ne sont pas la vérité de config, et le RP doit être hébergé
   quelque part pour être servi aux joueurs. Constat qui l'autorise : `filesJson`
   est un `Record<string, string>`, les binaires n'y ont jamais été.

2. **Le disque du serveur est la seule vérité, le plugin son seul écrivain.**
   L'éditeur lit l'arbre à l'ouverture du Project et écrit à la sauvegarde, par
   relais WS — `config_read` / `config_write` généralisés. Le backend ne relaie
   plus que des messages ; il n'a plus d'opinion sur le contenu.

3. **L'écriture se fait sur geste explicite.** « Sauvegarder » est le seul moment
   où un fichier est écrit. Les modifications non sauvegardées vivent **dans la
   page**, comme dans n'importe quel éditeur : fermer l'onglet sans sauvegarder
   les perd. Il n'y a donc **aucun brouillon persistant** — ni backend, ni
   navigateur, ni disque.
   *Rejeté :* l'autosave continue (statu quo — un menu à moitié construit part en
   live à chaque frappe) ; un brouillon persistant côté backend (réintroduit
   l'état stocké qu'on supprime, pour un besoin que le propriétaire ne
   revendique pas) ; un brouillon navigateur (per-appareil, per-utilisateur,
   perdu au vidage du cache — du travail réel dans un endroit fragile).

4. **Collision : compare-and-swap par fichier.** La sauvegarde présente, pour
   chaque fichier qu'elle écrit, le hash sur lequel elle se base ; le plugin
   refuse d'écrire si le fichier a bougé depuis, et l'éditeur ouvre une modale de
   résolution **sur ce fichier-là seulement**. Un fichier réellement contesté
   **exige un choix explicite** : pas de défaut silencieux (le `?? "web"` de
   `mergeDivergence` était une perte de données déguisée en ergonomie).
   Bénéfice de bord : l'écriture devient **par fichier**, là où la sauvegarde
   actuelle envoie l'arbre entier sous verrou optimiste — deux admins sur deux
   menus différents cessent de se donner des 409 mutuels.

5. **L'historique devient une corbeille sur disque.** Avant chaque écriture, le
   plugin recopie l'ancien contenu dans `.artisan/history/<chemin>/<timestamp>`,
   en anneau des N dernières versions par fichier (N ≈ 20), purgé
   automatiquement, lu à la demande via le plugin, **exclu des exports**. Le
   préfixe `.artisan` fournit gratuitement les bonnes propriétés (hors hash,
   invisible au scan, déjà documenté comme métadonnée).
   Limite assumée : c'est un historique **par fichier**. « Remets ce menu comme
   il était » marche ; « remets tout le Project à hier soir » ne marche pas.

6. **« Bundle » sort du vocabulaire** (CONTEXT.md, entrée marquée *retired*). Il
   n'y a plus d'artefact hashé, annoncé, ni téléchargé — les fichiers du Project
   sur le serveur *sont* le Project. Le mot survit un temps dans le code
   (`/api/v1/bundles`, `computeBundleHash`, `BundleDownloader`) comme résidu de
   migration. *Pourquoi le retirer plutôt que le laisser mourir :* un terme qui
   survit à son mécanisme est une trappe pour la prochaine session — humaine ou
   agent — qui ira câbler un artefact inexistant.

7. **Serveur éteint : le Project ne s'ouvre pas.** Pas « en lecture seule » — pas
   du tout, puisque le contenu vient du plugin. L'éditeur l'annonce comme tel.
   Corollaire : l'assistant IA et les builds qui ont besoin de l'arbre le
   demandent au plugin, et sont indisponibles serveur éteint.

8. **`boutique_additem` s'inverse.** Le protocole dit aujourd'hui *« Le plugin
   n'écrit jamais les fichiers projet »* : le backend patchait `filesJson`. Le
   module écrit désormais son fichier sur disque, et l'éditeur le voit à la
   prochaine lecture.

> **Révisé le 2026-08-14 — sémantique de reload (décisions 2 et 7).** `project_read`
> servait le **disque**, et le `SyncScanner` rechargeait le serveur à chaque
> changement de fichier. L'état payait le coût de la surveillance sans le
> bénéfice : le serveur bougeait sous les pieds de l'admin (contrairement à tout
> autre plugin Minecraft, où une édition ne s'applique qu'au reload) **et**
> l'éditeur n'était pas live pour autant — il ne voyait rien avant un
> rechargement de page. Le pire des deux.
>
> Le plugin conserve désormais un **instantané** : les octets bruts lus au dernier
> chargement. `project_read` et `project_list` le servent, donc l'éditeur montre
> **ce que le serveur exécute**. Une édition à la main ne s'applique qu'à
> `/artisan reload`. Le `SyncScanner` et la spec `poll-first-disk-sync` sont
> retirés.
>
> Trois précisions qui font tenir le modèle :
> - **des octets bruts, pas un modèle parsé** — le compare-and-swap compare des
>   octets ; un modèle re-sérialisé donnerait les mêmes idées et d'autres octets,
>   donc des `base_hash` faux (conflits sur des fichiers intacts, ou écrasements
>   silencieux) ;
> - **l'écriture reste en CAS contre le DISQUE**, pas contre l'instantané : c'est
>   ce qui rattrape une édition faite hors de l'éditeur, au moment où on
>   enregistre, via la modale de conflit ;
> - **un Document illisible figure dans l'instantané** (il est pris avant le
>   parsing) et remonte dans `project_read_result.failed` avec sa raison. Il
>   s'édite donc encore — sinon une faute de frappe enfermerait l'admin dehors —
>   et l'éditeur dit enfin pourquoi il ne tourne pas, au lieu de le faire
>   disparaître en silence comme le serveur le faisait déjà.
>
> *Renoncement assumé :* « un agent édite les fichiers et c'est live » devient
> « …puis `/artisan reload` ».

> **Révisé le 2026-08-15 — brouillon persistant (décisions 3 et 7).** La
> décision 3 excluait tout brouillon persistant, la 7 rendait un Project
> inouvrable serveur éteint. L'argument d'alors portait surtout sur le **coût** :
> un brouillon aurait demandé de construire la réconciliation. Elle existe
> désormais — base, compare-and-swap par fichier, modale de conflit — et le
> brouillon la réutilise telle quelle, sans machinerie nouvelle.
>
> Ce qui a forcé la révision : en retirant l'auto-save (décision 3), on a rendu
> la perte accidentelle beaucoup plus chère. Avant, fermer un onglet coûtait au
> pire les 2 s du débounce ; après, une session entière. Ce n'était pas
> compensé, et il n'y avait même pas de garde `beforeunload`.
>
> Le navigateur garde donc, par Project, la **base** et l'**arbre courant**
> (`projectDraftStore`, ~43 Ko pour le plus gros project mesuré) :
> - **serveur joignable** — le brouillon est **repris** : on retrouve son travail
>   en rouvrant, comme dans n'importe quel éditeur. La base reste celle du
>   serveur (c'est elle que le compare-and-swap présente), seul l'arbre affiché
>   vient du brouillon.
>
>   *Révisé le 2026-08-16* : il était d'abord **proposé** via un bandeau, au nom
>   de « jamais en silence ». Le principe tient, mais un bandeau pleine largeur
>   le payait trop cher — il occupait l'écran en permanence pour dire ce qu'un
>   mot suffit à dire. Ce qui empêche de confondre son brouillon avec l'état du
>   serveur, c'est désormais l'indicateur **« non enregistré »** de la topbar,
>   permanent, et le bouton **Annuler** à côté d'Enregistrer, qui jette le
>   brouillon et repart de ce que le serveur exécute ;
> - **serveur injoignable** — le brouillon s'ouvre en édition, badgé avec son
>   âge, Enregistrer hors de portée ;
> - **enregistrement** — inchangé : le CAS par fichier fait le reste, et le
>   brouillon est effacé une fois le travail parti.
>
> Un indicateur « non enregistré » permanent accompagne le tout : sans lui, rien
> ne distingue un Project propre d'un Project modifié.
>
> *Limites assumées :* par-appareil, par-utilisateur, mort avec le cache — mais
> ce n'est plus une régression, puisque sans lui tout est perdu au rechargement.
> Et la péremption s'accumule : éditer hors ligne plusieurs jours contre une base
> ancienne peut produire des conflits sur beaucoup de fichiers d'un coup, d'où
> l'affichage franc de l'âge du brouillon.

## Ce qui disparaît

`projects.filesJson` · `project_commits` / `project_branches` / `projectJournal`
· `bundlePublisher` / `POST|GET /api/v1/bundles` · `bundle_available` /
`BundleDownloader` comme canal de synchro · `detectSyncAction` / LOCAL_ONLY /
CONFLICT / `force` · `sync_divergence` / `divergence.ts` / la bannière de
divergence · `.artisan-sync.yaml` comme arbitre · le `SyncScanner` comme
mécanisme de correction · le hash comme invariant inter-langage.

Ce qui reste du hash : une comparaison locale de contenu pour le CAS par fichier
(décision 4). Plus rien n'exige que Kotlin et TS produisent le même hash d'arbre,
donc le vecteur `project-hash-conformance.json` cesse d'être load-bearing.

## Conséquences

- **C'est une épopée de suppression, pas d'ajout.** Le gros du travail est du
  retrait sur les trois couches, plus le portage du canvas sur le relais WS.
  Aucune brique nouvelle sauf la corbeille (décision 5) et le CAS par fichier.
- **Le verrou : plus rien ne marche sans le serveur en ligne.** C'est le prix
  explicitement accepté. Il faut que l'éditeur le dise clairement au chargement,
  sinon ça se lit comme une panne.
- **La promesse anti-lock-in se renforce** : il n'existe plus qu'une copie de la
  config, et elle est chez l'admin. `files-first-source-of-truth` visait la
  *forme* des fichiers ; cet ADR en fait aussi le *lieu*.
- **Migration des données existantes** : les Projects vivant aujourd'hui dans
  `filesJson` doivent être poussés une dernière fois sur le disque des serveurs
  concernés avant retrait de la colonne. Un Project dont le serveur ne se
  reconnecte jamais est perdu — à traiter comme une opération datée, pas comme
  un effet de bord de déploiement.
- **`no-branch-conflict-resolution` reste intact** : la résolution par fichier
  (décision 4) n'est pas un merge 3-way, c'est un choix au niveau fichier.
- **`module-config-screens` §3 est confirmé et généralisé** ; sa révision du
  2026-07-30 (« une racine gérée est une racine versionnée », journalisation
  backend après ack) **tombe** avec le journal.

## Alternatives écartées

- **Garder la copie backend en la déclassant en cache dérivé** (single-writer,
  brouillon partagé, classification sur base au déploiement). C'était la
  proposition intermédiaire de ce grill, et elle tenait — mais elle ne se
  justifiait que par l'historique et l'édition hors-ligne, tous deux retirés par
  le propriétaire. Sans eux, elle garde tout le coût de stockage pour un bénéfice
  que personne ne réclame.
- **Lire à la demande mais garder le brouillon dans le navigateur.** Rejeté en
  décision 3 : per-appareil, per-utilisateur, perdu au vidage du cache.
- **Un second geste « activer pour les joueurs » distinct de « sauvegarder ».**
  Écarté : une destination, un geste. À rouvrir seulement si le besoin
  « préparer une refonte sans l'exposer » apparaît réellement.
- **Stocker le contenu dans une base opaque** — déjà rejeté à la racine par
  `files-first-source-of-truth`, et cet ADR s'en éloigne encore.
