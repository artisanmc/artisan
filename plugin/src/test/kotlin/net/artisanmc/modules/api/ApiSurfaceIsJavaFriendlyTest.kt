package net.artisanmc.modules.api

import java.io.File
import java.lang.reflect.Modifier
import kotlin.test.Test
import kotlin.test.fail

/**
 * La surface publique `net.artisanmc.modules.api.**` ne doit exposer AUCUN type
 * `kotlin.*` dans ses signatures.
 *
 * Deux raisons, la seconde bien plus dure que la première :
 *
 * ① Un add-on doit pouvoir compiler contre `artisan-core-api` sans embarquer ni
 *    déclarer la kotlin-stdlib.
 * ② Le shadowJar relocalise `kotlin` → `net.artisanmc.shaded.kotlin` (cf.
 *    build.gradle.kts) pour cesser de servir une kotlin-stdlib publique à tout
 *    le serveur — deux plugins qui embarquent la leur sous les noms d'origine se
 *    volent leurs classes et le premier appel inter-plugins meurt en
 *    `LinkageError` (incident du 2026-08-08). Un type Kotlin resté dans une
 *    signature publique serait relocalisé lui aussi, et le JAR d'API publié —
 *    lui, non relocalisé — ne linkerait plus.
 *
 * L'implémentation, elle, reste en Kotlin : seules les signatures qui traversent
 * la frontière sont contraintes.
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
            fail("Types Kotlin dans la surface publique de modules.api :\n" +
                offenders.sorted().joinToString("\n") { "  - $it" } +
                "\nRemplacer par une `fun interface` du package api, un type java.util.function, ou Runnable.")
        }
    }

    /** `kotlin.Metadata` reste, mais en annotation — jamais dans une signature. */
    private fun isKotlin(t: Class<*>): Boolean =
        generateSequence(t) { if (it.isArray) it.componentType else null }
            .last()
            .name.startsWith("kotlin.")

    /** Le classpath de test porte deux racines pour ce package (main + test) :
     *  seule celle du main est la surface publiée. */
    private fun apiClasses(): List<Class<*>> {
        val roots = javaClass.classLoader.getResources("net/artisanmc/modules/api").toList()
            .map { File(it.toURI()) }
            .filter { it.path.replace('\\', '/').contains("/classes/kotlin/main/") }
        check(roots.isNotEmpty()) { "classes main de modules.api introuvables sur le classpath" }

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
