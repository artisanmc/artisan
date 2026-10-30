package net.artisanmc.modules.api.text

import org.junit.jupiter.api.DynamicTest
import org.junit.jupiter.api.TestFactory
import org.yaml.snakeyaml.Yaml
import java.io.File
import kotlin.test.assertEquals

/**
 * Plugin half of `testdata/overlay-layout-conformance.json`; the editor's port asserts the same
 * vector. Read with SnakeYAML, as a module reads its files: `1.5` stays a Double, `-130` an Integer.
 */
class OverlayLayoutConformanceTest {

    @Suppress("UNCHECKED_CAST")
    private val vector: Map<String, Any?> by lazy {
        var dir: File? = File(System.getProperty("user.dir")).absoluteFile
        while (dir != null) {
            val f = File(dir, "testdata/overlay-layout-conformance.json")
            if (f.exists()) return@lazy Yaml().load<Map<String, Any?>>(f.readText())
            dir = dir.parentFile
        }
        error("testdata/overlay-layout-conformance.json not found")
    }

    @Suppress("UNCHECKED_CAST")
    private fun cases(section: String) = vector[section] as List<Map<String, Any?>>

    @TestFactory
    fun read(): List<DynamicTest> = cases("read").map { c ->
        DynamicTest.dynamicTest(c["name"] as String) {
            val read = OverlayLayout.read(c["layout"])
            @Suppress("UNCHECKED_CAST")
            val problems = (c["problems"] as List<Map<String, String>>).map { it["path"] to it["code"] }
            assertEquals(problems, read.problems().map { it.path() to it.code() })
            assertEquals(c["layers"], read.layout().layers.size)
            @Suppress("UNCHECKED_CAST")
            val images = c["pack_images"] as List<Map<String, Any>>
            assertEquals(images, read.layout().packImages.map { p ->
                buildMap {
                    put("asset", p.asset())
                    p.rise()?.let { put("rise", it) }
                    p.bottom()?.let { put("bottom", it) }
                }
            })
        }
    }

    @Suppress("UNCHECKED_CAST")
    @TestFactory
    fun plan(): List<DynamicTest> = cases("plan").map { c ->
        DynamicTest.dynamicTest(c["name"] as String) {
            val read = OverlayLayout.read(c["layout"])
            assertEquals(emptyList(), read.problems())
            val src = c["content"] as Map<String, Map<String, Any>>
            val content = OverlayContent.builder().apply {
                src["text"]!!.forEach { (slot, rows) -> text(slot, rows as List<String>) }
                src["lists"]!!.forEach { (slot, value) ->
                    val l = value as Map<String, Any>
                    rows(slot, l["rows"] as List<String>, l["selected"] as Int, l["top"] as Int)
                }
                src["images"]!!.forEach { (slot, value) ->
                    if (value is String) image(slot, value)
                    else {
                        val m = value as Map<String, Any>
                        image(slot, m["image"] as String, (m["x"] as Int?) ?: 0, (m["y"] as Int?) ?: 0)
                    }
                }
            }.build()
            val perChar = vector["width_per_char"] as Int
            val heights = c["heights"] as Map<String, Int>
            val plan = OverlayPlan.plan(read.layout(), content, { it.length * perChar }, { heights[it] ?: -1 })
            val draws = (c["draws"] as List<Map<String, Any>>).map {
                OverlayPlan.Draw(it["image"] as Boolean, it["content"] as String, it["x"] as Int, it["rise"] as Int)
            }
            assertEquals(draws, plan.draws())
            assertEquals(c["missing"], plan.missing())
        }
    }
}
