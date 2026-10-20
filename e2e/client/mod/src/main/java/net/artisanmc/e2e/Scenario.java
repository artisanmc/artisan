package net.artisanmc.e2e;

import net.minecraft.client.Minecraft;
import net.minecraft.client.gui.screens.ConnectScreen;
import net.minecraft.client.gui.screens.TitleScreen;
import net.minecraft.client.multiplayer.ServerData;
import net.minecraft.client.multiplayer.resolver.ServerAddress;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.function.BooleanSupplier;

/**
 * Scénario piloté au tick client : une liste d'étapes exécutées dans l'ordre,
 * chacune pouvant attendre une condition. Le résultat (une ligne par contrôle,
 * puis PASS ou FAIL) est écrit dans un fichier que {@code run.sh} lit pour
 * décider du code de sortie : on ne dépend pas du code de sortie du launcher.
 */
public abstract class Scenario {
	/** Délai max pour se connecter et rejoindre le monde (chargement du client inclus). */
	private static final int JOIN_TIMEOUT_TICKS = 20 * 120;
	private static final int STEP_TIMEOUT_TICKS = 20 * 10;

	private final String server;
	private final Path resultFile;
	private final List<Step> steps = new ArrayList<>();
	private final List<String> report = new ArrayList<>();
	private int index = 0;
	private int waited = 0;
	private int ticks = 0;
	private boolean connecting = false;
	private boolean failed = false;
	private boolean finished = false;

	protected Scenario(String server, Path resultFile) {
		this.server = server;
		this.resultFile = resultFile;
	}

	protected interface Action { void run(Minecraft mc); }

	private record Step(String name, BooleanSupplier until, int timeout, Action action) {}

	/** Exécute [action] une fois. */
	protected void step(String name, Action action) {
		steps.add(new Step(name, () -> true, 0, action));
	}

	/** Attend que [until] soit vrai (échec au bout de 10 s). */
	protected void await(String name, BooleanSupplier until) {
		steps.add(new Step(name, until, STEP_TIMEOUT_TICKS, mc -> {}));
	}

	/** Laisse passer [n] ticks, le temps que les corrections du serveur arrivent. */
	protected void sleep(int n) {
		int[] left = {n};
		steps.add(new Step("sleep " + n, () -> --left[0] <= 0, n + 1, mc -> {}));
	}

	protected void check(String name, boolean ok, String detail) {
		report.add((ok ? "ok   " : "FAIL ") + name + (ok || detail.isEmpty() ? "" : " — " + detail));
		if (!ok) failed = true;
	}

	protected abstract void define(Minecraft mc);

	final void tick(Minecraft mc) {
		if (finished) return;
		ticks++;
		if (!connecting) {
			// Attend la fin du chargement des ressources (overlay de chargement levé).
			// Au premier lancement l'écran n'est pas l'écran titre mais l'accueil
			// accessibilité : on se connecte depuis n'importe quel écran.
			if (mc.gui.overlay() != null || mc.gui.screen() == null) {
				if (ticks > JOIN_TIMEOUT_TICKS) finish(mc, "client never finished loading");
				return;
			}
			connecting = true;
			define(mc);
			ConnectScreen.startConnecting(new TitleScreen(), mc, ServerAddress.parseString(server),
				new ServerData("artisan-e2e", server, ServerData.Type.OTHER), false, null);
			return;
		}
		if (mc.player == null || mc.level == null) {
			if (ticks > JOIN_TIMEOUT_TICKS) finish(mc, "never joined " + server);
			return;
		}
		while (index < steps.size()) {
			Step s = steps.get(index);
			if (!s.until().getAsBoolean()) {
				if (++waited > s.timeout()) { finish(mc, "timeout: " + s.name()); return; }
				return;
			}
			waited = 0;
			index++;
			try {
				s.action().run(mc);
			} catch (RuntimeException e) {
				finish(mc, "error in " + s.name() + ": " + e);
				return;
			}
			if (failed) { finish(mc, null); return; }
			// Une étape d'attente rend la main au tick suivant.
			if (s.timeout() > 0) return;
		}
		finish(mc, null);
	}

	private void finish(Minecraft mc, String abort) {
		finished = true;
		if (abort != null) { report.add("FAIL " + abort); failed = true; }
		report.add(failed ? "RESULT FAIL" : "RESULT PASS");
		for (String line : report) System.out.println("[artisan-e2e] " + line);
		try {
			Files.write(resultFile, report);
		} catch (IOException e) {
			System.out.println("[artisan-e2e] cannot write " + resultFile + ": " + e);
		}
		mc.stop();
	}
}
