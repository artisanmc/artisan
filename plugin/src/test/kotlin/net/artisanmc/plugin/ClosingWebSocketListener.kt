package net.artisanmc.plugin

import okhttp3.WebSocket
import okhttp3.WebSocketListener

abstract class ClosingWebSocketListener : WebSocketListener() {
    override fun onClosing(ws: WebSocket, code: Int, reason: String) {
        ws.close(code, reason)
    }
}
