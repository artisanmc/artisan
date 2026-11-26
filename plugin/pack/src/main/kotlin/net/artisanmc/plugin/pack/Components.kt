package net.artisanmc.plugin.pack

/**
 * A look that names a component, read as the component's parts with its parameters put in
 * (`docs/schema/menu/v1/components.ts`; ADR `element-parts-and-sliced-images`, decision 6).
 * The runtime has the same reading in `MenuComponents`; `testdata/component-expansion.json`
 * holds the three to one answer.
 */
internal object Components {
    /** A component found for a look: its file, and the module whose images its bare names are. */
    class Found(val file: Any?, val owner: String)

    private val PARAM = Regex("\\{([a-z][a-z0-9_]*)\\}")
    private val WHOLE = Regex("^\\{([a-z][a-z0-9_]*)\\}$")

    fun name(look: Any?): String? = when (val c = (look as? Map<*, *>)?.get("component")) {
        is String -> c.ifEmpty { null }
        is Map<*, *> -> (c["name"] as? String)?.ifEmpty { null }
        else -> null
    }

    private fun text(v: Any?, lang: String?): String = when (v) {
        is String -> v
        is Boolean -> v.toString()
        is Number -> Js.numberString(v.toDouble())
        is Map<*, *> -> (lang?.let { v[it] } as? String) ?: (v.values.firstOrNull { it is String } as? String) ?: ""
        else -> ""
    }

    fun parts(found: Found, args: Any?): List<Any?> {
        val file = found.file as? Map<*, *> ?: emptyMap<Any?, Any?>()
        val params = file["params"] as? Map<*, *> ?: emptyMap<Any?, Any?>()
        val given = args as? Map<*, *> ?: emptyMap<Any?, Any?>()
        fun mine(name: String) = name != "name" && given[name] != null
        fun value(name: String): Any? = if (mine(name)) given[name] else (params[name] as? Map<*, *>)?.get("default")
        fun owned(name: String) = if (found.owner.isNotEmpty() && !name.contains(':')) "${found.owner}:$name" else name
        fun fill(text: String, lang: String?): String =
            PARAM.replace(text) { m -> if (!params.containsKey(m.groupValues[1])) m.value else text(value(m.groupValues[1]), lang) }
        fun languages(text: String): List<String> {
            val out = ArrayList<String>()
            for (m in PARAM.findAll(text)) {
                val v = if (params.containsKey(m.groupValues[1])) value(m.groupValues[1]) else null
                if (v is Map<*, *>) for (lang in v.keys) if (lang is String && lang !in out) out += lang
            }
            return out
        }
        val out = ArrayList<Any?>()
        for (raw in file["parts"] as? List<*> ?: emptyList<Any?>()) {
            val part = raw as? Map<*, *> ?: continue
            val image = part["image"]
            if (image is String) {
                val name = WHOLE.find(image)?.groupValues?.get(1)?.takeIf { params.containsKey(it) }
                if (name == null) {
                    out += part + ("image" to owned(image))
                    continue
                }
                val v = value(name) as? String
                if (v.isNullOrEmpty()) continue
                out += part + ("image" to if (mine(name)) v else owned(v))
                continue
            }
            when (val label = part["label"]) {
                is String -> {
                    val langs = languages(label)
                    out += part + ("label" to if (langs.isEmpty()) fill(label, null) else langs.associateWith { fill(label, it) })
                }
                is Map<*, *> -> out += part + ("label" to label.entries.associate { (lang, t) -> lang to if (t is String) fill(t, lang as? String) else t })
                else -> out += part
            }
        }
        return out
    }

    /** A look as it is drawn: the component's parts in place of `component`, `image`, `label` and `parts`. */
    fun expandLook(look: Any?, find: (String) -> Found?): Any? {
        val name = name(look) ?: return look
        val map = look as Map<*, *>
        val found = find(name) ?: return look
        val out = LinkedHashMap<Any?, Any?>()
        for ((k, v) in map) if (k != "component" && k != "image" && k != "label" && k != "parts") out[k] = v
        out["parts"] = parts(found, map["component"])
        return out
    }

    /** A menu with every look of its elements expanded; the same object when none names a component. */
    fun expandMenu(menu: Any?, find: (String) -> Found?): Any? {
        val doc = menu as? Map<*, *> ?: return menu
        var changed = false
        fun element(el: Any?): Any? {
            if (el !is Map<*, *>) return el
            var next = expandLook(el, find) as Map<*, *>
            val states = next["states"] as? List<*>
            if (states != null) {
                val expanded = states.map { expandLook(it, find) }
                if (expanded.indices.any { expanded[it] !== states[it] }) next = next + ("states" to expanded)
            }
            if (next !== el) changed = true
            return next
        }
        val elements = (doc["elements"] as? List<*>)?.map(::element)
        val layers = (doc["layers"] as? List<*>)?.map { layer ->
            val list = (layer as? Map<*, *>)?.get("elements") as? List<*>
            if (list == null) layer else (layer as Map<*, *>) + ("elements" to list.map(::element))
        }
        if (!changed) return menu
        val out = LinkedHashMap<Any?, Any?>(doc)
        if (elements != null) out["elements"] = elements
        if (layers != null) out["layers"] = layers
        return out
    }

    /** The folder the common components are in: the theme `artisan` ([Kit.FOLDER]). */
    private const val COMMON = "artisan"
    private val FILE = Regex("^(originals/)?components/([^/]+)\\.ya?ml$")

    /**
     * The components of a server's modules (`components/<name>.yml`), read once
     * (`packComponents`): the function of a folder turns a menu of that module into the menu
     * as it is drawn. The common ones are the theme `artisan`'s, the server's own before the
     * one Artisan ships (`originals/components/`). An unreadable file is no component.
     */
    fun ofProjects(projects: List<Pair<String, List<PackFile>>>): (String) -> (Any?) -> Any? {
        val byFolder = HashMap<String, Map<String, Any?>>()
        for ((folder, files) in projects) {
            val own = LinkedHashMap<String, Any?>()
            val shipped = LinkedHashMap<String, Any?>()
            for (file in files) {
                val match = FILE.find(file.path) ?: continue
                val original = match.groupValues[1].isNotEmpty()
                // What Artisan ships is read for the common components only.
                if (original && folder != COMMON) continue
                val into = if (original) shipped else own
                val name = match.groupValues[2]
                if (into.containsKey(name)) continue
                val doc = runCatching { Yaml.parse(file.content) }.getOrNull() as? Map<*, *> ?: continue
                into[name] = doc
            }
            for ((name, doc) in shipped) own.putIfAbsent(name, doc)
            if (own.isNotEmpty()) byFolder[folder] = own
        }
        if (byFolder.isEmpty()) return { _ -> { menu -> menu } }
        return { folder -> { menu -> expandMenu(menu) { name -> find(folder, name, COMMON) { module, bare -> byFolder[if (module.isEmpty()) COMMON else module]?.get(bare) } } } }
    }

    /**
     * Which component a name written in [module]'s menu is: `<module>:<name>` that module's,
     * `artisan:<name>` the common one, a bare name the menu's module's then the common one.
     * [component] gives a module's file (`""`: the common ones).
     */
    fun find(module: String, name: String, common: String = "artisan", component: (String, String) -> Any?): Found? {
        val colon = name.indexOf(':')
        val scopes = if (colon >= 0) listOf(name.substring(0, colon)) else listOf(module, common)
        val bare = if (colon >= 0) name.substring(colon + 1) else name
        for (scope in scopes) {
            if (scope.isEmpty()) continue
            val file = component(if (scope == common) "" else scope, bare)
            if (file != null) return Found(file, scope)
        }
        return null
    }
}
