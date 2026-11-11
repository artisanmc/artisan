package net.artisanmc.plugin.protocol

import kotlin.test.Test
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class EditorPathsTest {
    @Test
    fun `the editor sees editor yaml and no other artisan metadata`() {
        assertFalse(EditorPaths.isInvisible(".artisan/editor.yaml"))
        assertFalse(EditorPaths.isInvisible("menus/shop.yml"))
        for (meta in listOf(".artisan/project-id", ".artisan/history/a.yml/1", ".artisan/transactions/x", ".artisan/drafts/d/draft.json", ".artisan-trash/a", ".artisan-sync.yaml")) {
            assertTrue(EditorPaths.isInvisible(meta), meta)
            assertFalse(EditorPaths.isWritable(meta), meta)
        }
    }
}
