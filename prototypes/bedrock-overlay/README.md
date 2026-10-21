# Prototype : menu texturé sur Bedrock (overlay Geyser)

Jetable. Sert à vérifier en jeu la technique de NxMenu avant de décider d'un générateur de pack
Bedrock dans le hub. Analyse complète : `architecture/support-bedrock-menus.md` (dossier partagé du
projet), sections 2.4, 2.5 et 0ter.

## Principe testé

- Le menu reste un vrai coffre, traduit par Geyser.
- Un pack Bedrock (servi par Geyser) remplace `ui/chest_screen.json` : quand le titre contient un
  marqueur, il pose `textures/artisan/proto_background.png` sous la grille et masque le titre vanilla.
  Avec le marqueur, mobile et console reçoivent aussi la mise en page « classique », pour que le fond
  s'aligne sur les mêmes slots partout.
- Des mappings Geyser (`custom_mappings/artisan_proto.json`) traduisent deux `item_model` Java :
  `artisan:buttons/hit_area` (l'item qu'Artisan pose déjà sous les image buttons) en icône
  transparente, et `artisan:proto/gift` en icône de cadeau.

Côté Java, rien n'est stylé : les items portent des `item_model` sans pack Java, ils s'affichent donc
en texture manquante. Normal, seul Bedrock est testé ici.

## Contenu

| Fichier | Rôle |
|---|---|
| `generate.py` | Génère tout dans `build/` (stdlib Python uniquement) ; `--install` copie dans `docker/server/plugins`. |
| `compose.bedrock.yml` | Ajoute Geyser + Floodgate et le port UDP 19132 au serveur local. |

Le projet de test `bedrock_proto` a deux menus de 6 lignes, identiques sauf le marqueur du titre :

- `gifts` : marqueur invisible U+F8FF, un caractère privé que le pack dessine vide sur Bedrock
  (`font/glyph_F8.png`). Une séquence `§1§2§3§r` ne survivait pas à Geyser (test du 2026-10-21) ;
  `gifts` masque aussi toute la partie basse (inventaire du joueur, barre rapide, panneau gris),
  l'équivalent Bedrock de la texture transparente Java (`replace` sur `large_chest_panel/root_panel`) ;
- `gifts_token` : marqueur visible `#proto#`, partie basse gardée pour comparer, en secours si le premier ne survit pas à MiniMessage ou Geyser.

Disposition : cadeaux (icône custom) en slots 10-16, X dessiné par le fond en slot 8 (item de clic
transparent), tête de Notch en slot 49. CLAIM (slots 30-32) teste les tuiles : l'image est découpée
en trois textures 18×18, une par slot, chacune portée par un item custom (`artisan:proto/claim_0..2`).
Avec un marqueur, la grille de slots est remplacée par une copie sans case grise dont l'icône occupe
les 18×18 px de la case, pour que les tuiles se joignent sans couture. Chaque bouton envoie un message
par type de clic (`left`, `right`, `shift_left`).

## Lancer

```bash
docker compose -f docker-compose.yml -f prototypes/bedrock-overlay/compose.bedrock.yml up -d
# attendre le premier démarrage complet (Geyser crée plugins/Geyser-Spigot/)
python3 prototypes/bedrock-overlay/generate.py --install
docker compose restart minecraft
```

Vérifier dans `docker/server/plugins/Geyser-Spigot/config.yml` que `enable-custom-content` vaut `true`.
Rejoindre avec un client Bedrock sur l'IP de la machine, port 19132, accepter le pack du serveur,
puis `/artisan menu bedrock_proto:gifts` et `/artisan menu bedrock_proto:gifts_token`.

Avec un marqueur, le pack masque aussi le titre vanilla et les cases grises de chaque slot : le fond
dessine lui-même les cases utiles. Ni la redéfinition de `chest_label`/`chest_grid_item` ni un `replace`
dans `large_chest_panel_top_half` n'avaient d'effet en jeu : le fond est donc posé **au-dessus** de tout
le panneau vanilla (il recouvre titre et cases grises), et une seconde grille de slots, branchée sur la
même collection, est posée au-dessus du fond pour dessiner les items et recevoir les clics.

Itérer : modifier `generate.py`, relancer `--install`, `docker compose restart minecraft`, se reconnecter
(le client Bedrock ne recharge un pack qu'à la connexion).

## Variantes du pack

`generate.py --variant mod` (défaut) n'ajoute qu'une image à l'écran de coffre vanilla, par une
`modification` JSON UI : si elle est fausse, le coffre vanilla reste utilisable et l'erreur part dans le
journal de contenu. `--variant full` remplace tout `chest_screen.json` (titre masqué, mise en page
classique forcée sur mobile) : c'est la première version, qui donnait un écran vide.

La version du pack suit son contenu, donc un client Bedrock retélécharge le pack dès qu'il change.

## v2 : le même menu comme projet Artisan normal

Depuis le générateur de pack Bedrock d'Artisan (`editor/src/lib/pack/bedrock/`), le prototype n'a plus
besoin de son pack à la main : `generate.py --v2 --install` écrit `projects/bedrock_proto` avec
`assets/glyphs/{frame,claim,x}.png` (+ descripteurs) et un menu `gifts` ordinaire
(`vanilla_texture: false`, fond en couche `background`, texte `Bonjour {player.name}`, CLAIM et X en
boutons image), **et retire le pack et le mapping du prototype** (`--uninstall` seul fait juste ça) :
Artisan enregistre lui-même `artisan:hit_area` et son pack auprès de Geyser. Les packs Java et Bedrock
sont ensuite construits par l'éditeur à la publication du projet.

## Si l'écran est vide ou le fond absent

Activer le journal de contenu du client : Paramètres > Créateur > « Interface du journal de contenu »
(Content Log GUI) et « Fichier journal de contenu ». Les erreurs JSON UI s'affichent en jeu à l'ouverture
du menu ; une capture de ces lignes suffit à corriger.

## Ce qu'il faut noter (une ligne par question)

1. Le fond apparaît-il ? Avec `gifts`, avec `gifts_token`, ou aucun ?
2. Le titre vanilla est-il masqué ? Le marqueur `§…` est-il visible quelque part ?
3. Les items (cadeaux, tête) sont-ils dessinés **au-dessus** du fond ? (sinon : couche `layer` à revoir)
4. Les cadres de slots Bedrock se voient-ils par-dessus le fond, notamment sur CLAIM ?
5. L'alignement : les cadeaux tombent-ils dans les cases dessinées ? Décalage en pixels si non.
6. CLAIM : les trois tuiles forment-elles une image continue (coutures, flou) ? Un tap/clic sur
   chacune déclenche-t-il `claim: left` ? Et le X du fond (`close`) ferme-t-il le menu ?
7. Clic droit (PC) et appui long (mobile) : quel message arrive ? `right`, `left`, rien ?
8. Shift-clic (PC) : quel message arrive ?
9. La tête de Notch : skin correct, tête Steve, ou autre ?
10. Les mêmes points sur mobile, si possible (mise en page forcée en classique).

Une capture par plateforme suffit à trancher la plupart des points.
