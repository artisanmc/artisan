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

    /**
     * An interface member with a Kotlin body must be a JVM default method, or a Java
     * implementer has to write it (`ArtisanModule.onReload()` before 1.8.0).
     * Its `DefaultImpls` twin stays for add-ons compiled before (all-compatibility).
     */
    @Test
    fun `interface members with a body are java default methods`() {
        val offenders = mutableListOf<String>()
        for (impls in apiClasses().filter { it.simpleName == "DefaultImpls" }) {
            val itf = impls.enclosingClass ?: continue
            // `$default` / `$annotations` are Kotlin helpers, not members.
            for (m in impls.declaredMethods.filter { Modifier.isStatic(it.modifiers) && Modifier.isPublic(it.modifiers) && '$' !in it.name }) {
                val params = m.parameterTypes.drop(1).toTypedArray()
                val declared = runCatching { itf.getDeclaredMethod(m.name, *params) }.getOrNull()
                if (declared == null || !declared.isDefault) offenders += "${itf.name}#${m.name}"
            }
        }
        if (offenders.isNotEmpty()) fail("Not JVM default methods (-Xjvm-default):\n" + offenders.sorted().joinToString("\n") { "  - $it" })
    }

    /**
     * A constructor with Kotlin default arguments must have `@JvmOverloads`: Java has no
     * default arguments, and passing every `null` by hand is how add-ons broke on new fields.
     * [ArtisanAPI] is only constructed by Artisan.
     */
    @Test
    fun `constructors with default arguments have java overloads`() {
        val offenders = apiClasses()
            .filter { Modifier.isPublic(it.modifiers) && it != ArtisanAPI::class.java }
            .filter { cls -> cls.declaredConstructors.any { c -> c.isSynthetic && c.parameterTypes.lastOrNull()?.name == "kotlin.jvm.internal.DefaultConstructorMarker" } }
            .filter { cls -> cls.constructors.count { !it.isSynthetic } < 2 }
            .map { it.name }
        if (offenders.isNotEmpty()) fail("Add @JvmOverloads to the constructor of:\n" + offenders.sorted().joinToString("\n") { "  - $it" })
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
