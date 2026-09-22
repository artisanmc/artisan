# Inventaire et preuves — audit bibliothèque / composition

Audit du code actuel, sans session navigateur. Pas de mesure de performance ni de test utilisateur. L’index du graphe contient des plages obsolètes : les composants concernés ont été relus directement. Les références ci-dessous sont relatives à la racine du dépôt.

## E1 — Bibliothèque : fonctions et architecture actuelle

| Élément | Fonction actuelle | Observation |
|---|---|---|
| Bibliothèque | Ouvrir/fermer une palette redimensionnable, latérale ou inférieure selon place disponible | Hôte commun au projet ; Échap ferme hors saisie/modale |
| Items > Catalogue | Rechercher, filtrer par catégorie, choisir/glisser un item sur une case | Mélange items Minecraft et items personnalisés de plugins |
| Items > Capturés | Réutiliser un item complet capturé depuis un inventaire de joueur ; supprimer une capture | Collection et acquisition mélangées ; acquisition dépend d’un serveur disponible |
| Boutons image | Importer, rechercher, voir les dimensions en cases, glisser une image sur le menu | Affiche toutes les images admissibles du projet, sans classement par rôle |
| Ressources graphiques | Importer images/polices, filtrer, rechercher, sélectionner un fichier | Gestion de fichiers ; les vignettes ne créent pas d’élément sur le menu |
| Fiche ressource | Aperçu, nom, type, dimensions, codepoint, ascent, sauvegarde/suppression | Paramètres techniques exposés ; remplace la grille dans la vue compacte |
| Sélecteur d’image | Choisir une image existante ou en importer depuis le contexte courant | Catalogue partagé ; choix filtré par type technique |
| Propriétés du menu | Identifiant, titre/composition, permission, type d’inventaire, rangées, entrées de contexte | Le mot « Titre » recouvre également les calques d’images |
| Composition du titre | Mode simple/composé, ajout image/texte, ordre et édition des calques | Mélange texte du titre et habillage graphique |
| Apparence d’un élément | Item ou image ; image, largeur/hauteur en cases, ajustement, décalages, recentrage | Le bouton placé peut changer d’apparence sans changer son rôle |
| Canevas | Placement des éléments dans les menus | Bouton image soumis aux contraintes de rectangle et de collision |

Sources : editor/src/features/project/ProjectLibrary.tsx:28,49,93,148 ; editor/src/features/canvas/Library.tsx:79,141,174 ; editor/src/features/canvas/CapturedItemsSection.tsx:45,87,104,178 ; editor/src/features/assets/AssetsTab.tsx:14,39 ; editor/src/features/assets/AssetDetailPanel.tsx:62 ; editor/src/features/assets/AssetPicker.tsx:35 ; editor/src/features/canvas/properties/MenuProperties.tsx:61 ; editor/src/features/canvas/title/composer/LayersPanel.tsx:60 ; editor/src/features/flow/ImageButtonEditor.tsx:54.

Comptes : 3 onglets principaux et 2 choix secondaires dans Items (ProjectLibrary.tsx:164–204). Le nombre de tuiles varie avec les données et la virtualisation ; aucun compte total d’interactions ou profondeur DOM effective n’est revendiqué. Les imports/props inutilisés ne sont pas audités : ils n’expliquent pas ici la fonction utilisateur.

## E2 — Cause du doublon d’images

- AssetsTab lit le catalogue useAssetStore et filtre par type/recherche : AssetsTab.tsx:24,33.
- ImageButtonLibrary lit le même catalogue et conserve tout asset du projet non-font à dimensions positives : ImageButtonLibrary.tsx:42–51.
- L’import d’image crée toujours un glyph, pour permettre plusieurs usages : AssetUploadDialog.tsx:34–39,70.
- Le modèle Asset n’a pas de rôle fond/bouton/décoration : editor/src/domain/asset.ts:21.
- Conclusion : deux vues du même catalogue sont établies. Aucune preuve de double stockage physique n’est avancée.

Une simple nouvelle arborescence d’onglets ne corrigerait pas le mélange : il faut classer les usages.

## E3 — Gestes non cohérents

- Item du catalogue : clic pour préparer le placement ; drag également disponible (Library.tsx:44,79).
- Item capturé : même principe (CapturedItemsSection.tsx:178).
- Image bouton : drag, sans onClick d’insertion sur sa carte (ImageButtonLibrary.tsx:16–37).
- Ressource : clic ouvre la fiche (AssetGrid.tsx:62–77).
- Le drop d’image crée un élément dans la case cible et le sélectionne (imageButtonDrop.ts:13–21).

La remarque « on ne peut pas glisser les images » est donc exacte pour la grille Ressources graphiques, pas pour Boutons image. La similarité des contenus cache des comportements différents.

## E4 — Fond, décoration et bouton sont des usages différents

- Les titres contiennent background, glyph, texte et autres couches : editor/src/domain/types.ts:55.
- Le compositeur ajoute une image en tant que glyph et un texte comme textarea ; pas comme bouton : LayersPanel.tsx:119–143.
- Un bouton image exige une zone rectangulaire fixe sans collision : editor/src/domain/imageButton.ts:57–76.
- L’emprise initiale utilise ceil(width/16) × ceil(height/16) : docs/schema/menu/v1/imageButtonGeometry.ts:8–11.
- Un fond hypothétique 176 × 166 px serait donc proposé en 11 × 11 cases comme bouton : cet exemple est un calcul illustratif, pas un asset observé. Il explique pourquoi classer toutes les images en boutons est mauvais.
- Le compositeur expose « Vanilla », « Composé (Resource Project) », et crée d’abord un calque à assetId vide : LayersPanel.tsx:119–143,235–272.
- Le bouton image n’implique pas qu’une action métier soit déjà configurée ; la bibliothèque choisit surtout une apparence et un mode de placement.

## E5 — Libellés et états

- Anglais/termes internes : Upload, Import font, Search…, all/texture/glyph/font (AssetsTab.tsx:14,44–68), Name/Type/Codepoint/Ascent/Delete/Save (AssetDetailPanel.tsx:71–103).
- « Titre » recouvre le compositeur (locales/fr.ts:223 ; MenuProperties.tsx:109).
- « Armé » / « Désarmer » expose un état interne (locales/fr.ts:631–632).
- Images : une recherche sans résultat affiche le message de première importation (ImageButtonLibrary.tsx:70 ; locales/fr.ts:22).
- Captures : le message vide renvoie à un contrôle « ci-dessous » qui peut être masqué en démo/hors connexion (CapturedItemsSection.tsx:45,100,104).
- loading/error existent dans le store assets mais les catalogues ne les rendent pas (useAssetInit.ts:47–48 ; AssetsTab.tsx:24 ; ImageButtonLibrary.tsx:42).
- Réouverture : sous-onglet, recherche et contexte de capture sont locaux et perdus au démontage (ProjectLibrary.tsx:129,153 ; Library.tsx:123 ; CapturedItemsSection.tsx:47).

Aucun mécanisme commercial trompeur constaté dans ce périmètre. Les problèmes d’honnêteté concernent la description des états et des gestes, pas une intention présumée.

## E6 — Visuel et accessibilité (inférés du code)

- Base de tokens sémantiques, composants Button/Input/Tabs, miniatures items 48 px : Library.tsx:17,86–91 ; ProjectLibrary.tsx:2–3.
- Cartes images de hauteur minimale 108 px, titres, dimensions : ImageButtonLibrary.tsx:29–35.
- Nombreuses microtypographies 10–12 px ; inventaire graphique très dense (AssetsTab.tsx:62 ; AssetDetailPanel.tsx:71 ; Library.tsx:185).
- Fermeture adaptée 44 px hors desktop ; retour Escape prévu : ProjectLibrary.tsx:93,178.
- Suppression capture très petite et sans nom explicite dédié : CapturedItemsSection.tsx:210–217.
- Focus, contraste et navigation intégrale doivent encore être vérifiés dans le navigateur. Les tokens seuls ne constituent pas un audit WCAG du rendu.
- Les états chargement/erreur/vide sont incomplets dans les catalogues d’images ; le détail présente des erreurs mais pas de progression de sauvegarde : AssetDetailPanel.tsx:30–59,98–103.
- Aucune capture ni appréciation de la mise en page réelle à différentes tailles n’est présentée comme vérifiée.

## E7 — Poids et friction

- Bonne base : virtualisation Items et Assets, images lazy (Library.tsx:156 ; AssetGrid.tsx:37,81).
- Boutons image et sélecteur montent toutes les cartes (ImageButtonLibrary.tsx:66 ; AssetPicker.tsx:82).
- Chargement assets nécessaire au rendu des titres avant ouverture de bibliothèque : AssetsTab.tsx:21.
- Chargement items/custom/assets au montage ; préparation de tous les items modélisés à examiner : ProjectLibrary.tsx:57 ; useTextureInit.ts:57,68,73.
- Un cache partagé est déjà présent ; ne pas proposer un chargement des fonds seulement à l’ouverture de leur palette.
- Animations de panneau et réduction du mouvement : editor/src/lib/usePanelPresence.ts:7,22.
- Octets JS initiaux, requêtes réellement transférées, TTI, animations au repos et performance appareil : non mesurés.

## E8 — Limites

L’audit concerne l’éditeur de menus et sa bibliothèque, pas les écrans comptes, facturation, administration ou la totalité des modules. Pas de benchmark de concurrents, pas de test utilisateur, pas de vérification en jeu. Les propositions d’accessibilité sont à valider par parcours clavier réel. Les faits décisifs sur classement, gestes et labels sont directement vérifiables dans les composants actuels.
