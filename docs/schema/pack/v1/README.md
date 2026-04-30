# Interfaze — Pack schema v1

Format d'un **pack** Interfaze : unité d'organisation dans le workspace de l'admin, et format d'export/import partageable. Une archive `.itfz` (zip) avec un manifeste à la racine + menus + templates + commandes + translations + assets référencés.

## Vocabulaire à ne pas confondre

| Terme | Sens |
|---|---|
| **Pack** | Unité d'organisation dans le workspace (ex. "mon Shop System", "Daily Quests acheté"). Aussi : format d'export partageable .itfz. |
| **Bundle** | Artefact runtime signé (config + resource pack) que le plugin télécharge depuis le CDN. Opaque pour l'admin. |
| **Menu** | Une entité ouvrable via `/menu open`. Vit à l'intérieur d'un pack. |
| **Command** | Une commande custom enregistrée par Interfaze. Vit à l'intérieur d'un pack, au même niveau qu'un menu. |
| **Template** | Composant nommé réutilisable (façon Symbol Figma). Peut vivre dans un pack ou globalement. |
| **Asset** | Image custom uploadée. Peut vivre dans un pack ou globalement. |
| **Translation** | Clé i18n + valeurs par langue. Scoped au workspace mais embarquable dans un pack à l'export (sous-set des clés référencées). |

## Fichiers

| Fichier | Rôle |
|---|---|
| `schema.json` | JSON Schema Draft 2020-12 du manifeste, validable par machine |
| `types.ts` | Types TypeScript pour l'éditeur et le futur MCP |
| `example-manifest.json` | Exemple de manifeste valide |

## Layout de l'archive .itfz

```
manifest.json          ← obligatoire, à la racine
menus/
  shop_main.json       ← un fichier par menu listé dans manifest.menus
  shop_premium.json
templates/
  bouton_acheter.json  ← un fichier par template listé dans manifest.templates
commands/
  shop_open.json       ← un fichier par commande listée dans manifest.commands
translations.json      ← optionnel, conforme à translations/v1, sous-set des clés référencées
assets/
  shop_bg.png          ← un fichier par asset listé dans manifest.assets
  rank_vip_button.png
preview.png            ← optionnel, si manifest.preview_image est présent
README.md              ← optionnel, pour les humains qui ouvrent le zip
```

L'archive est un .zip standard avec extension renommée en .itfz pour reconnaissance (mime-type `application/x-interfaze-pack`).

## Workspace : comment les packs vivent côté admin

Dans le dashboard, l'admin voit ses packs comme des sections collapsables :

- **📦 Personal** (auto-créé, `is_default: true`) — pack utilitaire où atterrit tout ce qui n'est pas explicitement assigné.
- **📦 Shop System** (`source: user_created`) — créé manuellement pour grouper son shop principal + les sous-shops + les templates de boutons d'achat + les commandes `/shop`, `/buy` + les assets shop.
- **📦 Daily Quests** (`source: imported`, `source_pack_id: creator-x/daily-quests`, version 2.1.0) — acheté/téléchargé.
- **📦 MCModels Medieval** (`source: imported`) — importé d'un .zip MCModels via l'importer V1.5.

## Modèle d'import : overwrite

À la réimport d'un pack qui existe déjà dans le workspace (matché par `source_pack_id`), **on remplace tout son contenu en bloc**. Pas de migration intelligente, pas de three-way merge. Les modifs locales sont perdues.

L'admin voit un dialog d'avertissement : *"Ce pack vient de [source]. Le réimport va remplacer son contenu (X menus, Y commandes, Z templates, W traductions, V assets). Pour customiser durablement, utilise plutôt 'Fork' avant de modifier."*

## Modèle de fork

Sur un pack `imported`, le bouton "Fork" duplique le contenu vers un nouveau pack `forked` qui est traité comme `user_created` à toutes fins pratiques : éditable librement, plus jamais écrasé par un réimport. Un pointer `source_pack_id` est conservé en métadonnée pour la traçabilité, mais aucun lien d'upgrade.

Pattern standard (Steam Workshop, Notion templates, Figma communauté). Compris des utilisateurs sans documentation.

## Conflits à l'import

Quand on importe, on détecte cinq classes de conflits :

**1. Conflit d'id de pack.** Un pack avec ce `manifest.id` existe déjà :
- Si même `source_pack_id` (réimport) → overwrite après confirmation.
- Si différent (ou null = pack user-créé localement) → l'admin choisit : renommer le pack importé, ou skip.

**2. Conflit d'id de menu.** Un menu avec un id du pack importé existe déjà ailleurs (rappel : les menus ont un namespace global au sein d'un serveur, pour permettre `/menu open shop_main`) :
- Dialog : "Le pack contient un menu `shop_main` qui existe déjà dans ton pack X. Renommer en `shop_main_2` ? Skip ce menu ?"

**3. Conflit de nom de commande.** Une commande importée a un `name` ou un `alias` qui existe déjà sur le serveur cible (autre commande Interfaze, vanilla, ou plugin tiers) :
- Warning visible mais pas bloquant à l'import. Au publish, l'admin doit renommer ou désactiver la commande conflictuelle.

**4. Conflit de clés i18n.** Une clé du pack existe déjà dans le workspace cible mais avec une valeur différente :
- Dialog avec 3 options : *Garder local* (skip la clé importée, peut être surprenant si sémantiquement différent), *Écraser avec l'import* (la valeur locale est remplacée pour tous les usages), *Renommer la clé importée* (auto-prefix avec `pack.id`, les menus/commandes du pack sont rewrités à l'import). Default = renommer.

**5. Plugins requis manquants.** L'admin n'a pas LuckPerms installé mais le pack le requiert :
- Warning visible mais pas bloquant ; les menus et commandes concernés sont importés en draft mais grisés (dégradation gracieuse, comme sec. 12.6 du main-spec).

## Cross-pack references — soft boundary

Un menu dans pack A peut référencer un template défini dans pack B sans erreur. L'éditeur affiche un warning *à l'export* du pack A : "Ce pack référence le template `bouton_acheter` qui vit dans le pack B. Inclure pack B dans l'archive ?". Si oui, B est embarqué ; sinon, l'export note la dépendance externe et l'import alerte si B est absent du workspace cible.

Pareil pour une commande dans pack A qui ouvre un menu vivant dans pack B : warning à l'export, possibilité d'embarquer B ou de le déclarer en dépendance externe.

Pour les **clés i18n**, c'est plus simple : à l'export du pack, on calcule récursivement l'union des clés référencées (`extractI18nRefsDeep`) sur les menus + commandes du pack et on embarque ce sous-set, peu importe leur "appartenance" conceptuelle (les clés vivent au workspace, pas par pack).

C'est plus permissif que des modules stricts et c'est ce que veulent les admins en pratique.

## Champs du manifeste

Le manifeste suit le schéma `pack/v1` (voir `schema.json`). Champs notables :

- **`id`** : slug stable. Pour V1 (pas encore de marketplace), unique par auteur. Pour V3 marketplace, l'id complet sera namespacé `auteur/pack-id`.
- **`version`** : semver (`X.Y.Z`). Bump à chaque export pour permettre la détection d'updates.
- **`requires_plugins`** : calculé automatiquement à l'export depuis l'union des `menu.metadata.uses_plugins` et `command.metadata.uses_plugins`.
- **`menus`/`templates`/`commands`/`assets`** : listes des ids/chemins inclus. L'import vérifie que chaque fichier référencé est présent dans l'archive.
- **`translations`** : objet meta décrivant les traductions embarquées (`file`, `key_count`, `languages`). Calculé à l'export.
- **`preview_image`** : pour la marketplace V3 ; optionnel.
- **`license`** : SPDX identifier conseillé. Important pour le marketplace pour clarifier les usages dérivés (revente, modification, etc.).

## Validation à l'import

Le backend doit vérifier, dans cet ordre :

1. Le manifeste parse et matche `pack/v1`.
2. Tous les fichiers listés (`menus`, `templates`, `commands`, `assets`, `translations.file`) existent dans l'archive.
3. Chaque menu parse contre `menu/v1` et passe `validateMenuLayout` (voir menu/v1/types.ts).
4. Chaque template parse contre `template/v1` (à formaliser).
5. Chaque commande parse contre `command/v1` et passe `validateCommand` (voir command/v1/types.ts). Les `name`/`aliases` sont vérifiés pour conflits avec les commandes registered du serveur cible (warning, pas bloquant à l'import — l'admin résout au publish).
6. Le fichier translations parse contre `translations/v1` et passe `validateTranslations`. Les conflits de clés sont remontés au dialog d'import (cf. plus haut).
7. Les assets sont des PNG valides (magic bytes), taille raisonnable, dimensions cohérentes.
8. Pas de path traversal (`../`) dans les chemins d'assets.
9. Les plugins requis sont installés sur le serveur cible (warning sinon).

## Limitations connues

**Pas de signature en V1.** Les packs ne sont pas signés cryptographiquement. Un pack importé pourrait théoriquement avoir été modifié en transit. Acceptable au MVP. La signature ECDSA (cohérente avec les bundles runtime) arrive en V3 marketplace.

**Pas de cross-pack assets globaux.** Au V1, chaque asset vit dans un seul pack. Pour le partager, on copie. Plus tard (V1.5+) on pourra avoir des assets "user-global" hors de tout pack.

**Pas de migrations entre versions de schéma.** Si un pack est en `pack/v1` et qu'on passe à `pack/v2`, le V1 n'est plus importable directement — il faudra écrire une migration explicite (ou re-exporter depuis l'éditeur d'un user qui a une version récente).

**Variables env-specific (permissions, currencies, world names).** Pas résolues au schéma — l'admin importe et adapte à la main, ou utilise le wizard "find & replace" V1.5.

## Roadmap

| Version | Capacité |
|---|---|
| V1 MVP | Workspace organisé en packs (Personal + user-créés). Menus + commandes + translations en première classe. Export/Import d'un menu seul (.menu.json) ou d'une commande seule (.cmd.json) — pas encore de pack export. |
| V1.5 | Export/Import d'un pack complet (.itfz) avec menus + commandes + templates + translations + assets. Wizard find-&-replace pour les valeurs env-specific. Importer MCModels. |
| V3 | Marketplace native : signature, pricing, reviews, discovery. |
