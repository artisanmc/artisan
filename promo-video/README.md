# Vidéo de présentation

Vidéo Remotion des pages de vente. Elle monte **l'éditeur entier** (`editor/src` : son routeur,
ses modules, ses stores) dans une composition, et le pilote comme un visiteur : un curseur, des
clics, de la saisie. Rien n'est redessiné pour la vidéo.

L'éditeur parle à un **hub rejoué** (`scripts/hub.mjs`) : les réponses d'un vrai serveur,
enregistrées une fois dans `fixtures/hub/`. Le rendu ne demande donc ni serveur Minecraft ni réseau.

## Commandes

```bash
cd editor && npm ci            # l'éditeur vient de editor/src et editor/node_modules
cd promo-video && npm ci
npm run routes                 # génère editor/src/routeTree.gen.ts (ignoré par git)
npm run render                 # → out/artisan-promo.mp4 (1080p, 30 i/s)
npm run still -- item out/item.png --frame=120    # une image d'une scène
npm run gifs                   # les scènes de l'éditeur en GIF sans titre → out/gifs/ (800×450, 10 i/s)
npm run typecheck
```

`npm run render` rend chaque scène de `src/order.json` dans son propre navigateur, à un onglet,
puis colle les fichiers. Une scène modifie l'éditeur (saisie, brouillon) : elle part d'un éditeur
neuf et joue ses images dans l'ordre.

## Structure

- `demo/survival/` : le module de démo, tel qu'il est sur le serveur qui a servi à l'enregistrement.
- `fixtures/hub/` : `index.json` (requête → réponse) et `bodies/` (les corps, nommés par leur hash).
- `scripts/hub.mjs` : sert le bundle Remotion, `editor/public`, l'API enregistrée et un WebSocket
  silencieux, sur une seule origine (port de `scripts/hub.json`), comme le plugin sert l'éditeur.
- `src/app/` : `preboot.ts` et `boot.ts` (le même amorçage que `editor/src/main.tsx`),
  `engine.tsx` (déroulé d'une scène, curseur, cadrage, cibles).
- `fixtures/assistant.json` : la conversation de l'assistant, instant par instant.
- `src/scenes/editor.tsx` : les scènes jouées dans l'éditeur. `src/scenes/titles.tsx` : les écrans
  hors éditeur (ouverture, installation, modules, fin).
- `src/kit/` : curseur, titres, fond.

## Écrire une scène

Une scène est une adresse de l'éditeur, un déroulé et un cadrage :

```ts
{ at: 22, move: node("command:cmd_shop") },   // le curseur arrive sur un nœud de la planche
{ at: 34, click: true },                      // clic sur la cible du dernier déplacement
...typing(102, sel('input[placeholder="alias…"]'), "store"),
```

Les cibles (`node`, `text`, `sel`, `button`) sont cherchées dans l'éditeur au moment de jouer : une
cible introuvable est écrite dans le journal du rendu (`introuvable`) et le curseur reste en place.
Le cadrage (`camera`) agrandit l'éditeur ; les titres et le curseur restent à l'échelle de la vidéo.

## Réenregistrer le hub

À refaire quand l'éditeur ou l'API change, ou quand une scène ouvre un écran nouveau (le hub écrit
`inconnu <requête>` pour une lecture qu'il n'a pas).

1. Démarrer un serveur Paper avec le plugin (`./gradlew shadowJar -PwithEditor`), le module
   `demo/survival/` dans `plugins/Artisan/modules/`, et `web.tunnel: ""`, `web.pack-cdn: ""` dans
   `plugins/Artisan/environment.yml` pour que rien ne sorte de la machine.
2. Se connecter avec le lien de `artisan editor`, fermer la visite guidée, relever le cookie de session.
3. Mettre l'identifiant du serveur dans `src/demo.ts`, puis :

```bash
rm -rf fixtures/hub
HUB_RECORD=http://localhost:8765 HUB_COOKIE='<cookie>' npm run render
npm run render                 # sans HUB_RECORD : aucune ligne « inconnu » ne doit sortir
```

Les écritures (brouillons, préférences) ne partent jamais vers le vrai hub : le hub rejoué les
accepte lui-même.

## La scène de l'assistant

La conversation de l'assistant avance dans le temps : elle ne se rejoue pas comme une lecture.
`scripts/record-assistant.mjs` l'enregistre instant par instant dans `fixtures/assistant.json`, et le
hub rejoué la sert au pas que la scène lui donne (`POST /api/promo/assistant?step=n`) : ce que le
modèle écrit avance avec les images de la vidéo. Le brouillon écrit par l'assistant n'apparaît que
dans sa scène ; chaque lecture porte l'en-tête `x-promo-scene`.

Sans clé de fournisseur, `scripts/model.mjs` tient la place du modèle : une API Chat Completions
qui répond un déroulé écrit d'avance (`scripts/model-vip.yml` est le menu qu'il écrit). Le hub le
traite comme un vrai modèle : ses outils s'exécutent, le brouillon est écrit et contrôlé par le
serveur. Avec une vraie clé, il suffit de ne pas le lancer.

```bash
# plugins/Artisan/environment.yml :  ai: { provider: "openai", api-key: "local",
#                                          model: "…", base-url: "http://localhost:3902/v1" }
node scripts/model.mjs &
HUB_RECORD=http://localhost:8765 HUB_COOKIE='<cookie>' \
  node scripts/record-assistant.mjs <id du serveur> "Make me a VIP menu with three ranks"
```

À faire avant `npm run render` en enregistrement : la scène lit ensuite le brouillon créé.

## Règles

- Les transitions et animations CSS sont coupées (`styles.css`) : le mouvement vient des scènes.
- Une scène ne dépend pas de la précédente : tout ce qu'elle montre vient de son adresse et de son
  déroulé.
- Les textes de la vidéo suivent la page de vente (`artisanmc/website`, `listings/artisan.md`).
