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
- `gifts_token` : marqueur visible `#proto#`, en secours si le premier ne survit pas à MiniMessage ou Geyser.

Disposition : cadeaux (icône custom) en slots 10-16, bouton CLAIM dessiné sur les slots 30-32
(item de clic transparent), X en slot 8, tête de Notch en slot 49. Chaque bouton envoie un message
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
dessine lui-même les cases utiles.

Itérer : modifier `generate.py`, relancer `--install`, `docker compose restart minecraft`, se reconnecter
(le client Bedrock ne recharge un pack qu'à la connexion).

## Variantes du pack

`generate.py --variant mod` (défaut) n'ajoute qu'une image à l'écran de coffre vanilla, par une
`modification` JSON UI : si elle est fausse, le coffre vanilla reste utilisable et l'erreur part dans le
journal de contenu. `--variant full` remplace tout `chest_screen.json` (titre masqué, mise en page
classique forcée sur mobile) : c'est la première version, qui donnait un écran vide.

La version du pack suit son contenu, donc un client Bedrock retélécharge le pack dès qu'il change.

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
6. CLAIM : un tap/clic n'importe où sur le bouton déclenche-t-il `claim: left` ?
7. Clic droit (PC) et appui long (mobile) : quel message arrive ? `right`, `left`, rien ?
8. Shift-clic (PC) : quel message arrive ?
9. La tête de Notch : skin correct, tête Steve, ou autre ?
10. Les mêmes points sur mobile, si possible (mise en page forcée en classique).

Une capture par plateforme suffit à trancher la plupart des points.
