# Interfaze — Spec de l'éditeur web

**Document de référence pour la conception et le développement de l'interface web**
Version : draft 1 (avril 2026)

Ce document décrit les capacités que doit offrir l'éditeur web `editor.interfaze.gg`. Il complète la spec produit générale (`spec-plugin-minecraft-gui-editor.md`) en zoomant sur l'expérience utilisateur côté admin. Il décrit **ce qui doit être possible**, pas l'apparence visuelle exacte (laissée au design).

---

## 1. Vue d'ensemble

### 1.1 Personas et contextes d'usage

L'éditeur sert trois personas qui ont des fréquences d'usage et des besoins différents :

- **L'admin solo** (95% du free tier) : 1 serveur perso ou semi-pro. Ouvre l'éditeur quelques fois par mois pour ajuster un menu shop ou ajouter une fonctionnalité. A besoin que tout soit immédiatement compréhensible sans lire de doc. Pas de patience pour la complexité.
- **L'admin de network** (cible payante principale) : 2-10 serveurs, gère des menus partagés et des configs spécifiques par serveur. Ouvre l'éditeur plusieurs fois par semaine. A besoin d'efficacité (raccourcis, copier-coller, batch edit) et de gestion multi-serveur claire.
- **Le power user / dev plugin** : intègre son propre plugin via l'API tierce, ou veut éditer des configs complexes. A besoin du mode Code et d'une visibilité fine sur les internals.

### 1.2 Trois zones fonctionnelles principales

L'éditeur est organisé autour de trois zones :

- **Dashboard** : vue d'ensemble des serveurs, des menus, de l'activité, de l'usage. Point d'entrée après login.
- **Éditeur de menu** : le canvas où l'admin construit ses menus. C'est là où il passe 80% de son temps.
- **Réglages** : compte, équipe, billing, paramètres. Visité rarement mais doit être impeccable.

---

## 2. Principes UX directeurs

L'éditeur respecte cinq principes qui doivent guider toutes les décisions de design.

**Évident d'abord, puissant ensuite.** La couche par défaut (Visual) doit être immédiatement compréhensible par un admin Minecraft qui n'a jamais utilisé d'éditeur visuel. Les fonctionnalités avancées (conditions, view states, mode Code) sont accessibles mais cachées derrière un toggle. Pas d'option de feature toggle au premier login.

**Édition sans peur.** Toute modification est revertable, autosaved, et préservable jusqu'au publish. L'admin doit pouvoir bidouiller sans crainte de casser quelque chose en production. La distinction Live / Draft est explicite et visible en permanence.

**Feedback immédiat.** Toute action a une conséquence visible en moins de 100ms. Le drag d'un asset, le changement d'un titre, le toggle d'une condition — tout est feedback en temps réel sur le canvas.

**Live-edit en jeu comme killer feature.** L'admin peut connecter sa session de jeu à l'éditeur et voir ses modifications en temps réel dans son inventaire ouvert. C'est ce qui fait la magie du produit en démo et au quotidien. Le statut de la connexion live est visible en permanence.

**Cohérence avec la culture Minecraft.** L'admin doit retrouver les conventions du jeu (matériaux nommés en upper snake case `DIAMOND_PICKAXE`, format des codes couleur `§a`, formats de commandes `/`, mention de placeholders PAPI `%player_name%`). Pas de réinvention gratuite.

---

## 3. Authentification et onboarding

### 3.1 Login

Page d'accueil minimaliste avec deux options :

- **"Login with Discord"** — OAuth standard. Option recommandée (un clic, pas de mot de passe à gérer).
- **"Email + mot de passe"** — Inscription classique (email / password + confirmation). Email de validation obligatoire avant activation. Récupération par lien envoyé à l'email.

Les deux méthodes produisent le même compte Interfaze. Un utilisateur Discord peut ultérieurement ajouter un email/password depuis son profil (et vice-versa), pour avoir les deux liens. Au premier login, on demande un email de récupération aux utilisateurs Discord-only — ne bloque pas l'usage immédiat (skip possible) mais relance l'utilisateur après 24h.

### 3.2 Onboarding (premier login)

Wizard en 3 étapes pour le tout premier usage. Skipable mais fortement recommandé.

- **Étape 1 — Lier ton premier serveur** : L'admin génère une "server key" (clé unique). On lui donne deux instructions précises : copier la clé, l'ajouter dans `config.yml` du plugin. Quand le plugin se connecte via WS, l'éditeur détecte la connexion et le serveur apparaît comme "lié". Un loader avec animation "en attente de connexion" suit cette étape.
- **Étape 2 — Découvrir l'éditeur** : Spawn d'un menu de démo (`Shop d'exemple`) sur le serveur lié. L'admin tape `/menu open shop_demo` en jeu et voit le menu. Pendant ce temps, on lui montre comment éditer un slot dans l'éditeur (mini tour interactif de 30 secondes).
- **Étape 3 — Premier menu en autonomie** : Bouton "Créer mon premier menu". L'admin choisit un layout (vide ou un suggéré), nomme son menu, et arrive sur le canvas. Onboarding terminé.

### 3.3 Sessions et reconnexion

Session JWT 7 jours, refresh transparent. Si Discord révoque l'accès (ban), session expire à la prochaine validation avec message "Reconnexion Discord requise". L'admin peut reconnecter (et lier un nouveau Discord à son compte si un email/password est configuré en parallèle). Pour les comptes email/password, un refresh token HttpOnly (30 jours) permet le "remember me".

---

## 4. Dashboard / Accueil

### 4.1 Page d'accueil

Vue d'ensemble accessible depuis n'importe où via un logo cliquable. Affiche :

- **Sélecteur de serveur** (dropdown en haut à gauche) : permet de basculer entre les serveurs liés au compte. Si un seul serveur, le sélecteur reste mais n'a qu'une option.
- **Statut de connexion** du serveur sélectionné : "Connecté · ws active" / "Déconnecté · dernière sync il y a Xmin" / "Plugin pas démarré".
- **Liste des menus** du serveur sélectionné : grid avec preview thumbnail, nom du menu, état (Live / Draft), date de dernière modification, créateur. Tri par date, par nom, par état.
- **Quick actions** : bouton primary "Nouveau menu", bouton secondary "Importer une config" (V2, mais slot prévu).
- **Activité récente** : feed des dernières modifications publiées sur ce serveur (qui a publié quoi quand). Utile pour les équipes.
- **Widgets de status** : usage storage actuel (X / Y MB), nombre de menus créés, alerte si quota proche.

### 4.2 Sélecteur de serveur

Critical UX : l'admin doit toujours savoir sur quel serveur il travaille. Le sélecteur est visible en permanence dans l'header, avec le nom du serveur affiché en clair. Changer de serveur recharge la liste de menus, déconnecte la WS du serveur précédent et reconnecte à la WS du nouveau.

Si l'admin a un serveur "dev" et un serveur "prod" liés au même compte, il peut :
- Travailler sur le dev (édition libre en draft)
- Cliquer "Promote to prod" sur un menu pour le copier en draft sur le serveur prod (V2 — utile mais pas MVP)

### 4.3 États de chargement et empty states

- **Aucun serveur lié** : grand call-to-action "Connecter ton premier serveur" qui relance le wizard d'onboarding.
- **Aucun menu** : "Crée ton premier menu" + galerie de "spawn from suggested" basée sur les plugins tiers détectés.
- **Plugin déconnecté** : bandeau jaune persistant "Le plugin n'est pas connecté. Vérifier que le serveur est démarré et que la server_key est correcte."

---

## 5. Éditeur de menu (le cœur)

### 5.1 Layout général

L'éditeur de menu utilise un layout 4 zones :

```
┌─────────────────────────────────────────────────────┐
│ Toolbar : nom du menu, save, publish, preview, etc. │
├──────────┬───────────────────────────────┬──────────┤
│          │                               │          │
│ Palette  │   Canvas (grille inventaire)  │ Properties│
│ (gauche) │                               │ (droite) │
│          │                               │          │
│          │                               │          │
├──────────┴───────────────────────────────┴──────────┤
│ Status bar : WS status, autosave, dernière modif    │
└─────────────────────────────────────────────────────┘
```

Les panels gauche et droite sont collapsables (clic sur un bouton, ou raccourci clavier). Le canvas est toujours visible et prend l'espace restant.

### 5.2 Canvas — la grille d'inventaire

Représentation visuelle 1:1 de l'inventaire Minecraft (9 colonnes × 1 à 6 rangées, selon la `size` du menu).

**Capacités du canvas :**

- **Sélection d'un slot** : clic simple → le slot est sélectionné (highlight visuel), le panel droit affiche ses propriétés.
- **Sélection multiple** : Shift+clic ou Ctrl+clic pour ajouter à la sélection. Cmd+A pour tout sélectionner. Permet edit batch (changer un asset sur 5 slots d'un coup).
- **Glisser un asset** : depuis la palette gauche vers un slot vide → l'asset est placé. Si le slot est occupé, prompt "remplacer ?" ou auto-merge selon la nature des éléments (asset + état conservé).
- **Drag d'un slot existant** : glisser un slot vers un autre slot → swap ou move (selon raccourci clavier modificateur). Indicateur visuel pendant le drag.
- **Glisser une rangée** : pour les composants paginables, l'admin sélectionne une rangée de slots (drag-select) puis assigne un composant paginable.
- **Right-click sur un slot** : context menu (Copier, Coller, Sauvegarder en template, Supprimer, Dupliquer, Voir le default si lié à un layout suggéré).
- **Keyboard delete** : Suppr/Backspace sur un slot sélectionné le vide.
- **Background** : zone de fond du menu, clic pour sélectionner et changer l'asset de background (s'il y en a un). Configurable au niveau du menu, pas au niveau d'un slot.
- **Indicateur de slot lié à un composant tiers** : badge visuel discret (ex. "QuestX") en coin du slot.
- **Indicateur de view states** : badge "+2 states" si le slot a des états conditionnels.
- **Indicateur de template** : badge "T" si le slot est une instance d'un template, avec hover qui montre le nom du template.
- **Indicateur d'erreur** : slot rouge avec tooltip explicatif si quelque chose ne va pas (composant indisponible, asset manquant, etc.).

**Contrôles canvas :**

- **Taille du menu** : slider ou stepper pour passer de 9 à 54 slots (1-6 rangées). Avertissement si on réduit et que des slots non-vides seraient perdus.
- **Zoom** : Ctrl+scroll, ou boutons +/- en bas du canvas. Utile sur petits écrans ou pour vue d'ensemble.
- **Snap-to-grid** : actif par défaut, toujours.
- **Grille apparente** : toggleable. Affiche les bordures de slots ou non.

### 5.3 Panel gauche — Palettes

Le panel gauche est un panneau à onglets contenant **plusieurs palettes** d'éléments à drag-and-dropper sur le canvas.

**Onglets :**

- **Items vanilla** : tous les matériaux Minecraft, recherche par nom (fuzzy), filtre par catégorie (blocs, outils, armures, food, etc.). Glisser un item → le slot reçoit `material: "DIAMOND_PICKAXE"` avec le rendu vanilla.
- **Mes assets** : les images uploadées par l'admin. Folders, tags, recherche. Drag → le slot reçoit `asset: "..."` avec un item vanilla par défaut (paper) et le custom_model_data approprié au pack généré.
- **Plugins tiers** (un onglet par plugin tiers détecté, ex. **QuestX**, **ShopGUIPlus**, etc.) : la palette de composants déclarés par ce plugin. Chaque composant a un displayName, une icône, un mode (single/paginable). Drag → le slot reçoit un `component_ref`.
- **Nexo** (V1.5) : items et textures Nexo détectés sur le serveur. Organisé par catégorie. Drag → `material: "nexo:..."`.
- **ItemAdder** (V1.5) : idem pour ItemAdder.
- **Templates** : les symbols créés par l'admin. Drag → instancie le template avec prompt des variables.
- **Marketplace** (V2) : assets et menus achetés.

**Contrôles palette :**

- Search global (raccourci `/` pour focus la recherche).
- Filter par tag.
- Toggle "Show only used" (utile pour les sources read-only comme Nexo).
- Lien "Upload assets" en haut de la palette "Mes assets" qui ouvre le modal d'upload.

### 5.4 Panel droit — Properties

Affiche les propriétés du slot sélectionné (ou du menu si aucun slot sélectionné). Si plusieurs slots sont sélectionnés, affiche les propriétés communes éditables en batch.

**Pour un slot, sections (toutes accessibles dans un seul mode unifié, certaines via boutons "+ Ajouter X" pour garder l'UI clean par défaut) :**

- **Apparence** [toujours visible] :
  - Asset (file picker depuis la palette ou upload inline)
  - Material (autocomplete sur les matériaux Minecraft + namespacés Nexo/ItemAdder)
  - Title (input texte avec preview rendu Minecraft, autocomplete des placeholders)
  - Lore (textarea multi-lignes avec preview, autocomplete des placeholders)
  - Count (1-64)
  - Enchanted glow (toggle)
- **Click actions** [toujours visible, left click par défaut] :
  - Liste des actions atomiques pour le clic principal (Left)
  - Chaque action a son formulaire dédié (give_item → material + count ; run_command → command + as)
  - Bouton "+ Ajouter une action"
  - Bouton "+ Ajouter une condition" → expose inline le panneau requirements
  - Bouton "+ Ajouter un cooldown" → expose inline le formulaire cooldown
  - Bouton "+ Ajouter un fallback" → expose inline la chaîne d'actions de fallback
  - Bouton "+ Ajouter un autre type de clic" → ajoute Right / Shift-Left / Shift-Right / Middle
- **Conditions et requirements** [exposées via "+ Ajouter une condition", inline] :
  - Liste de conditions (AND par défaut, toggle vers OR, négation par condition)
  - Pour chaque condition : type + paramètres avec autocomplétion
  - Composition imbriquée si nécessaire (groupes AND dans un OR, etc.)
- **Cooldown** [exposé via "+ Ajouter un cooldown", inline] :
  - Id, durée (ex. "5s", "1m"), scope (player/server/permission_group), message si en cooldown
- **View states** [exposés via "+ Ajouter un état conditionnel"] :
  - Liste des états conditionnels (réordonnable par drag)
  - Pour chaque état : conditions (`if`) + overrides d'apparence (asset, lore, title, click)
  - Bouton "+ Ajouter un état" pour empiler
- **Composant tiers** [auto-affiché si applicable] :
  - Affiche le composant utilisé (ex. "questx:quest_button") en read-only avec lien "voir dans la palette"
  - Toggle pour utiliser le default click action du composant ou définir le sien
  - Variables exposées par le composant (read-only, pour l'autocomplete dans les lore)
- **Template** [auto-affiché si instance] :
  - Affiche le template parent
  - Variables locales (éditables)
  - Bouton "Détacher" pour rompre le lien
- **Tags** [accessible via "+ Tags"] : tags libres pour search/filter (ex. "shop", "premium")

L'état d'expansion de chaque section est mémorisé par compte/menu — un admin qui travaille toujours avec ses view states expandus les retrouve ouverts à chaque session.

**Pour le menu (aucun slot sélectionné), sections :**

- **Identité** : id (read-only après création, auto-généré), nom, description.
- **Apparence** : taille (9-54), background (asset).
- **Open requirements** : conditions à valider pour pouvoir ouvrir le menu.
- **Open actions / Close actions** : actions à exécuter quand le menu s'ouvre/ferme.
- **Permission** : permission requise pour ouvrir le menu via commande.
- **Plugins utilisés** (read-only) : liste calculée automatiquement (`metadata.uses_plugins`).

### 5.5 Mode unifié à divulgation progressive + Export/Import JSON

Pas de toggle "Visual / Advanced". Un seul éditeur unifié qui présente les actions simples au premier plan et expose les capacités avancées via les boutons "+ Ajouter X" et les sections expandables détaillées en section 5.4.

Bénéfices vs un système à modes :

- **Discoverability** : les boutons "+ Ajouter une condition", "+ Ajouter un cooldown", etc. servent eux-mêmes de doc implicite. L'admin novice apprend en lisant l'UI.
- **Pas de friction** : tout est à un clic, pas à un mode-shift. Workflow fluide pour novices et power users dans la même session.
- **Architecture simple** : pas de state global "mode actif", pas de différents layouts à concevoir, un seul DOM tree avec sections collapsables.

Inspiration : Notion (slash commands), Linear (filtres et options inline), Figma (panels nested cleanly).

Pour les modifications très complexes ou les power users habitués à travailler avec une IA, l'éditeur expose trois capacités complémentaires :

- **Export JSON** : télécharge le menu courant en `.json`. Utile pour partage, versionning Git, manipulation externe par script ou IA.
- **Import JSON** : upload d'un `.json` validé strictement contre le schéma versionné, puis remplace le draft courant. Erreurs de validation affichées clairement avec path JSONPath et raison.
- **View raw JSON** : modal read-only avec syntax highlighting, bouton "Copy to clipboard", et (V1.5+) deep link "Open in Claude" / "Open in ChatGPT" qui pré-remplit le contexte côté IA externe.

**Philosophie** : l'éditeur visuel reste la surface canonique. Les power users qui veulent modifier au format JSON exportent, modifient ailleurs (manuellement ou via IA), réimportent. Cette séparation simplifie l'architecture et s'aligne avec l'usage moderne — les IA génèrent du JSON proprement avec un schéma bien documenté, mieux que la plupart des humains avec un éditeur YAML.

### 5.6 AI-ready par design

Le schéma JSON est traité comme un asset produit central :

- **Versionné** (`menu/v1`, `menu/v2`...) avec migrations applicables au load.
- **Documenté en TypeScript types + JSON Schema** publié sur `docs.interfaze.gg/schema`.
- **Exemples annotés** pour les patterns courants (shop simple, menu paginé avec composant tiers, view states, etc.).
- **Stable et explicite** : noms de champs verbeux et explicites plutôt que cryptiques (`requirements` plutôt que `req`, `actions` plutôt que `act`).

Cette qualité de schéma rend l'usage des IA externes (Claude, ChatGPT, Cursor, etc.) trivial dès le MVP. À chaque export, l'admin peut prompt "voici mon menu Interfaze, ajoute-moi une condition has_money sur ce slot" et obtenir un JSON valide à réimporter.

Roadmap AI native (V1.5+ et V2+) construite sur cette base — voir section 20.

### 5.7 Toolbar

En haut, gauche à droite :

- **Logo** (clic → dashboard).
- **Breadcrumb** : `Dashboard > Serveur > Nom du menu`.
- **État du menu** : badge coloré (Live / Draft).
- **Boutons JSON** : Export, Import, View raw (groupés dans un menu déroulant si pas la place horizontalement).
- **Undo / Redo** (icônes + raccourcis Ctrl+Z, Ctrl+Shift+Z).
- **Preview in-game** : bouton "Preview" qui pop un toast "Tape /menu preview shop_main en jeu pour voir ta version actuelle."
- **History** : icône horloge → ouvre un drawer avec les 5 dernières versions publiées + les snapshots autosave de la session.
- **Save indicator** : "Saved 2s ago" ou "Saving..." (autosave).
- **Publish** : bouton primary à droite, toujours visible. Clic → dialog de confirmation avec preview "ce qui change" et bouton final "Publish to live".

### 5.8 Status bar

En bas, fine, toujours visible :

- **WS status** : pastille verte "Live edit on" / pastille rouge "Disconnected, working offline".
- **Server connecté** : nom du serveur sur lequel les modifs sont pushées.
- **Compteur de joueurs** : nombre de joueurs en ligne sur le serveur (utile pour savoir combien de monde est exposé au menu).
- **Temps depuis dernière sync** : "Last sync: 3s ago".
- **Hash de la version courante** : 8 premiers caractères du hash du draft (utile pour signaler aux co-admins quelle version on regarde).
- **Username de l'admin** + indicateur soft-lock (si quelqu'un d'autre édite le menu, badge "@username2 viewing").

### 5.9 Édition live et collaboration

L'éditeur affiche en permanence l'état de la connexion WebSocket. Si le tunnel est actif, chaque modification est pushée au plugin et visible en jeu.

**Live edit visible par l'admin** :
- L'admin tape `/menu join_edit shop_main` en jeu sur le serveur.
- L'inventaire shop_main s'ouvre dans son client Minecraft, branché sur le draft de l'éditeur.
- Chaque modification dans l'éditeur web se reflète quasi-instantanément dans son inventaire.
- L'admin peut tester les clicks ; les actions s'exécutent réellement (give item, take money, etc.) — il édite sa propre expérience.

**Live edit invité (whitelist)** :
- L'admin peut inviter d'autres joueurs en jeu : `/menu invite_edit shop_main @PlayerB`.
- PlayerB peut alors taper `/menu join_edit shop_main` et voit le draft.
- Utile pour valider à plusieurs avant de publier.

**Soft-lock multi-admin** :
- Si un autre admin du compte ouvre le même menu dans l'éditeur web, on lui affiche un read-only avec bandeau "@username1 est en train d'éditer. [Take over]".
- Take over : confirmation, puis on bascule le contrôle. L'autre admin reçoit une notification "@username2 a pris la main".
- Pas d'édition simultanée à la Figma au MVP.

---

## 6. Asset library

### 6.1 Vue d'ensemble

Page accessible depuis le dashboard et depuis le panel gauche de l'éditeur. Vue grid avec previews des assets, organisés en folders et sources.

### 6.2 Sources (sidebar gauche)

Arborescence des sources d'assets :

- **My uploads** : ce que l'admin a uploadé.
  - Folders user-created (drag-drop pour réorganiser).
  - Sub-folders nestables.
- **Imported** : assets importés depuis des packs externes.
  - Un sub-folder par pack importé (ex. "MCModels: FantasyShopPack").
  - Read-only au niveau organisationnel (ne peut pas réorganiser, mais peut tag).
- **Plugin sources** (V1.5) :
  - **Nexo** : organisé par catégorie déclarée dans Nexo. Read-only.
  - **ItemAdder** : organisé par namespace. Read-only.
- **Marketplace** (V2) : assets achetés.

### 6.3 Vue principale (grid)

Grid responsive d'assets avec :

- Thumbnail (rendu de l'asset, possiblement avec preview "in-context" — ex. dans un slot d'inventaire).
- Nom du fichier.
- Métadonnées : dimensions, date upload, nombre d'utilisations.
- Actions hover : preview détaillé, edit (rename, tags), delete (avec confirmation).

### 6.4 Recherche et filtres

- Search bar avec fuzzy matching sur le nom, les tags, le folder.
- Filter par tag (multi-select).
- Filter par dimension (16×16, 32×32, etc.).
- Filter "used / unused" : assets utilisés dans au moins un menu vs non-utilisés (utile pour le cleanup).
- Tri : nom, date upload, dimensions, usages.

### 6.5 Upload flow

- Bouton "Upload" en haut à droite.
- Modal avec drop-zone (drag-drop multiple) ou file picker.
- Pour chaque fichier :
  - Validation : PNG only, taille max 2 MB.
  - **Normalization preview** : "Cette image fait 47×47px. Elle sera redimensionnée en 64×64. Voici le preview avant/après." Toggle "Don't show again for similar cases".
  - Sélection du folder de destination.
  - Tags (optionnel).
- Bouton "Upload all" pour lancer le batch.
- Détection de doublons : si le hash MD5 existe déjà, prompt "Cet asset existe déjà sous le nom X dans le folder Y. [Overwrite] [Duplicate] [Skip]".

### 6.6 Drag-drop vers le canvas

Depuis la grid de l'asset library (ou depuis le panel gauche dans l'éditeur de menu), l'admin drag un asset directement sur un slot du canvas. Animation visuelle pendant le drag (le slot cible highlight).

### 6.7 Cleanup et quotas

- Vue "Unused assets" qui liste les assets sans aucune référence dans un menu.
- Bouton "Delete unused" avec confirmation et compteur d'espace libéré.
- Indicateur de quota dans l'header (X / Y MB used). Devient orange à 80%, rouge à 95%.
- Si quota atteint : modal blocant à l'upload "Tu as atteint ta limite de stockage. [Cleanup] [Upgrade]".

---

## 7. Templates user-defined

### 7.1 Vue d'ensemble

Onglet "Templates" dans le panel gauche de l'éditeur, et page dédiée dans le dashboard pour gestion globale.

### 7.2 Création d'un template

Depuis l'éditeur :

- Sélectionner un slot configuré (asset + click + lore).
- Right-click → "Save as template".
- Modal : nom du template, description, choix des **variables** (les valeurs qui seront paramétrables).
  - Pour chaque attribut (asset, material, title, lore, action params), toggle "make this a variable".
  - Pour chaque variable : nom (ex. `prix`), type (string, number, material, item, permission), valeur par défaut.
- Le template est sauvegardé. Le slot d'origine devient une instance du template.

### 7.3 Utilisation d'un template

- Drag depuis la palette "Templates" vers un slot.
- Modal de paramétrage : remplir les variables (avec autocomplete selon le type).
- Le slot devient une instance liée.

### 7.4 Édition d'un template

- Cliquer sur un template dans la palette ou dans la page de gestion → ouvre l'éditeur de template.
- Modifier l'apparence ou les actions.
- À la sauvegarde, prompt : "Ce template est utilisé dans 12 menus, sur 47 slots. Propager les changements à toutes les instances ?" [Yes / No, save as new template].

### 7.5 Override local vs édition globale

- Sur une instance de template, l'admin peut overrider localement un attribut (ex. lore custom pour ce seul slot).
- L'override est visible : le champ overridé a un badge "modified locally" + bouton "revert to template".
- Édition d'un attribut variable : prompt "Edit template (propagates) or local override?" la première fois, puis l'admin peut configurer son comportement par défaut.

### 7.6 Détachement

Bouton "Detach from template" sur une instance → le slot devient indépendant, plus aucune propagation.

### 7.7 Page de gestion (dashboard)

- Liste de tous les templates avec usage count, dernière modification, créateur.
- Search.
- Bouton "Delete template" (avec confirmation, et option "convert all instances to standalone slots").

---

## 8. Intégrations plugins tiers

### 8.1 Détection automatique

L'éditeur affiche dans le panel gauche un onglet par plugin tiers détecté sur le serveur connecté. Pas d'action manuelle nécessaire — c'est sync via WS au boot.

### 8.2 Vue d'un plugin tiers (palette dédiée)

Pour chaque plugin :

- Nom et logo (si fourni par le plugin).
- Version installée.
- Lien "Voir les layouts suggérés" qui ouvre une galerie.
- Liste des composants disponibles : displayName, icône, mode (single/paginable), description.
- Search sur les composants.

### 8.3 Spawn from suggested

- Galerie de layouts suggérés (cards visuels avec preview).
- Clic sur un layout → modal "Créer un menu à partir de ce layout suggéré". Nom du menu, serveur cible.
- Le menu est créé indépendamment, l'admin arrive sur le canvas pour le customiser.

### 8.4 Indicateur d'indisponibilité

Si un menu utilise un composant qui n'est plus déclaré (plugin update, suppression), le slot affiche :

- Visuellement grisé avec icône warning.
- Tooltip "Ce composant (`questx:old_filter`) n'est plus disponible dans la version actuelle de QuestX. Tu peux le supprimer ou le remplacer."
- Pas de blocage de publish — l'admin choisit.

### 8.5 Voir le composant en détail

Click sur un composant dans la palette → drawer avec :

- Description complète.
- Liste des placeholders exposés (avec exemples de valeurs).
- Action par défaut au clic.
- Defaults d'apparence.
- Mini documentation fournie par le plugin tiers.

---

## 9. Workflow Live / Draft

### 9.1 États visibles en permanence

Dans la toolbar de l'éditeur, badge coloré indiquant l'état du menu courant :

- **Draft** (orange) : modifications non publiées, visibles uniquement par l'admin en édition live via `/menu preview <id>`.
- **Live** (vert) : version servie aux joueurs.

Le badge change automatiquement après publish.

> Un troisième état **Staging** (preview gelée accessible aux testeurs invités via permission `menu.preview.<id>`) est prévu en V1.5 quand les workflows en équipe deviennent un use case réel. Hors scope MVP.

### 9.2 Publish (draft → live)

Bouton "Publish" dans la toolbar. Au clic :

- Modal "Publier ce menu ?" avec :
  - Diff visuel ou textuel des modifications par rapport à la live actuelle.
  - Avertissements si des composants tiers utilisés ont une version qui pourrait être incompatible avec un autre serveur du compte (cas multi-server).
  - Champ optionnel "Description de cette version" (utile pour l'historique).
  - Bouton final "Publish to live".

### 9.3 Preview in-game

Bouton "Preview" → toast avec instructions "Tape `/menu preview shop_main` en jeu pour voir le draft actuel". L'admin peut alors voir les modifs sans publier.

### 9.4 History et rollback

Drawer accessible depuis l'icône horloge dans la toolbar :

- Liste des 5 dernières versions publiées (date, auteur, description).
- Bouton "Rollback to this version" sur chaque entrée → re-publie cette version comme nouvelle live (sans détruire les versions intermédiaires, qui restent dans l'historique).
- Snapshots autosave de la session courante en haut de la liste (utiles pour récupérer un travail accidentellement supprimé).

### 9.5 Soft-lock multi-admin

Indicateur visible en haut du canvas si un autre admin a ouvert le menu :

- "@username1 est en train d'éditer ce menu" + photo Discord.
- Bouton "Take over" (avec confirmation).
- En lecture seule pour le 2e admin tant qu'il n'a pas pris la main.

---

## 10. Gestion des serveurs

### 10.1 Page "Servers" dans les réglages

Liste des serveurs liés au compte.

Par serveur :

- Nom (éditable).
- Server key (masquée par défaut, "Reveal" pour voir, "Regenerate" pour invalider l'ancienne).
- Statut connexion (live, last seen X min ago, never connected).
- Version Minecraft détectée.
- Plugins tiers détectés (résumé).
- Tier appliqué (Solo/Network/Unlimited selon le compte).
- Tags optionnels (ex. "prod", "dev", "staging").
- Bouton "Disconnect" (révoque la clé).
- Bouton "Configure" → page de config détaillée (nom affiché côté éditeur, env de dev/prod, etc.).

### 10.2 Ajouter un serveur

Bouton "Add server" en haut. Modal :

- Nom du serveur.
- Tag (prod / dev / staging).
- Génère une server key, affichée avec instructions copier-coller.
- Loader "en attente de connexion" (jusqu'à la première reconnexion du plugin via WS).

### 10.3 Limites par tier

Compteur de serveurs vs limite du tier. Si limite atteinte, blocage de "Add server" avec CTA "Upgrade".

---

## 11. Gestion d'équipe

### 11.1 Page "Team" dans les réglages

(MVP : compte solo + invitation simple. Multi-utilisateur élaboré en V1.5.)

Liste des membres du compte avec :

- Discord username + avatar.
- Rôle (Owner, Admin, Editor, Viewer).
- Date d'ajout.
- Dernière activité.
- Bouton "Remove" (sauf pour owner).

### 11.2 Inviter un membre

Bouton "Invite member". Deux options :

- Par username Discord : entrer le username, le membre reçoit une invitation in-app au prochain login.
- Par rôle Discord (V1.5) : "Tous les membres avec le rôle @admin sur le serveur Discord X". Configurer une fois, automatique après.

### 11.3 Permissions par rôle

- **Owner** : tout, y compris billing, suppression du compte.
- **Admin** : édite, publish, gère membres (sauf owner).
- **Editor** : édite, ne peut pas publish ni gérer membres.
- **Viewer** : read-only sur tout.

---

## 12. Compte et facturation

### 12.1 Page "Billing"

- Plan actuel : Solo / Network / Unlimited + détail (nombre de serveurs inclus, storage, etc.).
- Période de facturation : mensuelle / annuelle (annuelle = -15%).
- Prochain renouvellement.
- Méthode de paiement (carte via Stripe).
- Bouton "Upgrade plan" / "Change plan".
- Bouton "Cancel subscription" avec confirmation et message rassurant : "Tes menus existants continueront de fonctionner pour toujours, même après l'annulation. Tu pourras simplement plus pousser de nouvelles modifications."

### 12.2 Usage en cours

Compteurs visuels :

- Serveurs liés (X / Y).
- Storage assets (X / Y MB).
- Nombre de menus.
- Nombre de membres d'équipe.

### 12.3 Historique de facturation

Liste des factures Stripe avec date, montant, statut (paid, failed), lien de téléchargement PDF.

### 12.4 Upgrade flow

- Bouton "Upgrade" depuis n'importe où.
- Comparateur de tiers en pricing page.
- Stripe Checkout integration.
- Après paiement : redirect vers le dashboard avec banner "Welcome to [Tier]! Your new features are unlocked."

### 12.5 Downgrade

- Bouton "Change plan" → select un tier inférieur.
- Modal d'avertissement si downgrade entraîne dépassement (ex. 8 serveurs liés mais downgrade vers Solo qui en autorise 1) : "Tu dois déconnecter X serveurs avant de downgrader."
- Application au prochain cycle de facturation (pas de pro-rata).

---

## 13. Notifications et activité

### 13.1 Centre de notifications

Icône cloche en header. Affiche les notifications non lues :

- "@username1 a publié le menu Shop Principal il y a 5 min."
- "Quota storage à 92%."
- "QuestX a une mise à jour disponible (v2.1.0) — tes menus continuent de fonctionner."
- "Ton serveur Dev est déconnecté depuis 3h."
- Notifications de billing (paiement réussi, échec, renouvellement à venir).

### 13.2 Préférences de notification

Page dédiée dans les réglages. Toggle par type de notif :

- Activité d'équipe (publish, modifs).
- Quota (proche limite, atteint).
- Plugin updates (compatibilité).
- Connexion serveur (déconnexions prolongées).
- Billing.

Notifications email optionnelles pour les évents critiques.

---

## 14. Paramètres et profil

### 14.1 Profil

- Discord identity (read-only, lien "Reconnect Discord").
- Recovery email (éditable).
- Display name (utilisé dans les indicateurs multi-admin).
- Avatar (auto-pulled de Discord, override possible).

### 14.2 Préférences éditeur

- Theme : Light / Dark / System.
- Langue : FR, EN au minimum (extensible).
- Auto-save interval (default 10s, configurable).
- Toggle "Show normalization popup" (référence à l'upload d'assets).
- Toggle "Show tutorial tooltips for new features" (à afficher sur les features fraîchement débloquées).

### 14.3 Avancé

- Token API perso (pour intégrations tierces ou exports custom).
- Export de toutes mes données (RGPD).
- Suppression du compte.

---

## 15. Aide et support

### 15.1 Help inline

- Icône "?" en header → drawer avec doc contextuelle.
- Recherche dans la doc.
- Liens vers tutoriels vidéo (intégrés depuis YouTube).

### 15.2 Doc developer (V1.5)

Lien vers `docs.interfaze.gg` pour la doc API tierce.

### 15.3 Contact support

- Bouton "Contact support" qui ouvre :
  - Email pré-rempli avec le contexte (compte, serveur, version) si offline.
  - Discord modal qui pointe vers le channel #support.
- FAQ accessible directement.

### 15.4 Communauté

- Lien Discord communautaire visible.
- Lien vers les feature requests / bug tracker public.

---

## 16. Raccourcis clavier

Liste des raccourcis disponibles dans l'éditeur :

| Raccourci | Action |
|---|---|
| `Ctrl/Cmd + S` | Force save (autosave est actif par défaut) |
| `Ctrl/Cmd + Z` | Undo |
| `Ctrl/Cmd + Shift + Z` | Redo |
| `Ctrl/Cmd + C` / `+ V` | Copy / paste un slot |
| `Ctrl/Cmd + D` | Duplicate slot sélectionné |
| `Delete` / `Backspace` | Vider le slot sélectionné |
| `Ctrl/Cmd + A` | Sélectionner tous les slots |
| `Esc` | Désélectionner |
| `Shift + clic` | Ajouter à la sélection |
| `Ctrl/Cmd + K` | Command palette (search rapide actions) |
| `/` | Focus search bar (palette) |
| `Ctrl/Cmd + P` | Publish (avec dialog de confirmation) |
| `Ctrl/Cmd + Shift + P` | Preview in-game |
| `?` | Afficher la cheat sheet des raccourcis |
| `[` / `]` | Toggle panel gauche / droite |
| `Ctrl/Cmd + E` | Export JSON |
| `Ctrl/Cmd + I` | Import JSON |
| `Ctrl/Cmd + J` | View raw JSON |

---

## 17. États système et messages d'erreur

### 17.1 Connexion WS perdue

- Banner discret en bas du canvas : "Connexion live perdue. Tes modifications sont sauvegardées localement et seront pushées à la reconnexion."
- Reconnexion auto exponentielle.
- Pas de blocage de l'édition (l'admin peut continuer à travailler offline).

### 17.2 Conflit de modification (multi-admin)

- Si l'admin est en read-only à cause d'un soft-lock et tente d'éditer : tooltip "Tu es en lecture seule. [Take over]".

### 17.3 Validation errors (Import JSON)

- Si le JSON importé est invalide : modal d'erreur avec liste précise des problèmes (path JSONPath + raison).
- Le draft courant n'est pas affecté (rollback transparent).
- L'admin peut corriger côté source (manuellement ou en re-prompt l'IA) et re-tenter l'import.

### 17.4 Quota atteint

- Modal blocant à l'upload : "Storage quota atteint. [Cleanup unused] [Upgrade plan]".
- Notification soft à 80% (orange) puis 95% (rouge).

### 17.5 Plugin tiers en erreur

- Si un plugin tiers crash au registration : son onglet dans la palette affiche "Plugin error — composants indisponibles. Voir les logs serveur." Pas d'impact sur les autres plugins.

### 17.6 Asset manquant

- Si un asset référencé dans un slot a été supprimé : slot affiche un placeholder rouge "Asset manquant" avec bouton "Replace" rapide.

### 17.7 Bundle non publiable

- Si la publication échoue (erreur côté éditeur ou plugin) : toast d'erreur explicite + lien "Voir les détails" qui pop un drawer avec stack trace ou raison de l'échec.

---

## 18. Responsive et accessibilité

### 18.1 Cibles

- **Desktop** : expérience complète, optimisée pour les écrans 1280px+ (la majorité des admins). Le canvas + panels sont naturellement larges.
- **Laptop 13"** : layout fonctionnel, panels collapsables pour récupérer de la largeur.
- **Tablette** : best-effort. L'édition est possible mais moins agréable. À documenter.
- **Mobile** : pas supporté pour l'édition au MVP. Vue read-only des menus + dashboard simplifié possible. À envisager en V2.

### 18.2 Accessibilité

- Contraste suffisant (WCAG AA minimum).
- Navigation clavier complète (focus visibles, ordre logique de tab).
- Alt text sur les assets dans la palette (généré depuis le nom de fichier).
- ARIA labels sur les actions et états dynamiques.
- Pas de dépendance à la couleur seule pour communiquer un état (ex. erreur = rouge **+ icône**).

### 18.3 Internationalisation

- I18n dès le MVP (FR + EN).
- Système prêt pour ajout de langues sans refactor (ES, DE, RU, ZH probables selon la base d'utilisateurs).
- Date/time format selon la locale.

---

## 19. Performances et UX

### 19.1 Cibles de performance

- **Time to interactive** au login : < 2s sur connexion fibre, < 4s sur 4G.
- **Drag d'un asset** : feedback en < 100ms.
- **Édition d'un attribut** : update du canvas en < 50ms.
- **Push WS vers plugin** : visible en jeu en < 200ms.
- **Publish** : feedback "publishing" + complétion en < 3s pour un menu standard.

### 19.2 Optimisations clés

- Code splitting pour ne charger que les chunks utilisés (l'éditeur en lui-même est un gros chunk).
- Lazy loading des assets dans la palette (virtualization si beaucoup d'items).
- Debouncing des autosaves et des push WS.
- Cache local des configs serveur (placeholders, permissions, materials).
- Préchargement des thumbnails d'assets au survol de la palette.

### 19.3 UX en cas de lenteur

- Skeleton loaders sur tout chargement > 200ms.
- Optimistic updates : les modifications apparaissent immédiatement dans le UI, le sync serveur est silencieux derrière.
- Si une opération échoue : toast d'erreur + auto-retry transparent quand possible.

---

## 20. Spec MVP V1 vs V2+

### 20.1 Inclus dans le MVP V1

- Login Discord OAuth ou email/password (les deux en V1).
- Onboarding 3 étapes.
- Dashboard avec sélecteur de serveur, liste de menus, activité récente.
- Éditeur complet :
  - Canvas 9×N avec drag-drop, sélection, multi-select, copier-coller.
  - Panel gauche avec palettes : Items vanilla, Mes assets, Templates, Plugins tiers détectés.
  - Panel droit avec properties (apparence, click actions, conditions, view states, cooldown, tags).
  - Mode unifié à divulgation progressive (sections expandables, boutons "+ Ajouter X").
  - Export JSON / Import JSON / View raw JSON (pas d'éditeur de code embarqué).
  - Schéma JSON versionné, bien documenté, AI-ready (publié sur `docs.interfaze.gg/schema`).
  - Toolbar avec save / publish / preview / history / undo-redo.
  - Status bar avec WS status.
- Édition live in-game (`/menu join_edit`).
- Soft-lock multi-admin.
- Asset library : upload, normalization popup, folders, tags, search, drag-drop, cleanup, quotas.
- Templates : création, édition, variables, override local, détachement.
- Intégrations plugins tiers : palette dédiée, spawn from suggested, indicateur d'indisponibilité.
- Workflow Live / Draft avec history et rollback.
- Gestion serveurs : add, configure, regenerate key, statut.
- Gestion d'équipe basique : invite par username Discord, 4 rôles.
- Billing : tiers, Stripe Checkout, history, downgrade, cancel.
- Notifications in-app.
- Profil et préférences.
- Help inline + doc statique.
- Raccourcis clavier.
- I18n FR + EN.
- Theme Light / Dark.
- Responsive desktop + laptop.

### 20.2 V1.5

- **Killer feature 1 : palettes Nexo et ItemAdder** dans la palette gauche, drag-drop direct des items custom.
- **Killer feature 2 : assistant IA intégré** ("Ask AI" dans la toolbar) qui prend du langage naturel ("ajoute un bouton pour acheter un rang VIP à 500$") et applique des mutations sur le JSON du menu via Claude API. Coût marginal absorbé par les tiers Network/Unlimited.
- Deep links "Open in Claude" / "Open in ChatGPT" depuis le View raw JSON, qui pré-remplissent le contexte côté IA externe.
- Invitation d'équipe par rôle Discord ("tous les @admin").
- Doc developer site (`docs.interfaze.gg`) avec schéma JSON publié + exemples annotés + types TypeScript.
- Mode "Promote to prod" (copier un menu d'un serveur dev vers prod).
- Historique enrichi (visualisation des diffs entre versions).
- Notifications email pour les évents critiques.

### 20.3 V2+

- **Killer feature : serveur MCP `interfaze-mcp`** qui permet aux utilisateurs de Claude Desktop, Cursor, ChatGPT MCP-enabled, etc. de lister, lire, et muter leurs menus Interfaze depuis leur outil habituel ("dans Cursor : édite mon menu shop_principal pour ajouter X"). Différenciation forte AI-native vs concurrence.
- Marketplace native (assets, menus, intégrations tierces).
- Édition collaborative en temps réel (Figma-like).
- Auto-convert de configs zMenu / DeluxeMenus.
- Refresh continu des view states (progress bars dynamiques).
- Variables natives (player/server/session scopes) avec UI dédiée.
- Mobile read-only.
- Plus de langues (ES, DE, RU, ZH selon la base d'utilisateurs).
- API publique REST/GraphQL pour automation tierce.
- Analytics intégrées sur les menus (qui ouvre quoi, quels boutons sont cliqués, où les joueurs lâchent).

---

## 21. Risques UX à valider en proto

À tester sur 5-10 admins en sessions de 15 minutes pendant le proto :

- **Compréhension du concept de slot** : un admin Minecraft "voit" naturellement les inventaires comme des grilles de slots ?
- **Drag-drop intuitif** : la mécanique drag depuis la palette vers le canvas est-elle évidente sans tutoriel ?
- **Divulgation progressive** : les boutons "+ Ajouter une condition" / "+ Ajouter un cooldown" / etc. sont-ils suffisamment visibles pour être découverts naturellement, ou trop discrets et donc invisibles ?
- **View states** : la notion d'apparence conditionnelle est-elle saisissable sans formation, ou nécessite-t-elle un onboarding spécifique ?
- **Templates avec variables** : les power users les utilisent-ils, ou ignorent-ils le feature et copier-collent à la place ?
- **Workflow Live / Draft** : confusion entre les deux états, ou clarté immédiate ?
- **Live edit in-game** : effet "wow" attendu en démo, ou perçu comme gadget ?
- **Quota et upgrade flow** : l'admin comprend-il le modèle freemium quand il atteint un quota, ou se sent-il piégé ?

Ces risques UX sont les vrais inconnus du projet (la tech est validée par NxMenu). À itérer en proto avant de coder le MVP final.

---

*Document vivant — à mettre à jour à mesure que les choix de design se précisent.*