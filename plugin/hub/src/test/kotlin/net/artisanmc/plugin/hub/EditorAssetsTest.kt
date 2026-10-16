package net.artisanmc.plugin.hub

import java.io.File
import java.net.URLClassLoader
import java.nio.file.Files
import kotlin.test.AfterTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

class EditorAssetsTest {
    private val jar = Files.createTempDirectory("jar").toFile().also {
        File(it, "editor/assets").mkdirs()
        File(it, "editor/index.html").writeText("jar index")
        File(it, "editor/assets/app.js").writeText("jar app")
    }
    private val loader = URLClassLoader(arrayOf(jar.toURI().toURL()), null)
    private val dir = Files.createTempDirectory("override").toFile()

    @AfterTest fun clean() { loader.close(); jar.deleteRecursively(); dir.deleteRecursively() }

    @Test fun `without a build in the folder, the jar's is served`() {
        val assets = EditorAssets(loader, overrideDir = dir)
        assertFalse(assets.overridden)
        assertEquals("jar index", assets.read("index.html")!!.decodeToString())
    }

    @Test fun `a build dropped in the folder replaces the jar's without a restart`() {
        val assets = EditorAssets(loader, overrideDir = dir)
        File(dir, "assets").mkdirs()
        File(dir, "index.html").writeText("new index")
        File(dir, "assets/app2.js").writeText("new app")
        assertTrue(assets.overridden)
        assertEquals("new index", assets.read("index.html")!!.decodeToString())
        assertEquals("new app", assets.read("assets/app2.js")!!.decodeToString())
        // The jar's files are not mixed into the folder's build.
        assertNull(assets.read("assets/app.js"))

        File(dir, "index.html").delete()
        assertEquals("jar index", assets.read("index.html")!!.decodeToString())
    }

    @Test fun `paths cannot leave the folder`() {
        File(dir, "index.html").writeText("new index")
        File(dir.parentFile, "${dir.name}-secret").writeText("secret")
        val assets = EditorAssets(loader, overrideDir = dir)
        assertNull(assets.read("../${dir.name}-secret"))
        assertNull(assets.read("/etc/passwd"))
        assertNull(assets.read("assets"))
        File(dir.parentFile, "${dir.name}-secret").delete()
    }
}
