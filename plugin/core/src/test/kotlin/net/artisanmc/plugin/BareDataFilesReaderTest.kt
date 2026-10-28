package net.artisanmc.plugin

import net.artisanmc.plugin.yaml.ProjectReader
import java.io.File
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull

/**
 * ADR bare-data-files: a data file may be PURE VALUES — mapping = object
 * (config), list = table — with the schema resolved beside it (JAR
 * declaration via the declared-models supplier, or models/<id>.yaml with
 * fields or a `model:` ref), untyped fallback otherwise. `_source.yaml` is
 * optional for per-row dirs. Legacy inline `schema: data/v1` files keep
 * working untouched (covered by ProjectDataSourceTest).
 */
class BareDataFilesReaderTest {

    private fun writeProject(langFr: String = ""): File {
        val root = java.nio.file.Files.createTempDirectory("artisan_bare_").toFile()
        val dir = File(root, "p_bare").apply { mkdirs() }
        File(dir, "manifest.yaml").writeText(
            """
            schema: manifest/v1
            project_id: p_bare
            default_lang: en
            languages: [en, fr]
            files:
              menus: []
              commands: []
            """.trimIndent(),
        )
        if (langFr.isNotEmpty()) {
            File(dir, "lang").mkdirs()
            File(dir, "lang/fr.yaml").writeText(langFr)
        }
        File(dir, "data").mkdirs()
        return dir
    }

    private fun read(dir: File, declared: Map<String, Map<String, Any?>> = emptyMap()) =
        ProjectReader(dir.parentFile, null, { declared }).readAll().single()

    @Test
    fun `bare mapping file is an object source, id from filename, values literal`() {
        val dir = writeProject()
        File(dir, "data/shop_settings.yaml").writeText("whole_shop_discount: 10\nmotd: \"Bienvenue\"\n")

        val src = read(dir).dataSources.single()
        assertEquals("shop_settings", src.id)
        @Suppress("UNCHECKED_CAST")
        val value = src.resolved("en") as Map<String, Any?>
        assertEquals(10, value["whole_shop_discount"])
        assertEquals("Bienvenue", value["motd"])
    }

    @Test
    fun `bare list file is a table source with untyped literal rows`() {
        val dir = writeProject()
        File(dir, "data/warps.yaml").writeText(
            """
            - id: spawn
              name: "Le spawn"
            - id: arena
              name: "L'arène"
            """.trimIndent(),
        )

        val src = read(dir).dataSources.single()
        assertEquals("warps", src.id)
        @Suppress("UNCHECKED_CAST")
        val rows = src.resolved("en") as List<Map<String, Any?>>
        assertEquals(listOf("spawn", "arena"), rows.map { it["id"] })
        assertEquals("Le spawn", rows[0]["name"])
    }

    @Test
    fun `models slash sourceId types a bare table — ltext resolves lang key or passes literal`() {
        val dir = writeProject(langFr = "sources.ranks.vip.name: V.I.P.\n")
        File(dir, "models").mkdirs()
        File(dir, "models/ranks.yaml").writeText(
            """
            schema: model/v1
            id: ranks
            fields:
              - name: id
                kind: string
              - name: name
                kind: ltext
            """.trimIndent(),
        )
        // One row's name is a minted key present in lang/fr, the other a literal.
        File(dir, "data/ranks.yaml").writeText(
            """
            - id: vip
              name: sources.ranks.vip.name
            - id: mvp
              name: "MVP direct"
            """.trimIndent(),
        )

        val src = read(dir).dataSources.single()
        @Suppress("UNCHECKED_CAST")
        val fr = src.resolved("fr") as List<Map<String, Any?>>
        assertEquals("V.I.P.", fr[0]["name"])      // key found in lang → resolved
        assertEquals("MVP direct", fr[1]["name"])  // literal passes through
    }

    @Test
    fun `models slash sourceId may be a one-line ref to a JAR-declared model`() {
        val dir = writeProject(langFr = "sources.categories.armes.name: Armes FR\n")
        File(dir, "models").mkdirs()
        File(dir, "models/categories.yaml").writeText("model: boutique:category\n")
        File(dir, "data/categories.yaml").writeText(
            """
            - id: armes
              name: sources.categories.armes.name
            """.trimIndent(),
        )
        val declared = mapOf(
            "boutique:category" to mapOf(
                "id" to "boutique:category",
                "fields" to listOf(
                    mapOf("name" to "id", "kind" to "string"),
                    mapOf("name" to "name", "kind" to "ltext"),
                ),
            ),
        )

        val src = read(dir, declared).dataSources.single()
        @Suppress("UNCHECKED_CAST")
        val fr = src.resolved("fr") as List<Map<String, Any?>>
        assertEquals("Armes FR", fr[0]["name"])
    }

    @Test
    fun `per-row dir without _source yaml — rows are all files sorted by name`() {
        val dir = writeProject()
        File(dir, "data/kits").mkdirs()
        File(dir, "data/kits/beta.yaml").writeText("id: beta\n")
        File(dir, "data/kits/alpha.yaml").writeText("id: alpha\n")

        val src = read(dir).dataSources.single()
        assertEquals("kits", src.id)
        @Suppress("UNCHECKED_CAST")
        val rows = src.resolved("en") as List<Map<String, Any?>>
        assertEquals(listOf("alpha", "beta"), rows.map { it["id"] })
    }

    @Test
    fun `minimal _source yaml — model ref plus order, no fields`() {
        val dir = writeProject(langFr = "sources.categories.armes.name: Armes FR\n")
        File(dir, "data/categories").mkdirs()
        File(dir, "data/categories/_source.yaml").writeText("model: boutique:category\norder: [outils, armes]\n")
        File(dir, "data/categories/armes.yaml").writeText("id: armes\nname: sources.categories.armes.name\n")
        File(dir, "data/categories/outils.yaml").writeText("id: outils\nname: \"Outils\"\n")
        val declared = mapOf(
            "boutique:category" to mapOf(
                "id" to "boutique:category",
                "fields" to listOf(
                    mapOf("name" to "id", "kind" to "string"),
                    mapOf("name" to "name", "kind" to "ltext"),
                ),
            ),
        )

        val src = read(dir, declared).dataSources.single()
        @Suppress("UNCHECKED_CAST")
        val fr = src.resolved("fr") as List<Map<String, Any?>>
        assertEquals(listOf("outils", "armes"), fr.map { it["id"] })  // declared order respected
        assertEquals("Armes FR", fr[1]["name"])                       // typed via JAR declaration
        assertEquals("Outils", fr[0]["name"])                          // literal passes
    }

    @Test
    fun `editor-verbatim model doc shape (name plus type) is flattened and types the source`() {
        val dir = writeProject(langFr = "sources.ranks.vip.name: V.I.P.\n")
        File(dir, "models").mkdirs()
        // The editor emits model/v1 fields VERBATIM: `{name, type: {kind}}`.
        File(dir, "models/ranks.yaml").writeText(
            """
            schema: model/v1
            id: ranks
            fields:
              - name: id
                type: { kind: string }
              - name: name
                type: { kind: ltext }
              - name: perks
                type:
                  kind: list
                  of: { kind: ltext }
            """.trimIndent(),
        )
        File(dir, "data/ranks.yaml").writeText(
            """
            - id: vip
              name: sources.ranks.vip.name
              perks: ["Voler"]
            """.trimIndent(),
        )

        val src = read(dir).dataSources.single()
        @Suppress("UNCHECKED_CAST")
        val fr = src.resolved("fr") as List<Map<String, Any?>>
        assertEquals("V.I.P.", fr[0]["name"])
        assertEquals(listOf("Voler"), fr[0]["perks"])
    }

    @Test
    fun `literal ltext resolves other languages BY ADDRESS (canonical key site)`() {
        // ADR bare-data-files ④: the data file inlines the default language's
        // literal; other languages live in lang/ under
        // sources.<sourceId>.<rowKey>.<fieldPath> — the runtime derives the
        // address during the walk.
        val dir = writeProject(
            langFr = "sources.categories.armes.name: Armes FR\nsources.categories.armes.items.name: Épée\n",
        )
        File(dir, "models").mkdirs()
        File(dir, "models/categories.yaml").writeText(
            """
            schema: model/v1
            id: categories
            fields:
              - name: id
                kind: string
              - name: name
                kind: ltext
              - name: items
                kind: list
                of:
                  kind: object
                  fields:
                    - name: name
                      kind: ltext
            """.trimIndent(),
        )
        File(dir, "data/categories.yaml").writeText(
            """
            - id: armes
              name: "Weapons"
              items:
                - name: "Sword"
            """.trimIndent(),
        )

        val src = read(dir).dataSources.single()
        @Suppress("UNCHECKED_CAST")
        val fr = src.resolved("fr") as List<Map<String, Any?>>
        assertEquals("Armes FR", fr[0]["name"])
        @Suppress("UNCHECKED_CAST")
        val items = fr[0]["items"] as List<Map<String, Any?>>
        assertEquals("Épée", items[0]["name"])
        // Default language keeps the literal.
        @Suppress("UNCHECKED_CAST")
        val en = src.resolved("en") as List<Map<String, Any?>>
        assertEquals("Weapons", en[0]["name"])
    }

    @Test
    fun `a mapping with an unrelated schema-like key stays a bare object`() {
        val dir = writeProject()
        // "schema" here is USER DATA (not `data/v1`): only the exact legacy header
        // switches to the legacy path.
        File(dir, "data/db.yaml").writeText("schema: public\nhost: localhost\n")

        val src = read(dir).dataSources.single()
        @Suppress("UNCHECKED_CAST")
        val value = src.resolved("en") as Map<String, Any?>
        assertEquals("public", value["schema"])
        assertEquals("localhost", value["host"])
    }

    @Test
    fun `legacy per-row _source yaml with inline fields still works`() {
        val dir = writeProject(langFr = "sources.cats.a.name: A FR\n")
        File(dir, "data/cats").mkdirs()
        File(dir, "data/cats/_source.yaml").writeText(
            """
            schema: data/v1
            id: cats
            shape: table
            key_field: id
            order: [a]
            fields:
              - name: id
                kind: string
              - name: name
                kind: ltext
            """.trimIndent(),
        )
        File(dir, "data/cats/a.yaml").writeText("id: a\nname: sources.cats.a.name\n")

        val src = read(dir).dataSources.single()
        assertNotNull(src)
        @Suppress("UNCHECKED_CAST")
        val fr = src.resolved("fr") as List<Map<String, Any?>>
        assertEquals("A FR", fr[0]["name"])
    }
}
