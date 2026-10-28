package net.artisanmc.modules.api

import java.io.File
import java.lang.reflect.Modifier
import kotlin.test.Test
import kotlin.test.fail

/**
 * The public surface `net.artisanmc.modules.api.**` is Java (API 2.0.0): an add-on compiles
 * against `artisan-core-api` without kotlin-stdlib, and no `kotlin.*` type can leak into a
 * signature, where it would make an add-on resolve it through the server's global plugin
 * lookup and die with a `LinkageError` on the first cross-plugin call (2026-08-08).
 *
 * Only the tests of the module are Kotlin.
 */
class ApiSurfaceIsJavaFriendlyTest {

    @Test
    fun `the api main classes are compiled from java`() {
        val kotlinClasses = apiClassRoots().filter { it.path.replace('\\', '/').contains("/classes/kotlin/main/") }
            .flatMap { dir -> dir.walkTopDown().filter { it.isFile && it.extension == "class" }.toList() }
        if (kotlinClasses.isNotEmpty()) {
            fail("Kotlin classes in the api main source set (the surface is Java):\n" +
                kotlinClasses.sorted().joinToString("\n") { "  - $it" })
        }
        val offenders = apiClasses().filter { cls -> cls.annotations.any { it.annotationClass.java.name == "kotlin.Metadata" } }
        if (offenders.isNotEmpty()) {
            fail("Kotlin-compiled classes in the api:\n" + offenders.map { it.name }.sorted().joinToString("\n") { "  - $it" })
        }
    }

    @Test
    fun `no kotlin type appears in a public api signature`() {
        val offenders = mutableListOf<String>()

        for (cls in apiClasses()) {
            if (!Modifier.isPublic(cls.modifiers)) continue

            for (m in cls.declaredMethods) {
                if (!Modifier.isPublic(m.modifiers) || m.isSynthetic || m.isBridge) continue
                (m.parameterTypes.toList() + m.returnType).forEach { t ->
                    if (isKotlin(t)) offenders += "${cls.name}#${m.name} → ${t.name}"
                }
            }
            for (c in cls.declaredConstructors) {
                if (!Modifier.isPublic(c.modifiers) || c.isSynthetic) continue
                c.parameterTypes.forEach { t ->
                    if (isKotlin(t)) offenders += "${cls.name}#<init> → ${t.name}"
                }
            }
            for (f in cls.declaredFields) {
                if (!Modifier.isPublic(f.modifiers) || f.isSynthetic) continue
                if (isKotlin(f.type)) offenders += "${cls.name}.${f.name} → ${f.type.name}"
            }
        }

        if (offenders.isNotEmpty()) {
            fail("Kotlin types in the modules.api public surface:\n" +
                offenders.sorted().joinToString("\n") { "  - $it" })
        }
    }

    private fun isKotlin(t: Class<*>): Boolean =
        generateSequence(t) { if (it.isArray) it.componentType else null }
            .last()
            .name.startsWith("kotlin.")

    /** The test classpath has several roots for this package (main + test); only main is the published surface. */
    private fun apiClassRoots(): List<File> {
        val roots = javaClass.classLoader.getResources("net/artisanmc/modules/api").toList()
            .map { File(it.toURI()) }
            .filter { it.path.replace('\\', '/').contains("/classes/") && it.path.replace('\\', '/').contains("/main/") }
        check(roots.isNotEmpty()) { "modules.api main classes not found on the classpath" }
        return roots
    }

    private fun apiClasses(): List<Class<*>> =
        apiClassRoots().flatMap { dir ->
            val pkgRoot = generateSequence(dir) { it.parentFile }.first { it.name == "main" }
            dir.walkTopDown()
                .filter { it.isFile && it.extension == "class" }
                .map { it.relativeTo(pkgRoot).path.replace(File.separatorChar, '.').removeSuffix(".class") }
                .mapNotNull { runCatching { Class.forName(it, false, javaClass.classLoader) }.getOrNull() }
                .toList()
        }
}
