package net.artisanmc.plugin.update

/**
 * The public keys whose signature Artisan accepts on a release (`release.json`): Base64 X.509
 * Ed25519 keys, `openssl pkey -in key.pem -pubout -outform DER | base64 -w0`. The private half
 * lives only in the organization secret `ARTISAN_SIGNING_KEY`, read by `sign-release.yml`.
 * Empty: `/artisan update` checks versions but stages nothing.
 */
object ReleaseKeys {
    val TRUSTED: List<String> = emptyList()
}
