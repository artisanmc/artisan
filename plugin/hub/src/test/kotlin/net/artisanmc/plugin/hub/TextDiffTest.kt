package net.artisanmc.plugin.hub

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

class TextDiffTest {
    @Test
    fun `a change shows with two lines around it, distant changes in their own hunks`() {
        val before = (1..12).joinToString("\n", postfix = "\n") { "line $it" }
        val after = before.replace("line 2\n", "line two\n").replace("line 11\n", "")
        assertEquals(
            "@@ -1,4 +1,4 @@\n line 1\n-line 2\n+line two\n line 3\n line 4\n" +
                "@@ -9,4 +9,3 @@\n line 9\n line 10\n-line 11\n line 12\n",
            TextDiff.unified(before, after),
        )
    }

    @Test
    fun `an added or deleted file is all additions or removals, and a long diff is cut`() {
        assertEquals("@@ -1,0 +1,1 @@\n+a: b\n", TextDiff.unified(null, "a: b\n"))
        assertEquals("@@ -1,1 +1,0 @@\n-a: b\n", TextDiff.unified("a: b\n", null))
        assertEquals("", TextDiff.unified("same\n", "same\n"))
        val cut = TextDiff.unified(null, (1..50).joinToString("\n"), maxLines = 10)
        assertTrue(cut.endsWith("\n+10\n… (diff cut at 10 lines)\n"), cut)
    }
}
