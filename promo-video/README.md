# Vidéo de présentation

Vidéo Remotion des pages de vente. Elle affiche les **vrais composants de l'éditeur**
(`editor/src` importé tel quel : canvas Konva, bibliothèque, inspecteur, infobulle,
revue de déploiement, tokens et classes du design system), alimentés par un projet de
démo écrit comme un vrai projet sur disque (`project/`).

## Commandes

```bash
cd editor && npm ci            # les composants viennent de editor/node_modules
cd promo-video && npm ci
npm run assets                 # textures MC 1.21.4 (jar Mojang + icônes de backend/assets-seed) → .cache/
npm run studio                 # aperçu interactif
npm run render                 # → out/artisan-promo.mp4 (1080p, 30 i/s)
npm run typecheck
```

`scripts/render.mjs` lance un petit serveur de textures (`scripts/texture-server.mjs`,
port 3901) qui remplace le backend pour `/api/v1/textures/...`, puis la CLI Remotion.

## Structure

- `project/` : projet de démo « Skyward Network » (menus, commandes, disposition du canvas),
  lu par `projectFromFiles` comme l'éditeur lit un projet publié.
- `src/setup.ts` : amorçage de l'éditeur sans routeur ni backend (i18n, modules, textures, polices).
- `src/kit/` : pilotage image par image (stores de l'éditeur, caméra du canvas, curseur, titres).
- `src/scenes/` : une scène par partie du storyboard ; `src/Promo.tsx` les enchaîne.

## Règles

- Chaque image pose un état **complet** dans les stores (`useDrive`) : Remotion rend les
  images dans le désordre, sur plusieurs onglets.
- Les transitions et animations CSS sont coupées (`styles.css`) : le mouvement vient des scènes.
- Une seule scène de canvas montée à la fois (fondus enchaînés via la surface, sans chevauchement).
