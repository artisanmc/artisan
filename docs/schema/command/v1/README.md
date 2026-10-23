# Artisan — Command schema v1

Format intermédiaire d'une commande Artisan. Une commande est une **entité de premier ordre** dans le workspace, au même niveau qu'un Menu : elle a son id, ses notes, sa permission, et vit dans le même pack `.itfz`.

## Fichiers

| Fichier | Rôle |
|---|---|
| `schema.json` | JSON Schema (Draft 2020-12), source de vérité validable par machine |
| `types.ts` | Types TypeScript pour l'éditeur et le futur MCP server |
| `examples/simple-heal.json` | Commande sans menu, sans argument — actions directes. |
| `examples/profile-with-target.json` | Commande à 1 argument optionnel qui ouvre un menu avec contexte. |
| `examples/pay-player.json` | Commande à 2 arguments required avec requirements + fallback + cooldown. |
| `examples/auction-house-subcommands.json` | Commande à sous-commandes (alias, permission, arguments et cooldown par nœud, nœud sans actions, nœud désactivé), description multilingue. |

## Pourquoi des commandes côté Artisan

Tous les plugins de menus existants (DeluxeMenus, zMenu) bindent `/menu open <name>` ou des commandes triviales. Artisan va plus loin : la commande est un objet de design à part entière, avec ses arguments typés, ses requirements, son cooldown, et son contexte propagé au menu. Cela couvre 80 % des `/profile`, `/shop`, `/heal`, `/pay`, `/warps` qu'un admin tape autrement à la main dans `commands.yml` ou via un plugin séparé.

## Modèle conceptuel

```
Command
 ├── meta (schema, id, name, aliases, permission, description, notes)
 ├── arguments : Argument[]      ← positionnels, ordonnés (required d'abord)
 ├── requirements : Condition[]  ← ANDées, évaluées avant actions
 ├── actions : Action[]          ← réutilisées depuis menu/v1
 ├── fallback : Action[]         ← si requirements échouent
 └── cooldown ?                   ← scope player ou server
```

## Réutilisation depuis menu/v1

Les `Action`, `Condition` et `Cooldown` sont **les mêmes objets** que dans `menu/v1`, référencés par `$ref` absolu :

```json
"actions": {
  "items": { "$ref": "https://docs.artisanmc.net/schema/menu/v1.json#/$defs/Action" }
}
```

Conséquences pratiques :

- Un admin qui sait écrire un click handler de bouton sait écrire une commande.
- Quand on ajoute une nouvelle action au catalogue (ex: `set_block`), elle est dispo des deux côtés gratuitement.
- Côté ajv : il faut charger les deux schémas avant de compiler (cf. snippet plus bas).

## Arguments et types

8 types d'arguments en V1 :

| Type | Parser | Tab-completion |
|---|---|---|
| `player` | nom → résolu en UUID, online ou offline | online + connus du serveur |
| `online_player` | nom → joueur connecté requis | online uniquement |
| `string` | brut | aucune |
| `integer` | nombre entier | aucune |
| `number` | nombre flottant | aucune |
| `boolean` | `true` / `false` / `1` / `0` | `true`, `false` |
| `world` | nom du monde chargé | mondes chargés |
| `enum` | valeur dans `values[]` | valeurs de `values[]` |

Règle : les arguments `required` doivent précéder les optionnels dans la liste. Les optionnels peuvent avoir un `default` qui supporte les placeholders (ex: `"%player_name%"` pour cibler l'auteur de la commande quand l'argument est omis).

## Contexte et placeholders

Quand la commande s'exécute, les arguments sont parsés selon leur type. Échec de parse → erreur typée envoyée au joueur (`§cJoueur introuvable: Bob`), commande non exécutée.

Les valeurs résolues sont exposées comme **placeholders** sous deux formes :

- `%args_<name>%` → valeur primaire (string représentation : nom du joueur, monde, valeur enum, nombre)
- `%args_<name>_<champ>%` → champs dérivés sur les types complexes

Champs dérivés actuels (V1) :

| Type | Champs dérivés |
|---|---|
| `player` / `online_player` | `_uuid`, `_displayname` |

Ces placeholders sont enregistrés **dynamiquement** dans le moteur de placeholders (PlaceholderAPI) au moment où le menu s'ouvre depuis la commande, et nettoyés à la fermeture. Ils coexistent avec les placeholders standards (`%player_name%`, `%world%`, etc.).

Exemple concret avec `profile-with-target.json` :

```
/profile Notch
   ↓
args.target = Player(uuid=069a79f4-..., name=Notch)
   ↓
open_menu profile_menu (avec contexte {target: ...})
   ↓
Menu profile_menu : %args_target% → "Notch"
                    %args_target_uuid% → "069a79f4-..."
                    %args_target_displayname% → "§eNotch"
```

## Sous-commandes

`subcommands` est une liste de nœuds, récursive, chacun avec les champs d'une commande :
`name` (obligatoire), `aliases`, `permission`, `description`, `enabled`, `arguments`,
`requirements`, `actions`, `fallback`, `cooldown`, `subcommands`.

```
/ah sell 100        → nœud sell, arguments [100]
/ah vendre 100      → même nœud, par alias
/ah admin           → nœud sans actions : usage « /ah admin (reload) »
/ah 42              → aucun nœud ne s'appelle « 42 » : arguments de la racine
```

- Les premiers mots choisissent le nœud, par nom ou alias, aussi profond qu'ils correspondent ;
  le reste est passé aux arguments de ce nœud.
- La permission de chaque nœud du chemin est vérifiée : une sous-commande n'élargit jamais
  l'accès donné par son parent.
- Un nœud sans `actions` mais avec des enfants affiche l'usage de ses enfants autorisés.
- `enabled: false` retire le nœud (et ses enfants) ; son nom retombe sur les arguments du parent.
  Sur la racine, la commande n'est pas enregistrée.
- Un `cooldown` sans `id` prend le chemin de la commande (`ah`, `ah sell`) : deux commandes ne
  partagent plus un cooldown par accident.
- La complétion propose les sous-commandes autorisées puis les arguments du nœud.

`description` (racine et nœuds) est une chaîne pour toutes les langues ou une table
`{langue: texte}`.

Un jar Artisan antérieur ignore `subcommands` et `enabled` : la racine reste utilisable, les
sous-commandes disparaissent.

## Propagation du contexte

Une `open_menu` action propage le contexte d'arguments au menu cible **par défaut**. Si ce menu chaîne une autre `open_menu`, le contexte est propagé à nouveau. Pour le couper :

```json
{ "type": "open_menu", "menu_id": "main_menu", "clear_context": true }
```

Cas typique du `clear_context: true` : un bouton "Retour à l'accueil" depuis le menu profile, qui ne doit pas hériter du target.

## Format des champs texte

Comme pour les menus, tous les champs texte d'une commande (`description`, `cooldown.message`, `send_message.text`, `broadcast.text`, etc.) suivent la convention unifiée :

- **MiniMessage** pour le formatage (`<color>`, `<bold>`, `<gradient>`, …).
- **Référence i18n inline** : `{i18n:command.profile.description}` résolu depuis le fichier translations du workspace (cf. `translations/v1`).
- **Placeholders PAPI** : `%player_name%` standard, plus les `%args_<name>%` injectés par les arguments de la commande elle-même.
- **Codes legacy `§a`** acceptés en input, convertis en MiniMessage au save.

Ordre de résolution côté plugin : (1) `{i18n:...}` → valeur stockée pour la langue active du joueur exécutant, (2) `%placeholder%` (PAPI standard + `%args_*%`), (3) parse MiniMessage final.

Une `description` peut donc être totalement i18n (`{i18n:command.profile.description}`) et chaque traduction peut elle-même contenir des placeholders et tags MiniMessage. Très flexible pour des commandes multilingues sans gymnastique.

## Conflits avec commandes existantes

Au démarrage du plugin, Artisan détecte les conflits avec les commandes déjà enregistrées (commandes vanilla, autres plugins). Politique en V1 :

- **Commande vanilla** (`heal`, `tp`, etc. natives) : Artisan refuse d'enregistrer, log un warning, demande à l'admin de renommer ou de définir un alias en config serveur.
- **Commande d'un autre plugin** : pareil, refus + warning. Pas d'override silencieux.
- **Conflit interne entre deux commandes Artisan** (même name dans deux packs activés) : le pack chargé en dernier perd, log un warning visible.

## Pricing

Les commandes **n'ont pas de quota** — illimitées tant que le serveur est dans la limite payée (free tier 1 serveur, paid tiers selon le plan). Une commande coûte ~rien en stockage (1 KB JSON) et ~rien en runtime (pas de rendu, pas de WS). Les quotas sont sur les serveurs et les seats d'équipe (cf. `main-spec.md` section 3).

## Limitations connues (cross-field non-exprimables en JSON Schema)

À valider au load par `validateCommand` (cf. `types.ts`) :

- Noms d'arguments uniques au sein d'une commande
- Required précèdent les optionnels
- Argument `enum` a un `values` non vide (couvert partiellement par `if/then` dans schema.json mais double-check)
- Aliases ne contiennent pas le name principal
- `default` ignoré sur arguments required (warning, pas erreur)

À valider au moment du publish/registry :

- Pas de conflit de `name`/`alias` avec les commandes registered du serveur cible
- Si une action référence un `menu_id`, ce menu existe dans le pack ou le workspace

## Comment l'utiliser

### Côté éditeur (TypeScript)

```ts
import type { Command, Argument } from "./schema/command/v1/types";
import { validateCommand, placeholdersFromCommand } from "./schema/command/v1/types";
import schema from "./schema/command/v1/schema.json";
import menuSchema from "./schema/menu/v1/schema.json";
```

### Validation locale

```bash
npm install ajv ajv-formats
node validate-cmd.mjs
```

```js
import Ajv from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

const ajv = new Ajv({ strict: false, allErrors: true });
addFormats.default(ajv);
ajv.addSchema(menuSchema);  // requis pour résoudre les $ref vers menu/v1
const validate = ajv.compile(commandSchema);
validate(myCommand);
```

### Côté plugin (Java)

Codegen depuis `schema.json` avec `jsonschema2pojo` (en plus du codegen `menu/v1`). Au load d'une commande, valider contre le schéma puis enregistrer dynamiquement la commande Bukkit/Brigadier avec les arguments typés convertis en arguments Brigadier.

## Prochaines étapes côté schéma

1. **CI hook** : ajv sur les examples à chaque PR (déjà en place pour menu/v1, à étendre).
2. **Argument types V2** : `item_material`, `enchantment`, `entity_type`, `region` (depuis WorldGuard).
3. **Custom suggestions** pour l'argument `enum` étendu (placeholders dynamiques de type registry).
4. **Codegen Java + Brigadier** depuis `schema.json` pour le plugin.
