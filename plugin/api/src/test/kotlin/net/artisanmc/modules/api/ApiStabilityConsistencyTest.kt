package net.artisanmc.modules.api

import java.io.File
import java.lang.reflect.GenericArrayType
import java.lang.reflect.Modifier
import java.lang.reflect.ParameterizedType
import java.lang.reflect.Type
import java.lang.reflect.WildcardType
import kotlin.test.Test
import kotlin.test.fail

/**
 * A `@Stable` signature must not expose a `@Beta` or `@Internal` type: SemVer would freeze the
 * member while its parameter or return type may still change in a minor (API 2.18.0, where
 * `DataSourceField(String, ModelFieldType)` was `@Stable` and `ModelFieldType` still `@Beta`).
 *
 * The annotations have `SOURCE` retention, so their placement is read from the Java sources and
 * the signatures from the compiled classes. A member annotated `@Beta`, `@Internal`, `@Sunset` or
 * `@Deprecated` in its file is exempt, by name and parameter types (`ArtisanAPI.getMenus()` returns
 * the `@Beta` `MenuApi`; the `@Sunset` `DataSourceField(String, FieldKind)` leaves
 * `DataSourceField(String, ModelFieldType)` checked). A declaration whose parameters span lines is
 * exempt by name.
 */
class ApiStabilityConsistencyTest {

    private enum class Level { STABLE, BETA, INTERNAL }

    private class SourceFacts(val types: Map<String, Level>, val exemptMembers: Map<String, Set<String>>)

    @Test
    fun `every public top-level api type declares its stability`() {
        val facts = readSources()
        val missing = apiClasses()
            .filter { Modifier.isPublic(it.modifiers) && it.enclosingClass == null && !it.isAnnotation }
            .filter { it.packageName != "net.artisanmc.modules.api.annotations" }
            .filter { it.name !in facts.types }
            .map { it.name }
        if (missing.isNotEmpty()) {
            fail("Public api types without @Stable, @Beta or @Internal:\n" + missing.sorted().joinToString("\n") { "  - $it" })
        }
    }

    @Test
    fun `no stable signature exposes a beta or internal type`() {
        val facts = readSources()
        val offenders = mutableListOf<String>()

        for (cls in apiClasses()) {
            if (!Modifier.isPublic(cls.modifiers) || cls.isAnonymousClass || cls.isSynthetic) continue
            if (levelOf(cls, facts) != Level.STABLE) continue
            val exempt = facts.exemptMembers[topLevel(cls).name].orEmpty()

            fun check(member: String, params: List<Class<*>>, types: List<Type>) {
                val signature = params.joinToString(",") { it.simpleName.replace("[]", "") }
                if ("$member($signature)" in exempt || "$member(*)" in exempt) return
                types.flatMap { rawTypes(it) }.distinct().forEach { t ->
                    val level = levelOf(t, facts) ?: return@forEach
                    if (level != Level.STABLE) offenders += "${cls.name}#$member → ${t.name} (@${level.name.lowercase().replaceFirstChar { it.uppercase() }})"
                }
            }

            for (m in cls.declaredMethods) {
                if (!Modifier.isPublic(m.modifiers) || m.isSynthetic || m.isBridge) continue
                check(m.name, m.parameterTypes.toList(), m.genericParameterTypes.toList() + m.genericReturnType)
            }
            for (c in cls.declaredConstructors) {
                if (!Modifier.isPublic(c.modifiers) || c.isSynthetic) continue
                check(cls.simpleName, c.parameterTypes.toList(), c.genericParameterTypes.toList())
            }
            for (f in cls.declaredFields) {
                if (!Modifier.isPublic(f.modifiers) || f.isSynthetic) continue
                check(f.name, emptyList(), listOf(f.genericType))
            }
        }

        if (offenders.isNotEmpty()) {
            fail("@Stable signatures exposing a non-stable type (promote the type, or mark the member @Beta):\n" +
                offenders.sorted().joinToString("\n") { "  - $it" })
        }
    }

    /** The level of an api type, its enclosing type's when it declares none; null outside the api. */
    private fun levelOf(cls: Class<*>, facts: SourceFacts): Level? {
        if (!cls.name.startsWith("net.artisanmc.modules.api.")) return null
        if (cls.packageName == "net.artisanmc.modules.api.annotations") return Level.STABLE
        return generateSequence(cls) { it.enclosingClass }.firstNotNullOfOrNull { facts.types[it.name] }
    }

    private fun topLevel(cls: Class<*>): Class<*> = generateSequence(cls) { it.enclosingClass }.last()

    private fun rawTypes(t: Type): List<Class<*>> = when (t) {
        is Class<*> -> listOf(generateSequence(t) { if (it.isArray) it.componentType else null }.last())
        is ParameterizedType -> rawTypes(t.rawType) + t.actualTypeArguments.flatMap { rawTypes(it) }
        is GenericArrayType -> rawTypes(t.genericComponentType)
        is WildcardType -> (t.upperBounds.toList() + t.lowerBounds).flatMap { rawTypes(it) }
        else -> emptyList() // type variables
    }

    private val annotation = Regex("""^\s*@(\w+)""")
    private val typeDecl = Regex("""^(\s*)(?:public\s+|static\s+|final\s+|abstract\s+|sealed\s+)*(?:class|interface|enum|record|@interface)\s+(\w+)""")
    private val memberDecl = Regex("""^\s*(?:public|protected)\b[^=;(]*?\b(\w+)\s*[(=;]""")

    /** Type levels by binary name (`pkg.Outer$Inner`) and, per top-level type, the exempt member names. */
    private fun readSources(): SourceFacts {
        val types = mutableMapOf<String, Level>()
        val exempt = mutableMapOf<String, MutableSet<String>>()
        val root = sourceRoot()
        root.walkTopDown().filter { it.isFile && it.extension == "java" }.forEach { file ->
            val pkg = file.parentFile.relativeTo(root).path.replace(File.separatorChar, '.')
            val top = "$pkg.${file.nameWithoutExtension}"
            val nesting = ArrayDeque<Pair<Int, String>>() // indent → binary name
            val pending = mutableListOf<String>()
            for (line in file.readLines()) {
                val ann = annotation.find(line)
                if (ann != null && !line.trimStart().startsWith("@interface")) {
                    pending += ann.groupValues[1]
                    continue
                }
                val decl = typeDecl.find(line)
                if (decl != null) {
                    val indent = decl.groupValues[1].length
                    while (nesting.isNotEmpty() && nesting.last().first >= indent) nesting.removeLast()
                    val name = if (nesting.isEmpty()) "$pkg.${decl.groupValues[2]}" else "${nesting.last().second}$${decl.groupValues[2]}"
                    nesting.addLast(indent to name)
                    when {
                        "Stable" in pending -> types[name] = Level.STABLE
                        "Beta" in pending -> types[name] = Level.BETA
                        "Internal" in pending -> types[name] = Level.INTERNAL
                    }
                    pending.clear()
                    continue
                }
                if (line.isBlank() || line.trimStart().let { it.startsWith("*") || it.startsWith("/") }) continue
                val member = memberDecl.find(line)
                if (member != null && pending.any { it in setOf("Beta", "Internal", "Sunset", "Deprecated") }) {
                    exempt.getOrPut(top) { mutableSetOf() } += "${member.groupValues[1]}(${parameterTypes(line, member)})"
                }
                // An annotation spanning lines (`@Sunset(reason = …,`) leaves its continuation here.
                if (pending.isNotEmpty() && (member != null || line.trimEnd().endsWith("{") || line.trimEnd().endsWith(";"))) pending.clear()
            }
        }
        return SourceFacts(types, exempt)
    }

    /**
     * Simple names of the parameter types declared on [line], comma-separated, generics and
     * annotations dropped (`List<String> names, @Nullable String id` → `List,String`); `*` when the
     * parameters continue on the next line; empty for a field.
     */
    private fun parameterTypes(line: String, member: MatchResult): String {
        if (!member.value.endsWith("(")) return ""
        val rest = line.substring(member.range.last + 1)
        var depth = 0
        val params = mutableListOf(StringBuilder())
        for (ch in rest) {
            when {
                ch == ')' && depth == 0 -> return params.map { it.toString().trim() }.filter { it.isNotEmpty() }
                    .joinToString(",") { p ->
                        p.split(Regex("""\s+""")).filterNot { it.startsWith("@") || it == "final" }
                            .dropLast(1).joinToString("").replace("...", "").replace("[]", "").substringAfterLast(".")
                    }
                ch == '<' -> depth++
                ch == '>' -> depth--
                ch == ',' && depth == 0 -> params += StringBuilder()
                depth == 0 -> params.last().append(ch)
            }
        }
        return "*"
    }

    private fun sourceRoot(): File {
        val candidates = listOf(File("src/main/java"), File("api/src/main/java"), File("plugin/api/src/main/java"))
        return candidates.firstOrNull { File(it, "net/artisanmc/modules/api").isDirectory }
            ?: error("api sources not found from ${File(".").absolutePath}")
    }

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
