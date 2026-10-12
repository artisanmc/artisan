package net.artisanmc.plugin

import net.artisanmc.plugin.engine.ProjectDataResolver
import net.artisanmc.plugin.model.BundleDataSource
import net.artisanmc.plugin.model.DataFieldYaml
import net.artisanmc.plugin.model.DataSourceYaml
import net.artisanmc.plugin.model.ProjectBundle
import net.artisanmc.plugin.yaml.ProjectReader
import java.io.File
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull
import kotlin.test.assertTrue

/**
 * data/v1 Project sources: reader parsing, ltext localization at resolve
 * (requested lang → default → raw key), config shape, `pack:` resolver.
 * Cf. ADR project-sources-and-data-models.
 */
class ProjectDataSourceTest {

    private fun writeTempProject(): File {
        val root = java.nio.file.Files.createTempDirectory("artisan_data_").toFile()
        val dir = File(root, "p_test").apply { mkdirs() }
        File(dir, "manifest.yaml").writeText(
            """
            schema: manifest/v1
            project_id: p_test
            default_lang: en
            languages: [en, fr]
            files:
              menus: []
              commands: []
            """.trimIndent(),
        )
        File(dir, "lang").mkdirs()
        File(dir, "lang/en.yaml").writeText(
            "sources.ranks.vip.name: VIP\nsources.ranks.vip.perks: Fly\nsources.settings.motd: Welcome\n",
        )
        File(dir, "lang/fr.yaml").writeText("sources.ranks.vip.name: V.I.P.\n")
        File(dir, "data").mkdirs()
        File(dir, "data/ranks.yaml").writeText(
            """
            schema: data/v1
            id: ranks
            shape: table
            key_field: id
            fields:
              - name: id
                kind: string
              - name: name
                kind: ltext
              - name: icon
                kind: item
              - name: perks
                kind: list
                of: { kind: ltext }
            rows:
              - id: vip
                name: sources.ranks.vip.name
                icon: "item:ci_1"
                perks: [sources.ranks.vip.perks]
            """.trimIndent(),
        )
        File(dir, "data/settings.yaml").writeText(
            """
            schema: data/v1
            id: settings
            shape: config
            fields:
              - name: currency
                kind: string
              - name: motd
                kind: ltext
            value:
              currency: coins
              motd: sources.settings.motd
            """.trimIndent(),
        )
        File(dir, "data/broken.yaml").writeText("schema: data/v99\nid: broken\n")
        return root
    }

    @Test
    fun `reader parses data sources and skips unsupported schema versions`() {
        val bundles = ProjectReader(writeTempProject()).readAll()
        val bundle = bundles.single()
        assertEquals(listOf("ranks", "settings"), bundle.dataSources.map { it.id }.sorted())
        val ranks = bundle.dataSources.first { it.id == "ranks" }
        assertEquals("id", ranks.yaml.keyField)
        assertEquals("ltext", ranks.yaml.fields.first { it.name == "perks" }.of?.kind)
    }

    @Test
    fun `resolved localizes ltext fields with per-key fallback chain`() {
        val bundle = ProjectReader(writeTempProject()).readAll().single()
        val ranks = bundle.dataSources.first { it.id == "ranks" }
        @Suppress("UNCHECKED_CAST")
        val fr = (ranks.resolved("fr") as List<Map<String, Any?>>).single()
        assertEquals("V.I.P.", fr["name"])
        // perks has no fr entry → falls back to the default lang's value.
        assertEquals(listOf("Fly"), fr["perks"])
        // Non-ltext values pass through verbatim.
        assertEquals("item:ci_1", fr["icon"])
        assertEquals("vip", fr["id"])
    }

    @Test
    fun `unknown translation falls back to the raw key (non-hermetic)`() {
        val ds = BundleDataSource(
            yaml = DataSourceYaml(
                id = "x", shape = "table",
                fields = listOf(DataFieldYaml(name = "label", kind = "ltext")),
                rows = listOf(mapOf("label" to "sources.x.k1.label")),
            ),
            langMaps = mapOf("en" to emptyMap()),
            defaultLang = "en",
        )
        @Suppress("UNCHECKED_CAST")
        val row = (ds.resolved("en") as List<Map<String, Any?>>).single()
        assertEquals("sources.x.k1.label", row["label"])
    }

    @Test
    fun `config shape resolves to the localized value object`() {
        val bundle = ProjectReader(writeTempProject()).readAll().single()
        val settings = bundle.dataSources.first { it.id == "settings" }
        @Suppress("UNCHECKED_CAST")
        val value = settings.resolved("en") as Map<String, Any?>
        assertEquals("coins", value["currency"])
        assertEquals("Welcome", value["motd"])
    }

    @Test
    fun `resolver serves project refs from the bundle list and null otherwise`() {
        val bundle = ProjectReader(writeTempProject()).readAll().single()
        val resolver = ProjectDataResolver { listOf(bundle) }
        assertTrue(resolver.canResolve("pack:ranks"))
        @Suppress("UNCHECKED_CAST")
        val rows = resolver.resolve("pack:ranks", "en") as List<Map<String, Any?>>
        assertEquals("VIP", rows.single()["name"])
        assertNull(resolver.resolve("pack:missing", "en"))
        assertNull(resolver.resolve("shop:items", "en"))
    }

    @Test
    fun `resolver searches across projects`() {
        val empty = ProjectBundle("p_empty", "en", listOf("en"), emptyList(), emptyList(), emptyList())
        val bundle = ProjectReader(writeTempProject()).readAll().single()
        val resolver = ProjectDataResolver { listOf(empty, bundle) }
        @Suppress("UNCHECKED_CAST")
        val value = resolver.resolve("pack:settings", "en") as Map<String, Any?>
        assertEquals("coins", value["currency"])
    }

    @Test
    fun `per-row granularity dir aggregates row files in declared order, hand-added appended`() {
        val root = java.nio.file.Files.createTempDirectory("artisan_data_pr_").toFile()
        val dir = File(root, "p_pr").apply { mkdirs() }
        File(dir, "manifest.yaml").writeText(
            """
            schema: manifest/v1
            project_id: p_pr
            default_lang: en
            languages: [en]
            files:
              menus: []
              commands: []
            """.trimIndent(),
        )
        val srcDir = File(dir, "data/cats").apply { mkdirs() }
        File(srcDir, "_source.yaml").writeText(
            """
            schema: data/v1
            id: cats
            shape: table
            key_field: id
            granularity: row
            order: [weekly, daily]
            fields:
              - name: id
                kind: string
              - name: label
                kind: string
            """.trimIndent(),
        )
        File(srcDir, "daily.yaml").writeText("id: daily\nlabel: D\n")
        File(srcDir, "weekly.yaml").writeText("id: weekly\nlabel: W\n")
        File(srcDir, "handmade.yaml").writeText("id: handmade\nlabel: H\n")

        val bundle = ProjectReader(root).readAll().single()
        val cats = bundle.dataSources.first { it.id == "cats" }
        @Suppress("UNCHECKED_CAST")
        val rows = cats.resolved("en") as List<Map<String, Any?>>
        assertEquals(listOf("weekly", "daily", "handmade"), rows.map { it["id"] })
    }

    // ── composable kinds: map / enum / union (ADR composable-data-models) ──

    @Test
    fun `ltext inside map values and union variants localizes at resolve`() {
        val root = java.nio.file.Files.createTempDirectory("artisan_data_ck_").toFile()
        val dir = File(root, "p_ck").apply { mkdirs() }
        File(dir, "manifest.yaml").writeText(
            """
            schema: manifest/v1
            project_id: p_ck
            default_lang: en
            languages: [en]
            files:
              menus: []
              commands: []
            """.trimIndent(),
        )
        File(dir, "lang").mkdirs()
        File(dir, "lang/en.yaml").writeText(
            "sources.quests.daily.tiers.gold.act.text: Well done!\n",
        )
        File(dir, "data").mkdirs()
        File(dir, "data/quests.yaml").writeText(
            """
            schema: data/v1
            id: quests
            shape: table
            key_field: id
            fields:
              - name: id
                kind: string
              - name: strategy
                kind: enum
                values: [sequential, random]
              - name: tiers
                kind: map
                of:
                  kind: object
                  fields:
                    - name: act
                      kind: union
                      tag: type
                      variants:
                        - name: message
                          fields:
                            - name: text
                              kind: ltext
                        - name: command
                          fields:
                            - name: run
                              kind: string
            rows:
              - id: daily
                strategy: sequential
                tiers:
                  gold:
                    act: { type: message, text: sources.quests.daily.tiers.gold.act.text }
                  silver:
                    act: { type: command, run: say hi }
            """.trimIndent(),
        )
        val bundle = ProjectReader(root).readAll().single()
        val quests = bundle.dataSources.first { it.id == "quests" }
        @Suppress("UNCHECKED_CAST")
        val row = (quests.resolved("en") as List<Map<String, Any?>>).single()
        // enum passes through verbatim.
        assertEquals("sequential", row["strategy"])
        @Suppress("UNCHECKED_CAST")
        val tiers = row["tiers"] as Map<String, Map<String, Any?>>
        @Suppress("UNCHECKED_CAST")
        val goldAct = tiers["gold"]!!["act"] as Map<String, Any?>
        // ltext inside the active union variant, inside a map value → localized.
        assertEquals("Well done!", goldAct["text"])
        assertEquals("message", goldAct["type"])
        @Suppress("UNCHECKED_CAST")
        val silverAct = tiers["silver"]!!["act"] as Map<String, Any?>
        // Other variant untouched (no ltext fields).
        assertEquals("say hi", silverAct["run"])
    }
}
