package net.artisanmc.plugin.hub

/** Fin de session côté éditeur. L'ouverture se fait par le lien de `/artisan editor`. */
class AuthRoutes(private val sessions: Sessions) {
    fun register(router: Router) {
        router.on("POST", "/api/v1/auth/logout", EditorPermissions.VIEW) { call ->
            sessions.close(call.session!!.id)
            call.json(mapOf("ok" to true))
        }
    }
}
