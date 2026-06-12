# Custom Heads (hdb / base64 / playerhead) + Head Icon Fix — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Menus can render custom player heads from three sources (`hdb:<id>`, `basehead:<base64>`, `playerhead:<name>`) via a new optional `head` field on `Appearance`, and head items stop rendering as soulsand in the editor.

**Architecture:** `head` is an additive optional string on `menu/v1` Appearance, honored only when the material resolves to `PLAYER_HEAD`. The plugin parses it into a sealed `HeadRef` and applies it via a new `HeadApplier` (Paper `PlayerProfile` for base64, `owningPlayer` for names, reflection-based HeadDatabase hook in `SoftDepRegistry` for hdb). The editor adds a conditional "custom head" section to the state card, previews real textures via `mc-heads.net` when resolvable, and the soulsand bug is fixed by routing skull items through the existing `__entity__/` Three.js entity-render pipeline with new head-cube geometry.

**Tech Stack:** Kotlin 2.0 / Paper 1.21 / MockBukkit 3.133.2 (plugin), React 19 + zustand + vitest (editor), Bun scripts + Three.js pre-render (icons).

**Spec:** `docs/superpowers/specs/2026-06-12-custom-heads-design.md`

**Conventions (read first):**
- Plugin tests: `cd plugin && ./gradlew test --tests "net.artisanmc.plugin.<Class>"` (full suite: `./gradlew test`).
- Editor tests: `cd editor && npm test -- run <file>` (vitest; full suite `npm test`).
- Backend tests: `cd backend && bun run test` — **NEVER `bun test` direct** (wipes dev DB).
- Commit with explicit paths (`git add <paths>`), never `git add -A`. Conventional commits.
- Editor UI strings go through react-i18next: every new key lands in BOTH `editor/src/locales/en.ts` and `fr.ts` in the same commit.

---

### Task 1: `head` field in menu/v1 schema + schema docs + assistant grounding

**Files:**
- Modify: `docs/schema/menu/v1/schema.json` (Appearance `$defs`)
- Modify: `docs/schema/menu/v1/types.ts` (interface `Appearance`, ~line 154)
- Modify: `backend/src/modules/assistant/grounding/menu-v1-authoring-guide.md` (~line 67, after the `material` bullet)
- Test: `editor/src/schema/validateMenuV1.test.ts`

- [ ] **Step 1: Write the failing tests**

In `editor/src/schema/validateMenuV1.test.ts`, reuse the existing canonical-example import pattern at the top of the file (the `canonicalButton` fixture) and add:

```ts
it("accepts an appearance with a custom head", () => {
  const m = structuredClone(canonicalButton) as Record<string, any>;
  const app = m.layers[0].elements[0].appearances[0];
  app.material = "PLAYER_HEAD";
  app.head = "hdb:128276";
  expect(validateMenuV1(m).valid).toBe(true);
});

it("rejects a non-string head", () => {
  const m = structuredClone(canonicalButton) as Record<string, any>;
  m.layers[0].elements[0].appearances[0].head = 42;
  expect(validateMenuV1(m).valid).toBe(false);
});
```

(If `canonicalButton` is named differently, mirror whatever fixture `accepts the canonical button example` uses.)

- [ ] **Step 2: Run tests to verify the first one fails**

Run: `cd editor && npm test -- run src/schema/validateMenuV1.test.ts`
Expected: FAIL — `additionalProperties: false` rejects `head`.

- [ ] **Step 3: Add `head` to schema.json**

In `docs/schema/menu/v1/schema.json`, in `$defs.Appearance.properties`, after the `"material"` entry:

```json
"head": { "type": "string", "description": "Tête custom quand material = PLAYER_HEAD : hdb:<id> (HeadDatabase), basehead:<base64>, ou playerhead:<pseudo> (placeholders résolus au rendu). Ignoré pour tout autre material." },
```

- [ ] **Step 4: Align hand-written schema types**

In `docs/schema/menu/v1/types.ts`, interface `Appearance`, after `material`:

```ts
/** Tête custom quand material = PLAYER_HEAD : hdb:<id>, basehead:<base64>, ou playerhead:<pseudo>. */
head?: string;
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd editor && npm test -- run src/schema/validateMenuV1.test.ts`
Expected: PASS (all, including pre-existing).

- [ ] **Step 6: Document `head` in the assistant authoring guide**

In `backend/src/modules/assistant/grounding/menu-v1-authoring-guide.md`, right after the `material` bullet (~line 67), add:

```markdown
- **`head`** — custom head when `material` is `PLAYER_HEAD`. Three forms: `hdb:<id>`
  (HeadDatabase plugin id), `basehead:<base64 textures value>`, or `playerhead:<name>`
  (player name; placeholders like `playerhead:%player%` allowed). Ignored for any other material.
```

Then check for hardcoded appearance-field allowlists in the assistant module:
`grep -rn "enchanted\|custom_model_data" backend/src/modules/assistant/*.ts` — if `grounding.ts` or `validate.ts` enumerates importable Appearance fields, add `head` there too.

- [ ] **Step 7: Run backend assistant tests**

Run: `cd backend && bun run test src/modules/assistant`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add docs/schema/menu/v1/schema.json docs/schema/menu/v1/types.ts backend/src/modules/assistant/grounding/menu-v1-authoring-guide.md editor/src/schema/validateMenuV1.test.ts
git commit -m "feat(schema): Appearance.head — custom head sources for PLAYER_HEAD (menu/v1 additive)"
```

(Include any assistant `.ts` file touched in Step 6.)

---

### Task 2: `head` through editor domain, import (menuV1ToDomain) and export (transform)

**Files:**
- Modify: `editor/src/domain/types.ts` (interface `Appearance`, ~line 158)
- Modify: `editor/src/schema/menuV1ToDomain.ts` (function `appearance`, ~line 277)
- Modify: `editor/src/features/export/transform.ts` (function `serializeAppearance`, ~line 159)
- Test: `editor/src/schema/menuV1ToDomain.test.ts`, `editor/src/features/export/transform.test.ts`, `editor/src/schema/menuV1ToDomain.roundtrip.test.ts`

- [ ] **Step 1: Write the failing tests**

In `editor/src/schema/menuV1ToDomain.test.ts` (mirror the existing `menuWithAppearance` helper used at ~line 402):

```ts
it("imports appearance.head", () => {
  const src = menuWithAppearance({ material: "PLAYER_HEAD", head: "hdb:128276" });
  const r = importOk(src); // or however the file unwraps a successful import
  expect(r.menu.layers[0]!.elements[0]!.appearances[0]!.head).toBe("hdb:128276");
});
```

In `editor/src/features/export/transform.test.ts` (mirror an existing appearance serialization test — build a pack whose element appearance has `material: "PLAYER_HEAD", head: "basehead:eyJ0ZXh0dXJlcyI6e319"` and assert the serialized appearance object contains `head: "basehead:eyJ0ZXh0dXJlcyI6e319"`).

In `editor/src/schema/menuV1ToDomain.roundtrip.test.ts`, extend the roundtrip fixture's appearance with `head: "playerhead:%player%"` (the roundtrip assertion is structural, so adding the field to the source fixture is enough to cover it).

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd editor && npm test -- run src/schema/menuV1ToDomain.test.ts src/features/export/transform.test.ts src/schema/menuV1ToDomain.roundtrip.test.ts`
Expected: FAIL — `head` is dropped on both paths.

- [ ] **Step 3: Implement**

`editor/src/domain/types.ts`, interface `Appearance`, after `material?: string;`:

```ts
/** Custom head when material is PLAYER_HEAD: "hdb:<id>", "basehead:<base64>", or "playerhead:<name>". */
head?: string;
```

`editor/src/schema/menuV1ToDomain.ts`, in `appearance(a: Json)`, after `if (a.material) out.material = a.material;`:

```ts
if (a.head) out.head = a.head;
```

`editor/src/features/export/transform.ts`, in `serializeAppearance`, after `if (app.material) out.material = app.material;`:

```ts
if (app.head) out.head = app.head;
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd editor && npm test -- run src/schema/menuV1ToDomain.test.ts src/features/export/transform.test.ts src/schema/menuV1ToDomain.roundtrip.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add editor/src/domain/types.ts editor/src/schema/menuV1ToDomain.ts editor/src/features/export/transform.ts editor/src/schema/menuV1ToDomain.test.ts editor/src/features/export/transform.test.ts editor/src/schema/menuV1ToDomain.roundtrip.test.ts
git commit -m "feat(editor): Appearance.head joins import/export round-trip"
```

---

### Task 3: Plugin — `AppearanceYaml.head` + `HeadRef` parsing (pure)

**Files:**
- Create: `plugin/src/main/kotlin/net/artisanmc/plugin/render/HeadRef.kt`
- Modify: `plugin/src/main/kotlin/net/artisanmc/plugin/model/PackBundle.kt` (data class `AppearanceYaml`, line 77)
- Test (create): `plugin/src/test/kotlin/net/artisanmc/plugin/HeadRefTest.kt`
- Test (modify): `plugin/src/test/kotlin/net/artisanmc/plugin/MenuYamlParsingTest.kt`

- [ ] **Step 1: Write the failing tests**

`plugin/src/test/kotlin/net/artisanmc/plugin/HeadRefTest.kt`:

```kotlin
package net.artisanmc.plugin

import net.artisanmc.plugin.render.HeadRef
import kotlin.test.*

class HeadRefTest {
    @Test fun `parses hdb ids`() {
        assertEquals(HeadRef.Hdb("128276"), HeadRef.parse("hdb:128276"))
    }

    @Test fun `parses basehead base64`() {
        assertEquals(HeadRef.Base64("eyJ0ZXh0dXJlcyI6e319"), HeadRef.parse("basehead:eyJ0ZXh0dXJlcyI6e319"))
    }

    @Test fun `parses playerhead names`() {
        assertEquals(HeadRef.PlayerName("Notch"), HeadRef.parse("playerhead:Notch"))
    }

    @Test fun `raw base64 without prefix is tolerated (hand-edited YAML)`() {
        assertEquals(HeadRef.Base64("eyJ0ZXh0dXJlcyI6e319"), HeadRef.parse("eyJ0ZXh0dXJlcyI6e319"))
    }

    @Test fun `unknown values and empty payloads parse to null`() {
        assertNull(HeadRef.parse("wat:123"))
        assertNull(HeadRef.parse("hdb:"))
        assertNull(HeadRef.parse("playerhead: "))
        assertNull(HeadRef.parse(""))
    }

    @Test fun `uuidFor is deterministic`() {
        assertEquals(HeadRef.uuidFor("eyJabc"), HeadRef.uuidFor("eyJabc"))
        assertNotEquals(HeadRef.uuidFor("eyJabc"), HeadRef.uuidFor("eyJxyz"))
    }
}
```

In `MenuYamlParsingTest.kt`, add (mirroring the file's existing mapper setup):

```kotlin
@Test fun `appearance head field is parsed`() {
    val yaml = """
        schema: menu/v1
        id: heads
        title: []
        size: 9
        layers:
          - id: main
            name: Main
            elements:
              - id: hd
                positions: "0"
                appearances:
                  - material: PLAYER_HEAD
                    head: "hdb:128276"
    """.trimIndent()
    val menu = mapper.readValue<MenuYaml>(yaml)
    assertEquals("hdb:128276", menu.layers[0].elements[0].appearances[0].head)
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd plugin && ./gradlew test --tests "net.artisanmc.plugin.HeadRefTest" --tests "net.artisanmc.plugin.MenuYamlParsingTest"`
Expected: FAIL to compile (`HeadRef` and `head` don't exist) — that counts as RED.

- [ ] **Step 3: Implement**

`plugin/src/main/kotlin/net/artisanmc/plugin/render/HeadRef.kt`:

```kotlin
package net.artisanmc.plugin.render

import java.util.UUID

/**
 * Référence de tête custom portée par AppearanceYaml.head.
 *  - hdb:<id>              → HeadDatabase
 *  - basehead:<base64>     → profil avec property "textures"
 *  - playerhead:<pseudo>   → tête du joueur nommé (placeholders résolus en amont)
 *  - "eyJ…" sans préfixe   → tolérance YAML édité main, traité comme basehead
 */
sealed interface HeadRef {
    data class Hdb(val id: String) : HeadRef
    data class Base64(val value: String) : HeadRef
    data class PlayerName(val name: String) : HeadRef

    companion object {
        fun parse(raw: String): HeadRef? {
            val v = raw.trim()
            return when {
                v.startsWith("hdb:")        -> v.removePrefix("hdb:").trim().ifEmpty { null }?.let(::Hdb)
                v.startsWith("basehead:")   -> v.removePrefix("basehead:").trim().ifEmpty { null }?.let(::Base64)
                v.startsWith("playerhead:") -> v.removePrefix("playerhead:").trim().ifEmpty { null }?.let(::PlayerName)
                v.startsWith("eyJ")         -> Base64(v)
                else                        -> null
            }
        }

        /** UUID stable dérivé du base64 — deux items de même texture restent comparables. */
        fun uuidFor(base64: String): UUID = UUID.nameUUIDFromBytes(base64.toByteArray(Charsets.UTF_8))
    }
}
```

`PackBundle.kt`, data class `AppearanceYaml` (line 77) — add after `material`:

```kotlin
val head: String? = null,
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd plugin && ./gradlew test --tests "net.artisanmc.plugin.HeadRefTest" --tests "net.artisanmc.plugin.MenuYamlParsingTest"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add plugin/src/main/kotlin/net/artisanmc/plugin/render/HeadRef.kt plugin/src/main/kotlin/net/artisanmc/plugin/model/PackBundle.kt plugin/src/test/kotlin/net/artisanmc/plugin/HeadRefTest.kt plugin/src/test/kotlin/net/artisanmc/plugin/MenuYamlParsingTest.kt
git commit -m "feat(plugin): parse Appearance.head into HeadRef (hdb/basehead/playerhead)"
```

---

### Task 4: Plugin — HeadApplier + HeadDatabase hook + MenuRenderer wiring

**Files:**
- Create: `plugin/src/main/kotlin/net/artisanmc/plugin/render/HeadApplier.kt`
- Modify: `plugin/src/main/kotlin/net/artisanmc/plugin/engine/SoftDepRegistry.kt`
- Modify: `plugin/src/main/kotlin/net/artisanmc/plugin/render/MenuRenderer.kt` (`buildItem`, lines 129-154)
- Modify: `plugin/src/main/resources/plugin.yml` (line 5)
- Test (create): `plugin/src/test/kotlin/net/artisanmc/plugin/MenuRendererHeadTest.kt`

- [ ] **Step 1: Write the failing tests**

`plugin/src/test/kotlin/net/artisanmc/plugin/MenuRendererHeadTest.kt` (setup mirrors `MenuRendererIterationTest`):

```kotlin
package net.artisanmc.plugin

import be.seeseemelk.mockbukkit.MockBukkit
import com.fasterxml.jackson.databind.ObjectMapper
import com.fasterxml.jackson.dataformat.yaml.YAMLFactory
import com.fasterxml.jackson.module.kotlin.readValue
import com.fasterxml.jackson.module.kotlin.registerKotlinModule
import net.artisanmc.plugin.engine.*
import net.artisanmc.plugin.model.MenuYaml
import net.artisanmc.plugin.render.HeadRef
import net.artisanmc.plugin.render.MenuRenderer
import org.bukkit.Material
import org.bukkit.inventory.meta.SkullMeta
import kotlin.test.*

class MenuRendererHeadTest {
    @BeforeTest fun setup() { MockBukkit.mock() }
    @AfterTest fun teardown() { MockBukkit.unmock() }

    private val mapper = ObjectMapper(YAMLFactory()).registerKotlinModule()
    private fun player() = MockBukkit.getMock()!!.addPlayer()

    private val B64 = "eyJ0ZXh0dXJlcyI6e319"

    private fun headMenu(material: String, head: String): MenuYaml = mapper.readValue(
        """
        schema: menu/v1
        id: heads
        title: []
        size: 9
        layers:
          - id: main
            name: Main
            elements:
              - id: hd
                positions: "0"
                appearances:
                  - material: $material
                    head: "$head"
        """.trimIndent(),
    )

    private fun render(material: String, head: String, args: Map<String, Any> = emptyMap()): org.bukkit.inventory.ItemStack? {
        val p = player()
        val menu = BundleCompiler.compile(headMenu(material, head), emptyMap())
        MenuRenderer.open(p, menu, "en", ExecutionContext(p, args = args))
        return p.openInventory.topInventory.getItem(0)
    }

    @Test fun `basehead applies a textures profile with a deterministic uuid`() {
        val item = render("PLAYER_HEAD", "basehead:$B64")
        assertEquals(Material.PLAYER_HEAD, item?.type)
        val meta = item?.itemMeta as SkullMeta
        val profile = meta.playerProfile
        assertNotNull(profile)
        assertEquals(HeadRef.uuidFor(B64), profile.id)
        assertEquals(B64, profile.properties.first { it.name == "textures" }.value)
    }

    @Test fun `raw base64 without prefix is treated as basehead`() {
        val meta = render("PLAYER_HEAD", B64)?.itemMeta as SkullMeta
        assertNotNull(meta.playerProfile)
    }

    @Test fun `playerhead sets the owning player`() {
        val meta = render("PLAYER_HEAD", "playerhead:Notch")?.itemMeta as SkullMeta
        assertEquals("Notch", meta.owningPlayer?.name)
    }

    @Test fun `playerhead resolves context placeholders`() {
        val meta = render("PLAYER_HEAD", "playerhead:{owner}", args = mapOf("owner" to "Steve"))
            ?.itemMeta as SkullMeta
        assertEquals("Steve", meta.owningPlayer?.name)
    }

    @Test fun `hdb without HeadDatabase falls back to a plain player head`() {
        val item = render("PLAYER_HEAD", "hdb:128276")
        assertEquals(Material.PLAYER_HEAD, item?.type)
        assertNull((item?.itemMeta as SkullMeta).playerProfile)
    }

    @Test fun `head is ignored when material is not PLAYER_HEAD`() {
        val item = render("STONE", "basehead:$B64")
        assertEquals(Material.STONE, item?.type)
    }

    @Test fun `unparseable head renders the plain head without crashing`() {
        val item = render("PLAYER_HEAD", "wat:123")
        assertEquals(Material.PLAYER_HEAD, item?.type)
    }
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd plugin && ./gradlew test --tests "net.artisanmc.plugin.MenuRendererHeadTest"`
Expected: FAIL — profile/owner assertions fail (head is parsed but never applied).

- [ ] **Step 3: Implement SoftDepRegistry HeadDatabase hook**

In `SoftDepRegistry.kt`, after `ItemsAdderItemRenderer` (~line 103), add:

```kotlin
class HeadDatabaseRenderer {
    fun buildStack(id: String, count: Int): ItemStack? = runCatching {
        val apiClass = Class.forName("me.arcaniax.hdb.api.HeadDatabaseAPI")
        val api = apiClass.getConstructor().newInstance()
        (apiClass.getMethod("getItemHead", String::class.java).invoke(api, id) as ItemStack)
            .also { it.amount = count.coerceAtLeast(1) }
    }.getOrNull()

    companion object {
        fun tryInit(): HeadDatabaseRenderer? = runCatching {
            Class.forName("me.arcaniax.hdb.api.HeadDatabaseAPI")
            HeadDatabaseRenderer()
        }.getOrNull()
    }
}
```

Extend the registry (constructor param, plugin-constructor wiring, and `EMPTY`):

```kotlin
class SoftDepRegistry(
    val vault: VaultProvider?,
    val papi: PapiProvider?,
    val worldGuard: WorldGuardProvider?,
    val nexoItems: NexoItemRenderer?,
    val oraxenItems: OraxenItemRenderer?,
    val itemsAdderItems: ItemsAdderItemRenderer?,
    val hdbHeads: HeadDatabaseRenderer? = null,
) {
    constructor(plugin: JavaPlugin) : this(
        vault           = VaultProvider.tryInit(plugin),
        papi            = PapiProvider.tryInit(),
        worldGuard      = WorldGuardProvider.tryInit(),
        nexoItems       = NexoItemRenderer.tryInit(),
        oraxenItems     = OraxenItemRenderer.tryInit(),
        itemsAdderItems = ItemsAdderItemRenderer.tryInit(),
        hdbHeads        = HeadDatabaseRenderer.tryInit(),
    )
    // buildCustomStack unchanged; EMPTY gains hdbHeads = null
```

- [ ] **Step 4: Implement HeadApplier**

`plugin/src/main/kotlin/net/artisanmc/plugin/render/HeadApplier.kt`:

```kotlin
package net.artisanmc.plugin.render

import com.destroystokyo.paper.profile.ProfileProperty
import net.artisanmc.plugin.engine.SoftDepRegistry
import org.bukkit.Bukkit
import org.bukkit.inventory.ItemStack
import org.bukkit.inventory.meta.SkullMeta
import java.util.concurrent.ConcurrentHashMap

/**
 * Applique AppearanceYaml.head (déjà résolu par ArgResolver) sur un item
 * PLAYER_HEAD. Source indisponible ou valeur invalide → tête nue + un seul
 * WARN par clé (post-mortem, pas de théâtre).
 */
object HeadApplier {
    private val warned = ConcurrentHashMap.newKeySet<String>()

    fun apply(item: ItemStack, rawHead: String, deps: SoftDepRegistry): ItemStack {
        val ref = HeadRef.parse(rawHead) ?: run {
            warnOnce("unparseable:$rawHead", "head \"$rawHead\" not recognized — expected hdb:<id>, basehead:<base64> or playerhead:<name>")
            return item
        }
        return when (ref) {
            is HeadRef.Hdb -> deps.hdbHeads?.buildStack(ref.id, item.amount) ?: run {
                warnOnce("hdb-missing", "head \"hdb:${ref.id}\" requires the HeadDatabase plugin — rendering a plain player head")
                item
            }
            is HeadRef.Base64 -> item.also { stack ->
                val meta = stack.itemMeta as? SkullMeta ?: return@also
                val profile = Bukkit.createProfile(HeadRef.uuidFor(ref.value))
                profile.setProperty(ProfileProperty("textures", ref.value))
                meta.playerProfile = profile
                stack.itemMeta = meta
            }
            is HeadRef.PlayerName -> item.also { stack ->
                val meta = stack.itemMeta as? SkullMeta ?: return@also
                meta.owningPlayer = Bukkit.getOfflinePlayer(ref.name)
                stack.itemMeta = meta
            }
        }
    }

    private fun warnOnce(key: String, message: String) {
        if (warned.add(key)) Bukkit.getLogger().warning("[Artisan] $message")
    }
}
```

- [ ] **Step 5: Wire into MenuRenderer.buildItem**

In `MenuRenderer.kt`, `buildItem` (lines 139-144), change the item construction to:

```kotlin
val resolvedMaterial = app.material?.let { ArgResolver.resolve(it, ctx.args) }
var item = resolvedMaterial?.let { mat ->
    deps.buildCustomStack(mat, count)
        ?: runCatching { Material.valueOf(mat.uppercase()) }.getOrNull()
            ?.let { ItemStack(it, count) }
} ?: ItemStack(Material.STONE, count)
if (item.type == Material.PLAYER_HEAD && app.head != null) {
    item = HeadApplier.apply(item, ArgResolver.resolve(app.head, ctx.args), deps)
}
```

(The rest of `buildItem` — title/lore meta — operates on `item` unchanged; note hdb replacement happens before title/lore are applied, so editor-configured title/lore still win over HeadDatabase's.)

- [ ] **Step 6: Add HeadDatabase softdepend**

`plugin/src/main/resources/plugin.yml` line 5:

```yaml
softdepend: [Vault, PlaceholderAPI, WorldGuard, Nexo, Oraxen, ItemsAdder, HeadDatabase]
```

- [ ] **Step 7: Run the head tests, then the full plugin suite**

Run: `cd plugin && ./gradlew test --tests "net.artisanmc.plugin.MenuRendererHeadTest"` → PASS
Then: `./gradlew test` → PASS (no regressions).
If `meta.playerProfile` assertions hit a MockBukkit `UnimplementedOperationException`, MockBukkit 3.133.2's `SkullMetaMock` does implement `get/setPlayerProfile` (verified by class inspection) — the failure is then real implementation breakage, not the mock.

- [ ] **Step 8: Commit**

```bash
git add plugin/src/main/kotlin/net/artisanmc/plugin/render/HeadApplier.kt plugin/src/main/kotlin/net/artisanmc/plugin/render/MenuRenderer.kt plugin/src/main/kotlin/net/artisanmc/plugin/engine/SoftDepRegistry.kt plugin/src/main/resources/plugin.yml plugin/src/test/kotlin/net/artisanmc/plugin/MenuRendererHeadTest.kt
git commit -m "feat(plugin): render custom heads — base64 profile, player name, HeadDatabase softdep"
```

---

### Task 5: Editor — head preview resolver (pure) 

**Files:**
- Create: `editor/src/features/canvas/headTexture.ts`
- Test (create): `editor/src/features/canvas/headTexture.test.ts`

- [ ] **Step 1: Write the failing tests**

`editor/src/features/canvas/headTexture.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { headPreviewUrl } from "./headTexture";

// {"textures":{"SKIN":{"url":"http://textures.minecraft.net/texture/20732e7fb4694c6777948d3bfa3d02b3d5c15ccb1ca2eace9dbc2d6283b41bf1"}}}
const B64 =
  "eyJ0ZXh0dXJlcyI6eyJTS0lOIjp7InVybCI6Imh0dHA6Ly90ZXh0dXJlcy5taW5lY3JhZnQubmV0L3RleHR1cmUvMjA3MzJlN2ZiNDY5NGM2Nzc3OTQ4ZDNiZmEzZDAyYjNkNWMxNWNjYjFjYTJlYWNlOWRiYzJkNjI4M2I0MWJmMSJ9fX0=";
const HASH = "20732e7fb4694c6777948d3bfa3d02b3d5c15ccb1ca2eace9dbc2d6283b41bf1";

describe("headPreviewUrl", () => {
  it("decodes basehead base64 to an mc-heads texture render", () => {
    expect(headPreviewUrl(`basehead:${B64}`)).toBe(`https://mc-heads.net/head/${HASH}`);
  });

  it("accepts raw base64 without prefix", () => {
    expect(headPreviewUrl(B64)).toBe(`https://mc-heads.net/head/${HASH}`);
  });

  it("renders literal player names via mc-heads", () => {
    expect(headPreviewUrl("playerhead:Notch")).toBe("https://mc-heads.net/head/Notch");
  });

  it("returns undefined for placeholder player names", () => {
    expect(headPreviewUrl("playerhead:%player%")).toBeUndefined();
    expect(headPreviewUrl("playerhead:{owner}")).toBeUndefined();
  });

  it("returns undefined for hdb ids (no public resolution API)", () => {
    expect(headPreviewUrl("hdb:128276")).toBeUndefined();
  });

  it("returns undefined for empty, invalid base64, and unknown values", () => {
    expect(headPreviewUrl(undefined)).toBeUndefined();
    expect(headPreviewUrl("")).toBeUndefined();
    expect(headPreviewUrl("basehead:%%%")).toBeUndefined();
    expect(headPreviewUrl("wat:1")).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd editor && npm test -- run src/features/canvas/headTexture.test.ts`
Expected: FAIL — module doesn't exist.

- [ ] **Step 3: Implement**

`editor/src/features/canvas/headTexture.ts`:

```ts
/**
 * Resolve an Appearance.head value to a previewable image URL.
 *  - basehead:<b64> / raw "eyJ…"  → decode → textures.minecraft.net hash → mc-heads 3D render
 *  - playerhead:<literal name>    → mc-heads by name (placeholders → undefined)
 *  - hdb:<id>                     → undefined (no public HeadDatabase API; caller shows the generic icon)
 * Returns undefined whenever the value can't be resolved — caller falls back to the material texture.
 */
export function headPreviewUrl(head: string | undefined): string | undefined {
  if (!head) return undefined;
  if (head.startsWith("basehead:") || head.startsWith("eyJ")) {
    const b64 = head.startsWith("basehead:") ? head.slice("basehead:".length) : head;
    try {
      const json = JSON.parse(atob(b64)) as { textures?: { SKIN?: { url?: string } } };
      const hash = json.textures?.SKIN?.url?.match(/texture\/([0-9a-f]+)/i)?.[1];
      return hash ? `https://mc-heads.net/head/${hash}` : undefined;
    } catch {
      return undefined;
    }
  }
  if (head.startsWith("playerhead:")) {
    const name = head.slice("playerhead:".length).trim();
    if (!name || /[{%]/.test(name)) return undefined;
    return `https://mc-heads.net/head/${encodeURIComponent(name)}`;
  }
  return undefined;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd editor && npm test -- run src/features/canvas/headTexture.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add editor/src/features/canvas/headTexture.ts editor/src/features/canvas/headTexture.test.ts
git commit -m "feat(editor): headPreviewUrl — resolve custom head values to mc-heads previews"
```

---

### Task 6: Editor — store field, HeadField UI in the state card, canvas wiring, i18n

**Files:**
- Modify: `editor/src/state/accountStore.ts` (`setAppearanceField` type ~line 241, impl ~line 1910)
- Create: `editor/src/features/flow/headField.ts` (pure helpers)
- Test (create): `editor/src/features/flow/headField.test.ts`
- Modify: `editor/src/features/flow/FlowCanvas.tsx` (StateCard, material row ~line 727)
- Modify: `editor/src/features/canvas/SlotItem.tsx`
- Modify: `editor/src/features/canvas/MenuGroup.tsx` (slot-info type ~line 167, builders ~lines 206/222/240, `<SlotItem>` calls ~lines 471/548/571)
- Modify: `editor/src/locales/en.ts` + `editor/src/locales/fr.ts` (`flow` section)

- [ ] **Step 0a: Write failing tests for the head-field helpers**

`editor/src/features/flow/headField.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { buildHeadValue, headSourceOf, headValueOf } from "./headField";

describe("headSourceOf", () => {
  it("detects each prefix", () => {
    expect(headSourceOf("")).toBe("none");
    expect(headSourceOf("hdb:128276")).toBe("hdb");
    expect(headSourceOf("playerhead:Notch")).toBe("playerhead");
    expect(headSourceOf("basehead:eyJ0")).toBe("basehead");
    expect(headSourceOf("eyJ0ZXh0")).toBe("basehead"); // raw base64
  });
});

describe("headValueOf", () => {
  it("strips the prefix", () => {
    expect(headValueOf("hdb:128276")).toBe("128276");
    expect(headValueOf("playerhead:Notch")).toBe("Notch");
    expect(headValueOf("basehead:eyJ0")).toBe("eyJ0");
    expect(headValueOf("eyJ0")).toBe("eyJ0");
  });
});

describe("buildHeadValue", () => {
  it("prefixes by selected source", () => {
    expect(buildHeadValue("hdb", "128276")).toBe("hdb:128276");
    expect(buildHeadValue("playerhead", "Notch")).toBe("playerhead:Notch");
    expect(buildHeadValue("basehead", "abc")).toBe("basehead:abc");
  });
  it("re-detects pasted canonical values regardless of selected source", () => {
    expect(buildHeadValue("playerhead", "hdb:128276")).toBe("hdb:128276");
    expect(buildHeadValue("hdb", "eyJ0ZXh0")).toBe("basehead:eyJ0ZXh0");
  });
  it("empty input clears the value", () => {
    expect(buildHeadValue("hdb", "  ")).toBe("");
  });
});
```

Run: `cd editor && npm test -- run src/features/flow/headField.test.ts` → FAIL (module missing).

- [ ] **Step 0b: Implement `editor/src/features/flow/headField.ts`**

```ts
export type HeadSource = "none" | "hdb" | "basehead" | "playerhead";

export function headSourceOf(head: string): HeadSource {
  if (!head) return "none";
  if (head.startsWith("hdb:")) return "hdb";
  if (head.startsWith("playerhead:")) return "playerhead";
  return "basehead"; // basehead: prefix or raw eyJ…
}

export function headValueOf(head: string): string {
  for (const p of ["hdb:", "basehead:", "playerhead:"]) {
    if (head.startsWith(p)) return head.slice(p.length);
  }
  return head;
}

/** Builds the canonical stored value; pasting "hdb:…" or raw base64 re-detects the source. */
export function buildHeadValue(source: HeadSource, raw: string): string {
  const v = raw.trim();
  if (!v) return "";
  if (v.startsWith("hdb:") || v.startsWith("basehead:") || v.startsWith("playerhead:")) return v;
  if (v.startsWith("eyJ")) return `basehead:${v}`;
  if (source === "hdb") return `hdb:${v}`;
  if (source === "playerhead") return `playerhead:${v}`;
  return `basehead:${v}`;
}
```

Run: `cd editor && npm test -- run src/features/flow/headField.test.ts` → PASS.

- [ ] **Step 1: Extend `setAppearanceField` to accept `head`**

Type (~line 241): `field: "count" | "material" | "head";`
Impl (~line 1914), after the `material` branch:

```ts
} else if (field === "head") {
  if (typeof value !== "string") return;
  appearance.head = value || undefined;
}
```

- [ ] **Step 2: Add i18n keys**

`editor/src/locales/en.ts`, inside `flow: {` (after `countLabel`):

```ts
headLabel: "custom head",
headSourceNone: "none",
headSourceHdb: "HeadDatabase",
headSourceBase64: "Base64 texture",
headSourcePlayer: "Player name",
headPlaceholderHdb: "128276",
headPlaceholderBase64: "eyJ0ZXh0dXJlcyI6…",
headPlaceholderPlayer: "Notch or %player%",
headHdbHint: "Requires the HeadDatabase plugin on the server. No preview in the editor.",
```

`editor/src/locales/fr.ts`, same keys:

```ts
headLabel: "tête custom",
headSourceNone: "aucune",
headSourceHdb: "HeadDatabase",
headSourceBase64: "Texture Base64",
headSourcePlayer: "Pseudo joueur",
headPlaceholderHdb: "128276",
headPlaceholderBase64: "eyJ0ZXh0dXJlcyI6…",
headPlaceholderPlayer: "Notch ou %player%",
headHdbHint: "Nécessite le plugin HeadDatabase sur le serveur. Pas de preview dans l'éditeur.",
```

- [ ] **Step 3: Add the HeadField component + render it in the state card**

In `FlowCanvas.tsx`, add near `StateMaterialIcon` (importing the helpers: `import { buildHeadValue, type HeadSource, headSourceOf, headValueOf } from "./headField";`):

```tsx
function HeadField({ head, onChange }: { head: string; onChange: (v: string) => void }) {
  const { t } = useTranslation();
  const source = headSourceOf(head);
  const placeholder =
    source === "hdb"
      ? t("flow.headPlaceholderHdb")
      : source === "playerhead"
        ? t("flow.headPlaceholderPlayer")
        : t("flow.headPlaceholderBase64");
  return (
    <div>
      <FieldLabel>{t("flow.headLabel")}</FieldLabel>
      <div className="flex items-center gap-1.5">
        <select
          className="select h-8 w-32 shrink-0 text-xs"
          value={source}
          onChange={(e) => {
            const next = e.target.value as HeadSource;
            if (next === "none") onChange("");
            else onChange(buildHeadValue(next, headValueOf(head)));
          }}
        >
          <option value="none">{t("flow.headSourceNone")}</option>
          <option value="hdb">{t("flow.headSourceHdb")}</option>
          <option value="basehead">{t("flow.headSourceBase64")}</option>
          <option value="playerhead">{t("flow.headSourcePlayer")}</option>
        </select>
        {source !== "none" ? (
          <Input
            value={headValueOf(head)}
            placeholder={placeholder}
            onChange={(e) => onChange(buildHeadValue(source, e.target.value))}
            className="h-8 flex-1 px-2 py-0 font-mono text-xs"
          />
        ) : null}
      </div>
      {source === "hdb" ? (
        <p className="mt-1 text-[10px] text-zinc-500">{t("flow.headHdbHint")}</p>
      ) : null}
    </div>
  );
}
```

(If the `.select` utility class doesn't fit the 8-height row, mirror the `<select>` styling already used at FlowCanvas.tsx:1259.)

In the StateCard (focused branch), right after the Material row `</div>` (~line 744):

```tsx
{material.toLowerCase() === "player_head" ? (
  <HeadField
    head={appearance.head ?? ""}
    onChange={(v) =>
      setAppearanceField({
        packId,
        menuId: menu.id,
        elementId: element.id,
        appearanceIndex: stateIndex,
        field: "head",
        value: v,
      })
    }
  />
) : null}
```

And make the card's icon use the head preview — in the StateCard body (~line 550), change:

```tsx
const textureUrl = headPreviewUrl(appearance.head) ?? useTextureUrl(material);
```

with `import { headPreviewUrl } from "@/features/canvas/headTexture";` added to the imports. (Call `useTextureUrl` unconditionally first if the linter complains about conditional hooks: `const matUrl = useTextureUrl(material); const textureUrl = headPreviewUrl(appearance.head) ?? matUrl;`)

- [ ] **Step 4: Canvas slot preview**

`SlotItem.tsx`:

```tsx
import { headPreviewUrl } from "./headTexture";

export interface SlotItemProps {
  material: string;
  innerX: number;
  innerY: number;
  count?: number;
  head?: string;
}

export function SlotItem({ material, innerX, innerY, count, head }: SlotItemProps) {
  const materialUrl = useTextureUrl(material);
  const url = headPreviewUrl(head) ?? materialUrl;
  // rest unchanged
```

`MenuGroup.tsx`:
1. Extend the slot-info type (~line 167) with `head?: string`.
2. At each of the three builders (~lines 206, 222, 240) where `material: appearance.material ? …` is set, add alongside: `head: appearance.head,`.
3. Pass it through each `<SlotItem … />` call: `head={el?.head}` (line ~471), `head={info.head}` (~548), `head={sib.head}` (~571).

- [ ] **Step 5: Run the editor suite + typecheck**

Run: `cd editor && npm test` and `npm run build`
Expected: PASS / clean build. (`use-image` handles cross-origin URLs; mc-heads serves CORS-enabled PNGs — if the Konva image stays blank in manual testing, add `crossOrigin="anonymous"` to the `useImage` call in SlotItem.)

- [ ] **Step 6: Commit**

```bash
git add editor/src/state/accountStore.ts editor/src/features/flow/headField.ts editor/src/features/flow/headField.test.ts editor/src/features/flow/FlowCanvas.tsx editor/src/features/canvas/SlotItem.tsx editor/src/features/canvas/MenuGroup.tsx editor/src/locales/en.ts editor/src/locales/fr.ts
git commit -m "feat(editor): custom head section on player_head states + live head previews"
```

---

### Task 7: Head icon fix — entity-render pipeline for skulls + data regen

**Root cause (recap):** all 7 skull items inherit `item/template_skull` whose only texture is `particle: block/soul_sand`; `gen-items.ts` falls back to it (the committed `backend/data/items/1.21.4.json` literally has `"texture": "block/soul_sand"` for every head). Heads need *entity* textures + the `__entity__/` hardcoded-geometry path used by shields/chests.

**Files:**
- Modify: `backend/scripts/gen-items.ts` (line 125, `RENDERABLE_SPECIAL_TYPES`)
- Modify: `editor/src/lib/mcModelRenderer.ts` (`ENTITY_RENDER_MAP`, ~line 290)
- Test (create): `editor/src/lib/mcModelRendererHeads.test.ts`
- Regenerate: `backend/data/items/1.21.4.json` (committed) + `backend/data/mc-assets/1.21.4/textures/icons/*.png` (gitignored)

- [ ] **Step 1: Write the failing test**

`editor/src/lib/mcModelRendererHeads.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { ENTITY_RENDER_MAP } from "./mcModelRenderer";

const HEADS: Record<string, string> = {
  player_head: "entity/player/wide/steve",
  zombie_head: "entity/zombie/zombie",
  creeper_head: "entity/creeper/creeper",
  skeleton_skull: "entity/skeleton/skeleton",
  wither_skeleton_skull: "entity/skeleton/wither_skeleton",
  piglin_head: "entity/piglin/piglin",
  dragon_head: "entity/enderdragon/dragon",
};

describe("ENTITY_RENDER_MAP head entries", () => {
  for (const [id, texture] of Object.entries(HEADS)) {
    it(`renders ${id} from ${texture}`, () => {
      const def = ENTITY_RENDER_MAP[id];
      expect(def).toBeDefined();
      expect(def!.texturePath).toBe(texture);
      expect(def!.boxes.length).toBeGreaterThan(0);
    });
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd editor && npm test -- run src/lib/mcModelRendererHeads.test.ts`
Expected: FAIL — `ENTITY_RENDER_MAP` is not exported and has no head entries.

- [ ] **Step 3: Add head geometry to mcModelRenderer**

In `editor/src/lib/mcModelRenderer.ts`, export `ENTITY_RENDER_MAP` (`export const ENTITY_RENDER_MAP …`) and add before it:

```ts
// Skull items: one 8×8×8 entity-layout cube (face region at texOffset 0,0 of the
// mob/skin texture). GUI transform from item/template_skull: rotation [30,45,0].
const HEAD_DISPLAY = { rotation: [30, 45, 0] as [number,number,number], translation: [0, 0, 0] as [number,number,number], scale: [1.1, 1.1, 1.1] as [number,number,number] };
const headDef = (texturePath: string, textureW: number, textureH: number): EntityRenderDef => ({
  textureW, textureH, texturePath,
  boxes: [{ origin: [-4, -4, -4], size: [8, 8, 8], texOffset: [0, 0] }],
  display: HEAD_DISPLAY,
});
```

Then inside `ENTITY_RENDER_MAP`, after the chest entries:

```ts
  player_head:           headDef("entity/player/wide/steve", 64, 64),
  zombie_head:           headDef("entity/zombie/zombie", 64, 64),
  creeper_head:          headDef("entity/creeper/creeper", 64, 32),
  skeleton_skull:        headDef("entity/skeleton/skeleton", 64, 32),
  wither_skeleton_skull: headDef("entity/skeleton/wither_skeleton", 64, 32),
  piglin_head:           headDef("entity/piglin/piglin", 64, 64),
  // Dragon head: approximated by the dragon model's 16³ head cube (256×256 sheet).
  dragon_head: {
    textureW: 256, textureH: 256, texturePath: "entity/enderdragon/dragon",
    boxes: [{ origin: [-8, -8, -8], size: [16, 16, 16], texOffset: [112, 30] }],
    display: { ...HEAD_DISPLAY, scale: [0.55, 0.55, 0.55] as [number,number,number] },
  },
```

(All seven textures verified present under `backend/data/mc-assets/1.21.4/textures/entity/`. Heads use the default `yFlip` entity convention like shields — do NOT set `yFlip: false`.)

- [ ] **Step 4: Run test to verify it passes**

Run: `cd editor && npm test -- run src/lib/mcModelRendererHeads.test.ts`
Expected: PASS.

- [ ] **Step 5: Route skull items into the entity path in gen-items**

`backend/scripts/gen-items.ts` line 125:

```ts
/** Special entity types rendered with Three.js hardcoded geometry. */
const RENDERABLE_SPECIAL_TYPES = new Set(["shield", "chest", "head"]);
```

(Head item defs are `minecraft:special` with `model.type: "minecraft:head"`, so `extractSpecialEntityType` already returns `"head"`; this routes them to `{ texture: "item/{id}", model: "__entity__/{id}" }`.)

- [ ] **Step 6: Regenerate items + icons for 1.21.4**

```bash
cd backend
bun scripts/gen-items.ts 1.21.4
bun scripts/gen-icons.ts 1.21.4
```

Expected: gen-icons reports the 7 heads among rendered items; `backend/data/items/1.21.4.json` now has `"texture": "icons/player_head"` etc. for all 7 (no more `block/soul_sand`). Verify:

```bash
node -e "const i=require('./data/items/1.21.4.json'); console.log(i.filter(x=>/head|skull/.test(x.id)&&!/banner|sherd/.test(x.id)).map(x=>x.id+' -> '+x.texture).join('\n'))"
```

If `backend/data/mc-assets/1.21.11/.done` exists, repeat both scripts for `1.21.11`.

- [ ] **Step 7: Visual verification (mandatory — UV offsets are the risky part)**

Use the Read tool on these PNGs and check each actually looks like the right mob head (not a UV-scrambled patchwork), with correct GUI angle (top + two sides visible):

- `backend/data/mc-assets/1.21.4/textures/icons/player_head.png` → Steve's face
- `backend/data/mc-assets/1.21.4/textures/icons/zombie_head.png` → green zombie face
- `backend/data/mc-assets/1.21.4/textures/icons/creeper_head.png` → creeper face
- `backend/data/mc-assets/1.21.4/textures/icons/dragon_head.png` → gray dragon head

If the dragon head is wrong, adjust its `texOffset` (the head cube lives in the upper-left quadrant of `dragon.png`; try `[112, 30]`, then `[0, 0]`, then `[128, 46]`) and re-run `bun scripts/gen-icons.ts 1.21.4`. If it can't be made decent in 3 attempts, fall back to `headDef("entity/enderdragon/dragon", 256, 256)` only for the face region via a flat crop: move `dragon_head` to `ENTITY_FLAT_SPECIAL_TYPES` handling instead (`ENTITY_FLAT_MAP` entry with the face rect) — and note it in the commit message.

- [ ] **Step 8: Full editor suite + commit**

Run: `cd editor && npm test` → PASS.

```bash
git add backend/scripts/gen-items.ts editor/src/lib/mcModelRenderer.ts editor/src/lib/mcModelRendererHeads.test.ts backend/data/items/1.21.4.json
git commit -m "fix(editor,backend): head items render real mob heads instead of soulsand"
```

(Add `backend/data/items/1.21.11.json` too if regenerated. The icons PNGs are gitignored — regenerated per machine.)

---

### Task 8: Docs sync + CHANGELOG

**Files:**
- Modify: `docs/architecture/schemas-codegen.md`
- Modify: `docs/architecture/editor-internals.md` (element edit / state card section)
- Create: `docs-site/src/content/docs/editor/custom-heads.md`
- Modify: `docs-site/src/content/docs/getting-started/install-admin.md` (compat/softdepend mention)
- Modify: `CHANGELOG.md` (`[Unreleased]`)

- [ ] **Step 1: schemas-codegen.md**

Add `head` to whatever field-alignment table/list documents Appearance (one line: optional string, three prefixes, hand-aligned in `docs/schema/menu/v1/types.ts`, `editor/src/domain/types.ts`, `AppearanceYaml`).

- [ ] **Step 2: editor-internals.md**

In the element-edit (state card) section, add a short paragraph: picking `PLAYER_HEAD` reveals a "custom head" row (source select + value input, auto-detects pasted `hdb:`/base64); previews resolve via `headPreviewUrl` (`editor/src/features/canvas/headTexture.ts`) → mc-heads.net; hdb ids have no preview.

- [ ] **Step 3: docs-site user page**

`docs-site/src/content/docs/editor/custom-heads.md` (EN, mirror frontmatter style of sibling pages in `docs-site/src/content/docs/editor/`):

```markdown
---
title: Custom heads
description: Use HeadDatabase ids, base64 textures, or player names as menu item heads.
---

Pick **Player Head** as an element's material and a **custom head** row appears under it.

## Sources

| Source | Value | Example |
|---|---|---|
| HeadDatabase | The numeric id from `/hdb` | `128276` |
| Base64 texture | The `textures` value from any head site (minecraft-heads.com → "Other" → Value) | `eyJ0ZXh0dXJlcyI6…` |
| Player name | A literal name or a placeholder | `Notch`, `%player%` |

Pasting a full value anywhere works: `hdb:128276` or a raw `eyJ…` base64 string is detected
and routed to the right source automatically.

## Previews

Base64 textures and literal player names show their real texture in the editor.
HeadDatabase ids show a generic player head — the editor has no access to the HeadDatabase
catalog; the real head appears in game.

## Server requirements

- `hdb:` heads require the [HeadDatabase](https://www.spigotmc.org/resources/14280/) plugin
  on the server. Without it, a plain player head is rendered and one warning is logged.
- Base64 and player-name heads work on any Paper server, no extra plugin.
- Player-name placeholders (`%player%`, `{alias.owner}`…) resolve per viewer at render time.
```

- [ ] **Step 4: install-admin.md**

In the compatibility/plugins section (where Nexo/Oraxen/ItemsAdder soft-deps are mentioned, if such a list exists), add HeadDatabase as an optional integration for `hdb:` heads. If no such list exists, skip — the editor page from Step 3 covers it.

- [ ] **Step 5: CHANGELOG**

Under `[Unreleased]` → Added:

```markdown
- `Appearance.head` (menu/v1, additive): custom heads from HeadDatabase ids (`hdb:`),
  base64 textures (`basehead:`), or player names (`playerhead:`, placeholder-aware).
  New `HeadDatabase` softdepend.
- Editor: custom-head section on PLAYER_HEAD states, with live mc-heads previews.

### Fixed
- Editor: head/skull items rendered a soulsand texture; they now render real mob heads.
```

(Merge into existing section structure as appropriate.)

- [ ] **Step 6: Commit**

```bash
git add docs/architecture/schemas-codegen.md docs/architecture/editor-internals.md docs-site/src/content/docs/editor/custom-heads.md docs-site/src/content/docs/getting-started/install-admin.md CHANGELOG.md
git commit -m "docs: custom heads — schema alignment, editor internals, user guide, changelog"
```

---

### Task 9: Final verification

- [ ] **Step 1: Full suites**

```bash
cd plugin && ./gradlew test
cd ../editor && npm test && npm run build
cd ../backend && bun run test
```

Expected: all PASS. (**Never `bun test` direct.**)

- [ ] **Step 2: Cross-check the spec**

Re-read `docs/superpowers/specs/2026-06-12-custom-heads-design.md` § by §: schema field ✓, plugin dispatch (3 sources + fallbacks + WARN-once + eyJ tolerance) ✓, editor UI + preview ✓, icon fix + regen ✓, tests ✓, docs ✓. Anything missed becomes a fix-up commit.
