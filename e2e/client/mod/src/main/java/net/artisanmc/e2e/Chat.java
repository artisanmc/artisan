package net.artisanmc.e2e;

import java.util.ArrayList;
import java.util.List;

/**
 * Messages système reçus du serveur (réponses de commandes). Le paquet passe
 * par le thread réseau puis par le thread client : un message peut être
 * enregistré deux fois, ce qui est sans effet sur les recherches.
 */
public final class Chat {
	private static final List<String> messages = new ArrayList<>();

	private Chat() {}

	public static synchronized void record(String message) {
		messages.add(message);
	}

	public static synchronized void clear() {
		messages.clear();
	}

	/** Le dernier message contenant [needle], ou null. */
	public static synchronized String find(String needle) {
		for (int i = messages.size() - 1; i >= 0; i--) {
			if (messages.get(i).contains(needle)) return messages.get(i);
		}
		return null;
	}
}
