package net.artisanmc.e2e.mixin;

import net.artisanmc.e2e.Chat;
import net.minecraft.client.multiplayer.ClientPacketListener;
import net.minecraft.network.protocol.game.ClientboundSystemChatPacket;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;

@Mixin(ClientPacketListener.class)
public class SystemChatMixin {
	@Inject(at = @At("HEAD"), method = "handleSystemChat")
	private void artisanE2e$systemChat(ClientboundSystemChatPacket packet, CallbackInfo info) {
		if (!packet.overlay()) Chat.record(packet.content().getString());
	}
}
