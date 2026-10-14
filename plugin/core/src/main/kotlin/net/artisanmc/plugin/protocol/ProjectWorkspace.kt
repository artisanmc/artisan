package net.artisanmc.plugin.protocol

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
     * Re-reads the disk, then notifies the runtime (commands, modules). Whoever writes
     * knows it wrote: without this, the editor would not see its own write.
     */
    fun reload()

    /** The editor player whose publication of [projectId] the next reload loads: that Version's author. */
    fun authoredBy(projectId: String, authorId: String, authorName: String) {}
}
