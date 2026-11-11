package net.artisanmc.plugin.hub

/**
 * The user docs of this release (`docs/site`, shipped in the jar under `wiki/`), for the MCP tool
 * `read_docs`: what the guide of a kind leaves out (expressions, data sources, translations…).
 */
object UserDocs {
    /** A page: its path (`editor/expressions`), and its front matter's title and description. */
    class Page(val path: String, val title: String, val description: String, val body: String)

    val pages: List<Page> by lazy {
        val index = resource("pages.txt") ?: return@lazy emptyList()
        index.lines().filter { it.isNotBlank() }.mapNotNull { path -> resource("$path.md")?.let { parse(path, it) } }
    }

    fun page(path: String): Page? {
        val wanted = path.trim().removePrefix("/").removeSuffix("/").removeSuffix(".md")
        return pages.firstOrNull { it.path == wanted }
    }

    /** The pages, grouped by folder: each one's path, title and description. */
    fun index(): String = buildString {
        append("# Artisan docs\n\nRead a page with read_docs and its path. Links between pages are relative: `../configuration/database/` is `configuration/database`.\n")
        for ((folder, inFolder) in pages.groupBy { it.path.substringBefore('/', "") }) {
            append("\n## ").append(folder.ifEmpty { "home" }).append('\n')
            for (page in inFolder) append("- ").append(page.path).append(": ").append(page.title)
                .append(page.description.takeIf { it.isNotBlank() }?.let { " — $it" }.orEmpty()).append('\n')
        }
    }

    private fun parse(path: String, text: String): Page {
        val front = Regex("\\A---\\n(.*?)\\n---\\n", RegexOption.DOT_MATCHES_ALL).find(text)
        fun field(name: String) = front?.groupValues?.get(1)?.lines()?.firstOrNull { it.startsWith("$name:") }
            ?.substringAfter(':')?.trim()?.removeSurrounding("\"").orEmpty()
        return Page(path, field("title").ifEmpty { path }, field("description"), front?.let { text.substring(it.range.last + 1) } ?: text)
    }

    private fun resource(name: String) = UserDocs::class.java.getResourceAsStream("/wiki/$name")?.use { it.readBytes().toString(Charsets.UTF_8) }
}
