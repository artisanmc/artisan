package net.artisanmc.tunnelserver

fun main() {
    val server = TunnelServer(TunnelServerConfig.fromEnv())
    Runtime.getRuntime().addShutdownHook(Thread { server.stop() })
    server.start()
    server.join()
}
