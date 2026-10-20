package net.artisanmc.e2e;

import net.fabricmc.api.ClientModInitializer;
import net.minecraft.client.Minecraft;

/**
 * Point d'entrée : lit la configuration passée en propriétés système par
 * {@code e2e/client/run.sh}, puis déroule le scénario tick après tick.
 */
public final class E2eClient implements ClientModInitializer {
	private static Scenario scenario;

	@Override
	public void onInitializeClient() {
		String server = System.getProperty("artisan.e2e.server", "localhost:25565");
		String result = System.getProperty("artisan.e2e.result", "artisan-e2e-result.txt");
		scenario = new HiddenInventoryScenario(server, java.nio.file.Path.of(result));
	}

	public static void tick(Minecraft mc) {
		if (scenario != null) scenario.tick(mc);
	}
}
