package net.artisanmc.plugin.update

import java.security.KeyFactory
import java.security.spec.X509EncodedKeySpec
import java.util.Base64
import kotlin.test.Test
import kotlin.test.assertTrue

class ReleaseKeysTest {
    @Test
    fun `every pinned key is an Ed25519 public key`() {
        assertTrue(ReleaseKeys.TRUSTED.isNotEmpty())
        val factory = KeyFactory.getInstance("Ed25519")
        for (key in ReleaseKeys.TRUSTED) factory.generatePublic(X509EncodedKeySpec(Base64.getDecoder().decode(key)))
    }
}
