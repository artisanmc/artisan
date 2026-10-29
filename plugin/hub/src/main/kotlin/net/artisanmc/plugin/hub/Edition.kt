package net.artisanmc.plugin.hub

import java.util.Properties

/**
 * Which jar this is: free or Pro (`-Pedition`, docs/architecture/editions.md). One code base;
 * the edition only gates **editing** the Pro parts (title composer, resource pack, image and font
 * import). Content made with Pro keeps rendering in the free jar: menus, titles and the last pack
 * the hub received stay served, only a new pack is refused.
 */
enum class Edition(val wire: String) {
    FREE("free"),
    PRO("pro");

    val pro: Boolean get() = this == PRO

    companion object {
        const val RESOURCE = "artisan-edition.properties"

        /**
         * The edition the build wrote into the jar. A jar without the file (a test classpath, a
         * build older than editions) is Pro: before editions, every jar had every feature.
         */
        fun bundled(loader: ClassLoader = Edition::class.java.classLoader): Edition {
            val props = Properties()
            loader.getResourceAsStream(RESOURCE)?.use(props::load) ?: return PRO
            return parse(props.getProperty("edition"))
        }

        /** Anything but `free` is Pro: a typo never takes features away from a server. */
        fun parse(value: String?): Edition = if (value?.trim() == FREE.wire) FREE else PRO
    }
}
