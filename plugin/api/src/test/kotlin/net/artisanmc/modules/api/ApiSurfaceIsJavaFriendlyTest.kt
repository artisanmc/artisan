package net.artisanmc.modules.api

import java.io.File
import java.lang.reflect.Modifier
import kotlin.test.Test
import kotlin.test.fail

/**
 * The public surface `net.artisanmc.modules.api.**` must expose NO `kotlin.*` type
 * in its signatures.
 *
 * Two reasons, the second much harder than the first:
 *
 * 1. An add-on must be able to compile against `artisan-core-api` without bundling
 *    or declaring kotlin-stdlib.
 * 2. A `kotlin.*` type in a public signature makes an add-on resolve it through the
 *    server's global plugin lookup, where it can pick up another Kotlin plugin's
 *    copy: the first cross-plugin call then dies with a `LinkageError`. The stdlib
 *    cannot simply be relocated instead (see the shadowJar notes in
 *    paper/build.gradle.kts).
 *
 * The implementation stays in Kotlin: only signatures crossing the boundary are
 * constrained.
 */
class ApiSurfaceIsJavaFriendlyTest {

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
                offenders.sorted().joinToString("\n") { "  - $it" } +
                "\nReplace with a `fun interface` from the api package, a java.util.function type, or Runnable.")
        }
    }

    /** `kotlin.Metadata` stays, but as an annotation, never in a signature. */
    private fun isKotlin(t: Class<*>): Boolean =
        generateSequence(t) { if (it.isArray) it.componentType else null }
            .last()
            .name.startsWith("kotlin.")

    /** The test classpath has two roots for this package (main + test); only main is the published surface. */
    private fun apiClasses(): List<Class<*>> {
        val roots = javaClass.classLoader.getResources("net/artisanmc/modules/api").toList()
            .map { File(it.toURI()) }
            .filter { it.path.replace('\\', '/').contains("/classes/kotlin/main/") }
        check(roots.isNotEmpty()) { "modules.api main classes not found on the classpath" }

        return roots.flatMap { dir ->
            val pkgRoot = generateSequence(dir) { it.parentFile }.first { it.name == "main" }
            dir.walkTopDown()
                .filter { it.isFile && it.extension == "class" }
                .map { it.relativeTo(pkgRoot).path.replace(File.separatorChar, '.').removeSuffix(".class") }
                .mapNotNull { runCatching { Class.forName(it, false, javaClass.classLoader) }.getOrNull() }
                .toList()
        }
    }
}
