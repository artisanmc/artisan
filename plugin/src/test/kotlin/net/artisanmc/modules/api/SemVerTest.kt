package net.artisanmc.modules.api

import kotlin.test.Test
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class SemVerTest {
    @Test fun `same version satisfies`() = assertTrue(SemVer.satisfies("1.0.0", "1.0.0"))
    @Test fun `higher core minor satisfies`() = assertTrue(SemVer.satisfies("1.5.0", "1.0.0"))
    @Test fun `higher core patch satisfies`() = assertTrue(SemVer.satisfies("1.0.3", "1.0.1"))
    @Test fun `lower core minor fails`() = assertFalse(SemVer.satisfies("1.0.0", "1.2.0"))
    @Test fun `different major fails`() = assertFalse(SemVer.satisfies("2.0.0", "1.0.0"))
    @Test fun `lower core patch fails`() = assertFalse(SemVer.satisfies("1.0.0", "1.0.1"))
    @Test fun `snapshot suffix is ignored`() = assertTrue(SemVer.satisfies("1.0.0-SNAPSHOT", "1.0.0"))
}
