package net.artisanmc.e2e.mixin;

import net.artisanmc.e2e.E2eClient;
import net.minecraft.client.Minecraft;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;

@Mixin(Minecraft.class)
public class MinecraftTickMixin {
	@Inject(at = @At("TAIL"), method = "tick")
	private void artisanE2e$tick(CallbackInfo info) {
		E2eClient.tick((Minecraft) (Object) this);
	}
}
