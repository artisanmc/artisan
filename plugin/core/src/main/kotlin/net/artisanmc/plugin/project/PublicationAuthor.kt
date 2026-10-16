package net.artisanmc.plugin.project

/** Who published, and the Version the published draft was restored from, if any. */
data class PublicationAuthor(val id: String, val name: String, val restoredFrom: String? = null)
