package net.artisanmc.plugin

import net.artisanmc.plugin.yaml.ProjectReader
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.io.TempDir
import java.io.File
import java.util.logging.Handler
import java.util.logging.Level
import java.util.logging.LogRecord
import java.util.logging.Logger

/**
 * Pins the WARN wiring end-to-end: ProjectReader.readProject() diffs lang-map
 * keys against LangKeyAuditor.referencedKeys and warns once per project when
 * orphans exist — silent when everything is referenced.
 */
class OrphanLangKeyWarnTest {

    private class RecordingHandler : Handler() {
        val records = mutableListOf<LogRecord>()
        override fun publish(record: LogRecord) { records.add(record) }
        override fun flush() {}
        override fun close() {}
    }

    private fun writeProject(root: File, projectId: String, langYaml: String): File {
        val proj = File(root, projectId).apply { mkdirs() }
        File(proj, "manifest.yaml").writeText(
            """
            schema: manifest/v1
            project_id: $projectId
            default_lang: en
            languages: [en]
            files:
              menus: [shop]
              commands: []
              dialogs: []
            """.trimIndent()
        )
        File(proj, "menus").mkdirs()
        File(proj, "menus/shop.yaml").writeText(
            """
            schema: menu/v1
            id: shop
            title:
              - kind: text
                value:
                  key: menus.shop.title
                x: 8
                y: 5
            size: 27
            layers: []
            """.trimIndent()
        )
        File(proj, "lang").mkdirs()
        File(proj, "lang/en.yaml").writeText(langYaml)
        return proj
    }

    @Test
    fun `warns once with orphan key and without referenced key`(@TempDir root: File) {
        writeProject(
            root,
            "orphan_proj",
            """
            menus.shop.title: "Shop"
            menus.shop.unused: "Never referenced"
            """.trimIndent()
        )

        val logger = Logger.getLogger("OrphanLangKeyWarnTest.orphan")
        logger.useParentHandlers = false
        val handler = RecordingHandler()
        logger.addHandler(handler)

        ProjectReader(root, logger).readAll()

        val warnings = handler.records.filter { it.level == Level.WARNING }
        assertEquals(1, warnings.size)
        val message = warnings.single().message
        assertTrue(message.contains("menus.shop.unused"))
        assertTrue(!message.contains("menus.shop.title"))
    }

    @Test
    fun `no orphans logs nothing`(@TempDir root: File) {
        writeProject(
            root,
            "clean_proj",
            """
            menus.shop.title: "Shop"
            """.trimIndent()
        )

        val logger = Logger.getLogger("OrphanLangKeyWarnTest.clean")
        logger.useParentHandlers = false
        val handler = RecordingHandler()
        logger.addHandler(handler)

        ProjectReader(root, logger).readAll()

        assertEquals(0, handler.records.filter { it.level == Level.WARNING }.size)
    }
}
