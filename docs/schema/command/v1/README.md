# Artisan — Command schema v1

Intermediate format of an Artisan command. A command is a **first-class entity** in the workspace, at the same level as a Menu: it has its id, its notes, its permission, and lives in the same `.itfz` pack.

## Files

| File | Role |
|---|---|
| `schema.json` | JSON Schema (Draft 2020-12), machine-validatable source of truth |
| `types.ts` | TypeScript types for the editor and the future MCP server |
| `examples/simple-heal.json` | Command without menu, without argument — direct actions. |
| `examples/profile-with-target.json` | Command with 1 optional argument that opens a menu with context. |
| `examples/pay-player.json` | Command with 2 required arguments with requirements + fallback + cooldown. |
| `examples/auction-house-subcommands.json` | Command with subcommands (alias, permission, arguments and cooldown per node, node without actions, disabled node), multilingual description. |

## Why commands on the Artisan side

All existing menu plugins (DeluxeMenus, zMenu) bind `/menu open <name>` or trivial commands. Artisan goes further: the command is a design object in its own right, with its typed arguments, its requirements, its cooldown, and its context propagated to the menu. This covers 80% of the `/profile`, `/shop`, `/heal`, `/pay`, `/warps` that an admin otherwise types by hand in `commands.yml` or via a separate plugin.

## Conceptual model

```
Command
 ├── meta (schema, id, name, aliases, permission, description, notes)
 ├── arguments : Argument[]      ← positional, ordered (required first)
 ├── requirements : Condition[]  ← ANDed, evaluated before actions
 ├── actions : Action[]          ← reused from menu/v1
 ├── fallback : Action[]         ← if requirements fail
 └── cooldown ?                   ← player or server scope
```

## Reuse from menu/v1

`Action`, `Condition` and `Cooldown` are **the same objects** as in `menu/v1`, referenced by absolute `$ref`:

```json
"actions": {
  "items": { "$ref": "https://docs.artisanmc.net/schema/menu/v1.json#/$defs/Action" }
}
```

Practical consequences:

- An admin who knows how to write a button click handler knows how to write a command.
- When a new action is added to the catalog (e.g. `set_block`), it is available on both sides for free.
- On the ajv side: both schemas must be loaded before compiling (see snippet below).

## Arguments and types

8 argument types in V1:

| Type | Parser | Tab-completion |
|---|---|---|
| `player` | name → resolved to UUID, online or offline | online + known to the server |
| `online_player` | name → connected player required | online only |
| `string` | raw | none |
| `integer` | integer number | none |
| `number` | floating-point number | none |
| `boolean` | `true` / `false` / `1` / `0` | `true`, `false` |
| `world` | name of the loaded world | loaded worlds |
| `enum` | value in `values[]` | values of `values[]` |

Rule: `required` arguments must precede optional ones in the list. Optional ones can have a `default` that supports placeholders (e.g. `"%player_name%"` to target the command's author when the argument is omitted).

## Context and placeholders

When the command runs, the arguments are parsed according to their type. Parse failure → typed error sent to the player (`§cJoueur introuvable: Bob`), command not executed.

The resolved values are exposed as **placeholders** in two forms:

- `%args_<name>%` → primary value (string representation: player name, world, enum value, number)
- `%args_<name>_<field>%` → derived fields on complex types

Current derived fields (V1):

| Type | Derived fields |
|---|---|
| `player` / `online_player` | `_uuid`, `_displayname` |

These placeholders are registered **dynamically** in the placeholder engine (PlaceholderAPI) when the menu opens from the command, and cleaned up on close. They coexist with the standard placeholders (`%player_name%`, `%world%`, etc.).

Concrete example with `profile-with-target.json`:

```
/profile Notch
   ↓
args.target = Player(uuid=069a79f4-..., name=Notch)
   ↓
open_menu profile_menu (with context {target: ...})
   ↓
Menu profile_menu : %args_target% → "Notch"
                    %args_target_uuid% → "069a79f4-..."
                    %args_target_displayname% → "§eNotch"
```

## Subcommands

`subcommands` is a recursive list of nodes, each with the fields of a command:
`name` (required), `aliases`, `permission`, `description`, `enabled`, `arguments`,
`requirements`, `actions`, `fallback`, `cooldown`, `subcommands`.

```
/ah sell 100        → sell node, arguments [100]
/ah vendre 100      → same node, via alias
/ah admin           → node without actions: usage "/ah admin (reload)"
/ah 42              → no node is named "42": arguments of the root
```

- The first words choose the node, by name or alias, as deep as they match;
  the rest is passed to that node's arguments.
- The permission of each node on the path is checked: a subcommand never widens
  the access given by its parent.
- A node without `actions` but with children shows the usage of its allowed children.
- `enabled: false` removes the node (and its children); its name falls back to the parent's arguments.
  On the root, the command is not registered.
- A `cooldown` without `id` takes the command's path (`ah`, `ah sell`): two commands no longer
  share a cooldown by accident.
- Completion offers the allowed subcommands then the node's arguments.

`description` (root and nodes) is a string for all languages or a `{language: text}` table.

An older Artisan jar ignores `subcommands` and `enabled`: the root stays usable, the
subcommands disappear.

## Context propagation

An `open_menu` action propagates the argument context to the target menu **by default**. If that menu chains another `open_menu`, the context is propagated again. To cut it:

```json
{ "type": "open_menu", "menu_id": "main_menu", "clear_context": true }
```

Typical case for `clear_context: true`: a "Back to home" button from the profile menu, which must not inherit the target.

## Text field format

As for menus, all text fields of a command (`description`, `cooldown.message`, `send_message.text`, `broadcast.text`, etc.) follow the unified convention:

- **MiniMessage** for formatting (`<color>`, `<bold>`, `<gradient>`, …).
- **Inline i18n reference**: `{i18n:command.profile.description}` resolved from the workspace's translations file (see `translations/v1`).
- **PAPI placeholders**: standard `%player_name%`, plus the `%args_<name>%` injected by the command's own arguments.
- **Legacy `§a` codes** accepted as input, converted to MiniMessage on save.

Resolution order on the plugin side: (1) `{i18n:...}` → value stored for the executing player's active language, (2) `%placeholder%` (standard PAPI + `%args_*%`), (3) final MiniMessage parse.

A `description` can therefore be fully i18n (`{i18n:command.profile.description}`) and each translation can itself contain placeholders and MiniMessage tags. Very flexible for multilingual commands without gymnastics.

## Conflicts with existing commands

At plugin startup, Artisan detects conflicts with already-registered commands (vanilla commands, other plugins). V1 policy:

- **Vanilla command** (`heal`, `tp`, etc. native): Artisan refuses to register, logs a warning, asks the admin to rename or define an alias in the server config.
- **Command from another plugin**: same, refusal + warning. No silent override.
- **Internal conflict between two Artisan commands** (same name in two enabled packs): the pack loaded last loses, a visible warning is logged.

## Pricing

Commands **have no quota** — unlimited as long as the server is within the paid limit (free tier 1 server, paid tiers per plan). A command costs ~nothing in storage (1 KB JSON) and ~nothing at runtime (no rendering, no WS). Quotas are on servers and team seats (see `main-spec.md` section 3).

## Known limitations (cross-field, not expressible in JSON Schema)

To be validated at load by `validateCommand` (see `types.ts`):

- Argument names unique within a command
- Required precede optional ones
- `enum` argument has a non-empty `values` (partially covered by `if/then` in schema.json but double-check)
- Aliases do not contain the main name
- `default` ignored on required arguments (warning, not error)

To be validated at publish/registry time:

- No `name`/`alias` conflict with the target server's registered commands
- If an action references a `menu_id`, that menu exists in the pack or the workspace

## How to use it

### Editor side (TypeScript)

```ts
import type { Command, Argument } from "./schema/command/v1/types";
import { validateCommand, placeholdersFromCommand } from "./schema/command/v1/types";
import schema from "./schema/command/v1/schema.json";
import menuSchema from "./schema/menu/v1/schema.json";
```

### Local validation

```bash
npm install ajv ajv-formats
node validate-cmd.mjs
```

```js
import Ajv from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

const ajv = new Ajv({ strict: false, allErrors: true });
addFormats.default(ajv);
ajv.addSchema(menuSchema);  // required to resolve the $refs to menu/v1
const validate = ajv.compile(commandSchema);
validate(myCommand);
```

### Plugin side (Java)

Codegen from `schema.json` with `jsonschema2pojo` (in addition to the `menu/v1` codegen). When loading a command, validate against the schema then dynamically register the Bukkit/Brigadier command with the typed arguments converted to Brigadier arguments.

## Next steps on the schema side

1. **CI hook**: ajv on the examples on each PR (already in place for menu/v1, to be extended).
2. **Argument types V2**: `item_material`, `enchantment`, `entity_type`, `region` (from WorldGuard).
3. **Custom suggestions** for the extended `enum` argument (dynamic placeholders of the registry type).
4. **Java + Brigadier codegen** from `schema.json` for the plugin.
