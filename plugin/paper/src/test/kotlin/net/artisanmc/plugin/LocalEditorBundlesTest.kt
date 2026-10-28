package net.artisanmc.plugin

import net.artisanmc.modules.api.editor.EditorBundleDeclaration
import net.artisanmc.modules.api.editor.EditorBundleRegistry
import java.nio.file.Files
import java.util.logging.Logger
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertSame
import kotlin.test.assertTrue

/** `dev.editor-bundles`: a module's editor view read from a file instead of its jar. */
class LocalEditorBundlesTest {
    private val jar = EditorBundleDeclaration("export default { id: \"quests\" };".toByteArray(), "1.2")
    private val registry = EditorBundleRegistry().apply {
        bindOwner("quests")
        register(jar)
        bindOwner(null)
    }
    private val dir = Files.createTempDirectory("local-bundles").toFile()
    private val file = dir.resolve("ui.js")
    private val bundles = LocalEditorBundles(registry, Logger.getAnonymousLogger(), dir)

    @Test fun `without an entry the jar's bundle is served, unmarked`() {
        assertSame(jar, bundles.find("quests"))
        assertEquals(jar.toWire(), bundles.wire("quests"))
        assertNull(bundles.find("shop"))
    }

    @Test fun `the file is served with the jar's SDK version and marked local`() {
        file.writeText("export default { id: \"quests\", v: 1 };")
        bundles.configure(mapOf("quests" to "ui.js"))
        val local = bundles.find("quests")!!
        assertEquals("export default { id: \"quests\", v: 1 };", String(local.script))
        assertEquals("1.2", local.sdk)
        assertEquals(true, bundles.wire("quests")!!["local"])
        assertEquals(local.hash, bundles.wire("quests")!!["hash"])
    }

    @Test fun `a changed file is seen by refresh, with a new hash`() {
        file.writeText("export default { v: 1 };")
        bundles.configure(mapOf("quests" to file.path))
        val first = bundles.find("quests")!!.hash
        assertFalse(bundles.refresh())
        file.writeText("export default { v: 22 };")
        file.setLastModified(file.lastModified() + 2_000)
        assertTrue(bundles.refresh())
        assertTrue(bundles.find("quests")!!.hash != first)
    }

    @Test fun `a missing or empty file falls back to the jar`() {
        bundles.configure(mapOf("quests" to "absent.js"))
        assertSame(jar, bundles.find("quests"))
        assertEquals(jar.toWire(), bundles.wire("quests"))
        file.writeText("")
        bundles.configure(mapOf("quests" to file.path))
        assertSame(jar, bundles.find("quests"))
    }

    @Test fun `a module without a registered bundle is not served from a file`() {
        file.writeText("export default {};")
        bundles.configure(mapOf("shop" to file.path))
        assertNull(bundles.find("shop"))
    }
}
