# Artisan — Translations schema v1

Format des traductions d'un project Artisan. Une **clé** = un texte traduisible scoped au project, référencée depuis les menus et commandes via la syntaxe inline `{i18n:<key>}`.

## Vocabulaire

| Terme | Sens |
|---|---|
| **Clé i18n** | Identifiant slug hiérarchique (`menu.shop_main.btn_buy.title`). Stable, unique au sein du project. |
| **Translation** | Valeur d'une clé pour une langue donnée. Format **MiniMessage** (cf. plus bas). |
| **default_lang** | Langue de référence du project. Toute clé doit l'avoir. Fallback ultime si une autre langue manque. |
| **Project scope** | Les clés vivent au niveau project de l'admin, pas par menu. Pas de partage entre admins. |

## Fichiers

| Fichier | Rôle |
|---|---|
| `schema.json` | JSON Schema Draft 2020-12, source de vérité validable par machine |
| `types.ts` | Types TypeScript + helpers (validateTranslations, extractI18nRefs, generateAutoKey, ...) |
| `examples/minimal.json` | Project 2 langues (fr, en) avec 5 clés. |
| `examples/full-project.json` | Project 4 langues avec menu shop + commandes traduits. |

## Format de contenu : MiniMessage

Toutes les valeurs de traduction sont en **MiniMessage** (format texte de Adventure / Paper) :

```
<gold><bold>Boutique</bold></gold>
<gray>Achète ce <green>diamant</green> pour <yellow>%vault_eco_balance%</yellow> pièces</gray>
```

Ressources :
- Documentation officielle : https://docs.advntr.dev/minimessage/format.html
- Tester : https://webui.advntr.dev/

Les **codes legacy** (`§a`, `&a`) sont **acceptés en input** pour l'admin qui colle un texte d'un autre plugin, mais sont **convertis en MiniMessage au save** (canonicalisation backend, opt-out possible dans les settings project).

## Référence depuis menus / commandes

Tout champ texte d'un menu (`title`, `lore[]`, `send_message.text`, `broadcast.text`, `cooldown.message`, etc.) ou d'une commande (`description`, `cooldown.message`, etc.) peut contenir des références `{i18n:key}` mélangées librement avec du texte statique, des codes MiniMessage, et des placeholders PAPI.

```json
{
  "title": "{i18n:menu.shop_main.title}",
  "lore": [
    "{i18n:menu.shop_main.btn_buy.lore.0}",
    "<gray>Prix : <yellow>%vault_eco_balance%</yellow> pièces</gray>"
  ]
}
```

### Mode `inline` : le littéral EST la référence (depuis 2026-08-03)

Un projet peut aussi s'écrire sans aucune référence : le champ porte le **texte littéral de la langue par défaut**, et les autres langues vivent dans `lang/<code>.yaml` à l'**adresse canonique** du champ — l'adresse que le plugin redérive de la structure du fichier (`menus.shop.elements.buy.default.title`, `commands.give.message`, `dialogs.confirm.buttons.ok.label`…). Il n'y a alors pas de fichier pour la langue par défaut : le document la porte déjà.

```yaml
# menus/shop.yaml (mode inline)          # lang/fr.yaml
title: Shop                              menus:
elements:                                  shop:
  - id: buy                                  title: Boutique
    title: Sword                             elements:
    click: { left: send_message "Bought!" }    buy:
                                                 default:
                                                   title: Épée
                                                   click: { left: { message: Acheté ! } }
```

Les deux formes se lisent indifféremment, y compris mélangées dans un même fichier. Le choix est un mode de projet (`.artisan/editor.yaml` → `i18n_mode`), pas une propriété de champ. Le schéma d'adressage est verrouillé cross-langage par `testdata/i18n-address-conformance.json`. Cf. ADR `files-first-source-of-truth` §4.

## Ordre de résolution à l'exécution

Côté plugin Minecraft, quand un menu s'ouvre ou qu'une commande s'exécute, chaque champ texte est résolu dans cet ordre :

1. **i18n** : `{i18n:key}` → valeur stockée pour la langue active du joueur. À défaut de référence explicite, le **littéral est cherché à l'adresse canonique** de son champ (mode `inline`) ; s'il n'y a rien, il vaut tel qu'écrit. Fallback `default_lang` si manquante. Fallback texte vide + log warning si manquante en default aussi.
2. **PlaceholderAPI** : `%player_name%`, `%vault_eco_balance%`, `%args_target%`, etc. → résolus via PAPI avec le contexte joueur courant.
3. **MiniMessage parse** : tags `<color>`, `<bold>`, `<gradient>`, etc. → Component Adventure final envoyé au client.

Conséquence : une **traduction peut elle-même contenir** des placeholders et des tags MiniMessage. Très flexible.

```
Clé "menu.shop.welcome" en FR : "<green>Bienvenue, %player_name% !</green>"
                       en EN : "<green>Welcome, %player_name%!</green>"
```

## Détermination de la langue active du joueur

Trois modes configurables côté plugin (`config.yml`) :

| Mode | Comportement |
|---|---|
| `server_default` | Tout le serveur parle une langue unique (la default_lang du project, ou override config). |
| `per_player_locale` *(recommandé)* | Langue dérivée de `Player#locale()` (locale Minecraft client). Mappée vers la langue project la plus proche, fallback default. |
| `per_player_placeholder` | Langue dérivée d'un placeholder PAPI custom (ex: `%player_lang%` si l'admin a déjà une commande `/lang` via un autre plugin). |

Le plugin charge toutes les traductions en mémoire au sync (les fichiers `i18n/<lang>.json` du bundle runtime).

## Format des fichiers générés (côté bundle)

À chaque sync, le bundle runtime téléchargé par le plugin contient un sous-dossier `i18n/` :

```
bundle.zip
├── menus/
├── commands/
├── assets/
└── i18n/
    ├── fr.json         ← langue par langue, format plat
    ├── en.json
    └── de.json
```

Format de chaque fichier (lookup O(1) côté plugin) :

```json
{
  "menu.shop_main.title": "<gold><bold>Boutique</bold></gold>",
  "menu.shop_main.btn_buy.title": "<green>Acheter</green>",
  "menu.shop_main.btn_buy.lore.0": "<gray>Achète cet item</gray>"
}
```

Notes :
- On n'utilise **pas** le système `translatable_key` vanilla Minecraft (qui passerait par les `lang/<locale>.json` du resource pack côté client). Notre approche serveur-side est plus flexible : on choisit la langue, on compose avec PAPI, on log les clés manquantes.
- Le bundle inclut **toutes** les clés du project, même celles non référencées par les menus actifs sur ce serveur. Coût de stockage négligeable, simplicité de génération.

## UX éditeur

Sur tout champ texte du dashboard (titre menu, lore d'un Element, send_message text, command description, etc.) :

1. **Tape librement** : pas besoin d'utiliser i18n si tu ne veux pas. Le texte direct fonctionne (rendu littéral pour tous les joueurs).
2. **Insère une clé** : touche `{` déclenche l'autocomplete fuzzy sur les clés du project. Sélection → insertion `{i18n:key}` au curseur. Bouton `</>` à droite ouvre une popover avec recherche + bouton "+ Nouvelle clé".
3. **Crée une nouvelle clé inline** : "+ Nouvelle clé" extrait automatiquement le texte en cours dans le champ comme valeur par défaut (langue de référence), pré-remplit la clé avec un slug auto-généré basé sur le contexte (`menu.<menu_id>.<element_id>.title`), et permet d'éditer la clé (avec validation d'unicité live).
4. **Édite une traduction existante** : click sur la clé surlignée dans le champ → mini-modal avec les valeurs par langue et un live preview MiniMessage à côté.
5. **Détache une clé** : remplace `{i18n:key}` par la valeur courante en clair. La clé reste dans le project pour les autres usages.

## Auto-extract du texte existant

Workflow le plus naturel : tu tapes "Boutique" dans le champ titre, tu cliques "+ Nouvelle clé", l'éditeur :

1. Crée la clé `menu.shop_main.title` avec valeur FR = `"Boutique"`.
2. Remplace le contenu du champ par `{i18n:menu.shop_main.title}`.
3. Ouvre le mini-modal pour ajouter d'autres langues (optionnel).

Aucune manipulation manuelle du fichier translations.

## Conflits à l'import de pack `.itfz`

Quand un pack importé contient un fichier `translations.json`, l'import merge dans le project cible :

- **Clé absente** localement → ajoutée.
- **Clé présente, valeurs identiques** dans toutes les langues → ignorée (no-op).
- **Clé présente, valeur différente dans au moins une langue** → conflit. L'admin choisit dans un dialog :
  1. *Garder local* : l'import skippe cette clé. Les menus importés référencent la valeur locale (peut être surprenant si elle est sémantiquement différente).
  2. *Écraser avec l'import* : la valeur locale est remplacée. Toutes les références existantes hors du pack importé voient le nouveau texte.
  3. *Renommer la clé importée* : auto-prefix avec le `pack.id` (`questx.menu.shop_main.title`). Les menus du pack sont rewrités à l'import pour pointer vers la nouvelle clé.

L'option par défaut est **renommer** — la moins destructive.

## Validation

Au save dans le project, le backend vérifie via `validateTranslations` :

- `default_lang` est dans `languages[]`.
- Chaque clé a au minimum la `default_lang`.
- Les codes de langue respectent BCP-47-light (`fr`, `en_US`, etc.).
- Les clés respectent le slug hiérarchique (`^[a-z][a-z0-9_]*(\.[a-z0-9_]+)*$`).
- Aucune valeur n'est vide (warning, pas erreur).

Limitations connues (non-exprimables en JSON Schema mais à check au load/build) :

- Les clés référencées par les menus/commandes du project doivent toutes exister dans `keys`. Sinon warning éditeur ("Clé `menu.foo.title` référencée par btn_buy mais non définie").
- Les références circulaires (clé A pointe vers clé B qui pointe vers clé A) doivent être détectées. Limite de profondeur de résolution = 10 par sécurité.

## Comment l'utiliser

### Côté éditeur (TypeScript)

```ts
import type { Translations, TranslationKey } from "./schema/translations/v1/types";
import {
  validateTranslations,
  extractI18nRefs,
  extractI18nRefsDeep,
  generateAutoKey,
  generateUniqueKey,
  completionPercent,
} from "./schema/translations/v1/types";
import schema from "./schema/translations/v1/schema.json";
```

### Côté plugin (Java)

Codegen des types depuis `schema.json` (jsonschema2pojo) ou parsing manuel léger (le format est plat). Au sync, le plugin parse chaque `i18n/<lang>.json` et le stocke dans une `Map<String, Map<String, String>>` (key → lang → minimessage). Au moment du rendu d'un menu, résoud `{i18n:...}` puis PAPI puis MiniMessage en chaîne.

### Validation locale

```bash
node validate-translations.mjs
```

## Roadmap

| Version | Capacité |
|---|---|
| V1 MVP | Format plat, fr + en, 3 modes de détection langue côté plugin, UX inline dans l'éditeur, conflits à l'import géré. |
| V1.5 | Statistiques de complétion par langue dans le dashboard. Bouton "exporter en .po/.csv pour traducteur externe". Detection auto des clés non utilisées. |
| V2 | Pluralisation (`<plural:count:zero=...:one=...:other=...>`). Variables typées dans les clés (déclarées par clé, pour plus de sécurité). Glossaire project (forcer un terme cohérent : "Boutique" toujours utilisé pour "Shop" en FR). |
| V3 | Marketplace de packs i18n (un créateur peut vendre un set de traductions pour des packs populaires). |
