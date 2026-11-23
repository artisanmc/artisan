package net.artisanmc.plugin.integrations

import be.seeseemelk.mockbukkit.MockBukkit
import org.bukkit.Location
import org.bukkit.entity.Player
import kotlin.test.*

/** The two EssentialsX calls `/back` needs, shaped as in its `IEssentials` and `UserData`. */
class FakeEssentials {
    val users = HashMap<Player, FakeUser>()
    fun getUser(player: Player): FakeUser = users.getOrPut(player) { FakeUser() }
}

class FakeUser {
    var last: Location? = null
    fun setLastLocation(location: Location) { last = location }
}

class BackLocationTest {
    @BeforeTest fun setup() { MockBukkit.mock() }
    @AfterTest fun teardown() { MockBukkit.unmock() }

    @Test fun `the place left is saved as the player's last location in EssentialsX`() {
        val player = MockBukkit.getMock()!!.addPlayer()
        val essentials = FakeEssentials()
        val from = player.location.clone().add(3.0, 0.0, 0.0)

        assertTrue(BackLocation.record(essentials, player, from))
        assertEquals(from, essentials.users.getValue(player).last)
        from.add(10.0, 0.0, 0.0)
        assertNotEquals(from, essentials.users.getValue(player).last, "a copy is saved, not the caller's object")
    }

    @Test fun `a plugin without those methods is left alone`() {
        val player = MockBukkit.getMock()!!.addPlayer()
        assertFalse(BackLocation.record(Any(), player, player.location))
    }

    @Test fun `without EssentialsX nothing happens`() {
        val player = MockBukkit.getMock()!!.addPlayer()
        BackLocation.record(player)
    }
}
