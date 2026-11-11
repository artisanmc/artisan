# Element display + states (the `appearances` list is retired)

**Status:** accepted (2026-08-17), not yet implemented

**Amends:** `files-first-source-of-truth.md` (format ergonomics), `versioning.md`
discipline 2 (in-version rename)

## Context

An Element's look and behaviour lived in `appearances: [...]`, an ordered list of
complete appearances resolved at render by first-match (`MenuRenderer.kt`,
`firstOrNull { evaluateAll(it.conditions) }`). An entry without `if` matches
always, so the fallback had to be written **last** — and nothing in the file said
so. Write it first and every entry after it is silently unreachable.

Two things made the shape worth revisiting rather than documenting:

- **The capability is unused.** Across every real menu (`projet_test` + the
  Boutique add-on): 47 Elements, all with exactly **one** appearance, **zero**
  `if`. The list existed entirely to serve a feature nobody had exercised, while
  taxing the only case that occurs.
- **The editor and the plugin disagreed.** Six editor call sites read
  `appearances[0]` as *the* appearance (`MenuGroup` ×2, `ItemTooltip`,
  `EdgeTooltip`, `PlacementTray`, `MenuDataSection`) while the runtime resolved
  by first-match. The canvas was betting on list order, and only `FlowCanvas`
  knew the list had more than one entry.

## Decision

An Element carries a **display** and an ordered list of **states**.

The display's fields sit **flat on the Element**, matching how every other menu
plugin in the ecosystem is written — familiarity is a feature for a product whose
adoption story is "declare, don't code". States live under `states:`, each with
its `if`:

```yaml
- id: buy
  positions: 22
  material: DIAMOND
  title: "§aAcheter"
  click:
    left: buy_item {item.id}
  states:
    - if: [not_enough_money]
      material: BARRIER
      title: "§cTrop cher"
```

**A state replaces, it does not merge.** States are tried in order; the first
whose guard passes renders. If none does, the display renders. What a state omits
is *absent*, not inherited.

The editor's domain follows the file: `Element.display: Appearance` +
`Element.states: Appearance[]`. The six `appearances[0]` become `element.display`,
a field that is by construction always there.

`appearances` is **removed**, not shimmed — the plugin is deployed on one test
server, so there is no third party whose files we would break. Existing menus are
rewritten in the canonical form.

> **Corrected on 2026-08-29: reading, however, tolerates the old list.**
>
> The premise above — "a single test server, files will be rewritten" — was
> wrong. Menus written before the change were living in production (an Add-on's
> bootstrap, whose `bootstrapIfAbsent` refuses by design to touch an existing
> project: nothing ever rewrote them). The editor then rendered them **empty
> and without a message** — invisible items, template with no content — which
> looks like a bad configuration, not a failure. It took ten days to be noticed.
>
> `menuV1ToDomain`, the `templates/` reader **and the plugin**
> (`ElementYamlDeserializer`) therefore still accept an `appearances` list
> (display first), when no flat field is present. Nothing else changes: the
> writer stays canonical — the first save puts the file right — and a state
> still does not inherit. **Tolerant reader, canonical writer**, the rule already
> set by `bare-data-files`; it should have applied here from the start, a
> read path for an old format being exactly what it targets.

This mutates `menu/v1` in place. `versioning.md:57-61` forbids renaming a field
within a version, but that rule is calqued on API surfaces where the producer is
a third party. Here the writer is ours and no readable file stops being readable.
The doc is corrected to state the rule actually applied: **a rename within a
version is allowed while the canonical writer is the only producer; the version
changes when an existing file would stop being readable.** (Precedent: `steps` →
`actions` and the flattening of `layers` → `elements`, both mutated v1 in place.)

## Considered and rejected

**Nesting the display under `display:`.** Symmetric with `states` and therefore a
better teacher of the replace semantics — a reader sees two things of the same
kind rather than a base and its overrides. Rejected because the flat form is what
a menu author already knows from other plugins, and that familiarity outweighs the
internal elegance. The cost is accepted knowingly: see the guard below.

**Merge semantics** (display is the base, a matching state overrides field by
field). This is what the flat form suggests to a human, and it makes the common
edit shorter. Rejected because it requires inventing rules with no usage data to
inform them — how to clear an inherited lore, whether `click` merges per button
or wholesale, what a partially-redefined `enchants`/`nbt` means. Replacement is
what the runtime already does, so the migration changes no behaviour at all. Merge
stays available later as a refinement of what a state inherits, without changing
the file's shape.

**Freezing the Element key set.** Flattening puts structural keys and appearance
fields in one map, so they can never collide. Freezing the structural side was
considered and rejected: since 1.20.5 Minecraft's own item data lives under
`components`, so the appearance surface is a small curated set that we control,
not an open-ended mirror of Mojang's field list. Vigilance at add-time suffices —
made mechanical by keeping the structural key list in **one** conformance vector
shared by the three layers (the `testdata/i18n-address-conformance.json` pattern),
so a collision fails a test rather than depending on whoever writes the commit.
`components:` remains available later as an *appearance* key, absorbing anything
Mojang adds without ever touching the structural namespace.

## Consequences

- **An incomplete state fails silently today.** An unresolved material falls back
  to `ItemStack(Material.STONE)` (`MenuRenderer.kt:244`), so a state written as if
  it were a patch renders a nameless stone block. Guard: `material` (or `head`, or
  an `item:` ref) is **required** in each state — enforced by the JSON schema, and
  by a single WARN at load naming the menu and the element. The render itself is
  left alone; "state ignored" would be a third rule to remember.
- **"Add state" creates an empty state**, deliberately — the immediate stone block
  in the preview teaches the replace semantics on the spot. Duplicating is a
  separate button next to it, not the default.
- **i18n addresses are unchanged.** The display keeps the `default` segment and
  states become `state1`, `state2`… Since every existing Element has exactly one
  appearance at index 0, no `lang/` key moves and no re-keying is needed.
- Menus are reset to the canonical form as part of the change; nothing on disk
  keeps the old shape.
