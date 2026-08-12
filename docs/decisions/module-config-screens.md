# Config screens de module — surfaces séparées, édition live

**Statut :** accepté (2026-07-27) — design verrouillé (session grill-with-docs),
**cercle ① implémenté le 2026-07-27** (déclaration presence `editor_screens`,
table `server_editor_screens` + relais WS `config_read`/`config_write` sans
stockage, écrans éditeur générés + fallback « Données », panneau Données du
canvas réduit au binding, Boutique déclarant ses deux écrans). Complète l'ADR
`composable-data-models` (dont il révise la localisation du formulaire généré).

## Contexte

Dans le panneau Données du canvas, le catalogue boutique apparaissait deux fois :
comme « Données du projet » (les fichiers `data/categories/*.yaml`, éditables)
et comme « Sources du serveur » (`boutique:items` / `boutique:categories`, vues
runtime dérivées avec champs calculés `final_price`…). Deux pistes ont été
grillées : ① unifier les schémas (un model unique dont certains champs sont
marqués `runtime`, non éditables) ; ② séparer les *surfaces* par tâche. La
piste ② l'emporte : la confusion venait de mélanger « gérer le contenu de mon
module » et « binder un menu sur une source » dans la même surface — la
résoudre par du nesting/provenance aurait *expliqué* la duplication avec de la
machinerie UI subtile au lieu de la supprimer. Le flag `runtime` devient inutile
(aucun formulaire ne montre plus ces champs ; ils ne vivent que dans l'annuaire
de binding).

## Décisions

1. **Surfaces séparées par tâche.** Une Table à model **module-déclaré**
   s'édite dans les **Config screens** du module ; le panneau Données du canvas
   redevient une pure surface de *binding* : sources project-authored + annuaire
   des sources serveur (schéma + aperçu live, lecture seule). Les données module
   n'y figurent plus que par un lien « Géré par le module X ». *Rejeté :*
   nesting par provenance (`derivedFrom`) des sources serveur sous les données
   projet, et le flag `runtime: true` dans `model/v1`.

2. **Écrans générés par le core, déclarés par le module — jamais codés.** Le
   module déclare ses écrans via le canal presence (comme models et sources) :
   > **Révisé par l'ADR `yaml-assisted-editing` (2026-07-27)** : « une Table/
   > Config **à model déclaré** » n'est plus un prérequis. Le schéma devient une
   > amélioration progressive — un écran peut éditer un fichier **sans schéma**
   > (champs littéraux déduits des valeurs), et tout écran offre deux modes sur
   > le même fichier (formulaire + YAML brut). Le prérequis « édition YAML
   > préservante » du §4 pour le cercle ③ est **contourné** plutôt que payé :
   > l'onglet YAML écrit verbatim sur un fichier étranger, et le formulaire y
   > est en lecture seule.

   ```yaml
   editor_screens:
     - id: catalog
       label: "Catalogue"        # string simple ; i18n plus tard
       table: data/categories    # la Table/Config à model déclaré éditée
   ```

   Chaque écran = un label + une Table/Config ; le core génère le formulaire
   (master-detail si racine liste, form simple si racine objet — le form
   generator de `composable-data-models` §7, repositionné en « éditeur
   générique de config à schéma »). Sidebar : l'entrée module porte « Éditeur »
   (canvas) + ses écrans. **Fallback** : models déclarés + projet dédié sans
   `editor_screens` ⇒ un écran « Données » auto-généré (une entrée par Table).
   `FrontendModule.routes` custom reste possible pour un cas exotique, mais
   n'est pas le chemin normal. *Rejeté :* onglet unique imposé « Données »
   (overlay `?tab=`) — le module organise ses écrans lui-même.

3. **Édition live-only via le relais WS.** L'écran lit les fichiers à
   l'ouverture via le hub WS et écrit directement (le plugin écrit le fichier +
   reload) ; grisé « serveur hors ligne » sinon. Le backend **relaie sans
   stocker** — pas de copie backend spécifique à ces écrans. Pour un projet
   add-on Artisan, l'écriture WS-directe ne contourne pas le sync : elle atterrit
   sur disque comme une édition manuelle et le scan/auto-push P3b la propage
   normalement — aucune nouvelle surface de conflit. *Rejeté :* éditer une
   copie backend relue à la reconnexion (théâtre de disponibilité).

   > **Révisé le 2026-07-30 — le write est journalisé.** « Relaie sans stocker »
   > laissait les config de module hors historique, alors que les menus du même
   > project y sont : le même écran, la même UI, tantôt versionné tantôt
   > volatil, sans que rien ne le signale. C'est exactement le « je m'attendais
   > à un historique et il n'y en a pas » qu'on voulait éviter.
   >
   > La règle devient : **une racine gérée est une racine versionnée.** Après
   > l'ack du plugin, le backend applique le même patch à l'arbre stocké du
   > project et commite (`journalProjectFiles`, `lib/projectJournal.ts` — une
   > seule implémentation, partagée avec les mutations in-game type
   > `/boutique additem`), puis broadcast `bundle_available`. Ce broadcast n'est
   > pas décoratif : il fait rafraîchir `.artisan-sync.yaml` au plugin, sans quoi
   > son scan suivant verrait LOCAL_ONLY et repousserait le même contenu.
   >
   > Trois garde-fous : on journalise **après** l'ack, jamais avant (l'historique
   > ne raconte pas une écriture qui n'a pas atterri) ; un `project_id` qui n'est
   > pas un project Artisan ne journalise rien et **n'est pas créé** (inventer un
   > project transformerait le dossier d'un plugin tiers en project Artisan dans
   > le dos de l'admin) — la réponse porte `journaled: false` ; et une
   > réécriture identique ne crée pas d'entrée (`createCommit` dédoublonne par
   > hash de contenu).
   >
   > Ce qui **ne** change **pas** : la lecture reste live, l'écran reste grisé
   > hors ligne, l'écriture passe toujours par le plugin. Ce qui rend la
   > révision possible est que la détection disque est devenue fiable (spec
   > `2026-07-30-poll-first-disk-sync-design`) : le jugement « théâtre de
   > disponibilité » valait quand une copie backend n'aurait pas été
   > resynchronisée de façon garantie.

4. **Trajectoire « brancher Artisan sur l'existant » — trois cercles.**
   ① add-ons Artisan (fichiers possédés, writers canoniques) — **seul cercle
   construit maintenant** ; ② plugins existants en formulaire *read-only*
   (schéma communautaire posé comme data) ; ③ édition write des fichiers tiers.
   Les déclarations restent du pur data (models + screens + futur
   `reload_command`) précisément pour que ②③ soient atteignables sans rien
   redessiner. Prérequis identifiés pour ③ : édition YAML **préservante**
   (commentaires/ordre des clés de fichiers qu'on ne possède pas) et un mode
   sync « externe » prudent (les plugins qui réécrivent leur propre config au
   runtime rendent le watcher-owning impossible). ②③ = produit en soi, à
   griller quand un vrai plugin cible existe. Un écran standalone (module sans
   projet/canvas) sera une route à part à ce moment-là.

## Dette assumée / questions ouvertes

- **Dédup schéma source ↔ model** : `DataSourceDeclaration.schema` (champs à la
  main) et le model déclaré coexistent — divergence possible, mais qui ne coûte
  plus qu'une incohérence d'affichage dans l'annuaire de binding. Reporté :
  un `model: "ns:id"` optionnel sur la déclaration (base = model, `schema` =
  extras calculés) se dessinera mieux après le binding des configs externes
  (qui n'auront souvent pas de source du tout).
- ~~**Live-only généralisé au canvas**~~ — **tranché le 2026-08-12**, grill tenu,
  ADR `server-disk-only-storage` : le serveur devient le seul store, le §3
  ci-dessus est généralisé au canvas. Le propriétaire a renoncé explicitement à
  l'historique et à l'édition hors-ligne, ce qui a levé le blocage. Conséquence
  sur cet ADR : la révision du 2026-07-30 (« une racine gérée est une racine
  versionnée », journalisation backend après ack) **tombe** avec le journal ;
  l'édition passe d'un write live à un write sur geste explicite.
