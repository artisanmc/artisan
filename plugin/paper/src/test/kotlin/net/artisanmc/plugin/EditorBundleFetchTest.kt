package net.artisanmc.plugin

import com.fasterxml.jackson.databind.ObjectMapper
import net.artisanmc.modules.api.editor.EditorBundleDeclaration
import net.artisanmc.modules.api.editor.EditorBundleRegistry
import net.artisanmc.plugin.project.ProjectRoots
import net.artisanmc.plugin.provider.SyncedMenuProvider
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test
import java.nio.file.Files
import java.util.concurrent.LinkedBlockingQueue
import java.util.concurrent.TimeUnit

/** `editor_bundle_fetch`: the server hands a module's editor view to the hub (protocol 1.2). */
class EditorBundleFetchTest {
    private val script = "export default { id: \"quests\", label: \"Quêtes\" };\n"
    private val registry = EditorBundleRegistry().apply {
        bindOwner("quests")
        register(EditorBundleDeclaration(script.toByteArray(), "1.0"))
        bindOwner(null)
    }

    private fun fetch(json: String): Map<*, *> {
        val provider = SyncedMenuProvider(
            roots = ProjectRoots(Files.createTempDirectory("bundle-fetch").toFile()),
            logger = null,
            editorBundles = registry::find,
        )
        provider.load()
        val replies = LinkedBlockingQueue<Map<*, *>>()
        provider.setSendForTesting { replies.add(ObjectMapper().readValue(it, Map::class.java)) }
        provider.handleMessageForTesting(json)
        return replies.poll(5, TimeUnit.SECONDS) ?: error("no reply")
    }

    @Test fun `replies the script as text with its hash and SDK version`() {
        val reply = fetch("""{"type":"editor_bundle_fetch","request_id":"b1","module_id":"quests"}""")
        assertEquals("editor_bundle_fetch_result", reply["type"])
        assertEquals("b1", reply["request_id"])
        assertEquals(true, reply["ok"])
        assertEquals("quests", reply["module_id"])
        assertEquals("1.0", reply["sdk"])
        assertEquals(registry.find("quests")!!.hash, reply["hash"])
        assertEquals(script, reply["content"])
    }

    @Test fun `a module without a bundle is not_found`() {
        val reply = fetch("""{"type":"editor_bundle_fetch","request_id":"b2","module_id":"shop"}""")
        assertEquals(false, reply["ok"])
        assertEquals("not_found", reply["error"])
    }
}
