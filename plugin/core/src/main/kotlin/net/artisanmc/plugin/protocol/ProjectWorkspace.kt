package net.artisanmc.plugin.protocol

import net.artisanmc.plugin.project.PublicationAuthor
import net.artisanmc.plugin.project.ProjectRoots
import net.artisanmc.plugin.project.ProjectSnapshot
import java.util.concurrent.Executor

/** The loaded Projects, as seen by the protocol handlers. */
interface ProjectWorkspace {
    val roots: ProjectRoots
    val snapshot: ProjectSnapshot

    /**
     * Every disk read or write of a Project goes through here: off the WebSocket
     * callback, and one at a time, so no write crosses a reload.
     */
    val io: Executor

    /**
     * Re-reads [projectIds] from the disk (every project when null), then notifies the
     * runtime (commands, modules). Whoever writes knows it wrote, and what: without this,
     * the editor would not see its own write; with every project, a one-file write would
     * cost a read of them all. A deleted project is dropped, a renamed one read under its
     * new id.
     */
    fun reload(projectIds: Set<String>? = null)

    /** The editor player whose publication of [projectId] the next reload loads: that Version's author. */
    fun authoredBy(projectId: String, author: PublicationAuthor) {}
}

