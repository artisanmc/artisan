package net.artisanmc.e2e;

import net.minecraft.client.Minecraft;
import net.minecraft.world.inventory.AbstractContainerMenu;
import net.minecraft.world.inventory.ContainerInput;
import net.minecraft.world.item.Item;
import net.minecraft.world.item.ItemStack;
import net.minecraft.world.item.Items;

import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.Set;
import java.util.function.Predicate;

/**
 * La checklist « Menus en paquets » de docs/architecture/testing.md, contre les
 * menus de {@code fixtures/projects/e2e/} :
 * <ul>
 *   <li>{@code e2e_hidden} : pierre partout, aucun clic ne bouge rien, un objet
 *   ramassé ne s'affiche pas, rien côté serveur, inventaire intact à la fermeture ;</li>
 *   <li>{@code e2e_visible} : le vrai inventaire s'affiche et ne bouge pas ;</li>
 *   <li>{@code e2e_nav_a/b/c} : A → B → C, deux retours ramènent à A,
 *   {@code has_previous_menu} suit l'historique.</li>
 * </ul>
 */
final class MenuScenarios extends Scenario {
	private static final int TOP = 27;
	private static final int ALL = TOP + 36;
	/** Premier slot de la barre d'action dans la fenêtre : c'est là qu'est le diamant. */
	private static final int HOTBAR_0 = TOP + 27;
	private static final int TO_NEXT = 0;
	private static final int BACK = 8;
	private static final int HISTORY = 26;

	private record Click(int button, ContainerInput input, String name) {}

	private static final List<Click> CLICKS = List.of(
		new Click(0, ContainerInput.PICKUP, "left click"),
		new Click(1, ContainerInput.PICKUP, "right click"),
		new Click(0, ContainerInput.QUICK_MOVE, "shift click"),
		new Click(0, ContainerInput.PICKUP_ALL, "double click"),
		new Click(0, ContainerInput.SWAP, "number key 1"),
		new Click(40, ContainerInput.SWAP, "F key"),
		new Click(0, ContainerInput.THROW, "drop key")
	);

	private List<String> realInventory;

	MenuScenarios(String server, Path resultFile) {
		super(server, resultFile);
	}

	@Override
	protected void define(Minecraft mc) {
		sleep(40);
		hidden(mc);
		visible(mc);
		navigation(mc);
	}

	// --- player_inventory: hidden ------------------------------------------

	private void hidden(Minecraft mc) {
		giveDiamond(mc);
		open(mc, "e2e_hidden", m -> m.player.containerMenu.slots.size() == ALL);
		step("hidden: stone everywhere", m -> checkAllStone(m, "after open"));

		step("hidden: /data get", m -> {
			Chat.clear();
			m.getConnection().sendCommand("data get entity @s Inventory");
		});
		await("hidden: /data get answer", () -> Chat.find("entity data") != null);
		step("hidden: nothing server side", m -> {
			String answer = Chat.find("entity data");
			check("hidden: /data get shows the real inventory",
				answer.contains("minecraft:diamond") && !answer.contains("minecraft:stone"), answer);
		});

		for (int slot : new int[] {0, TOP, HOTBAR_0}) {
			for (Click click : CLICKS) {
				clickAndCheck(mc, slot, click, "hidden", m -> checkAllStone(m, ""));
			}
		}

		step("hidden: drop a gold ingot", m -> m.getConnection().sendCommand(
			"summon item ~ ~ ~ {Item:{id:\"minecraft:gold_ingot\",count:1},PickupDelay:0}"));
		sleep(20);
		step("hidden: after pickup", m -> {
			checkAllStone(m, "after picking up an item");
			checkCursorEmpty(m, "hidden: after picking up an item");
		});

		close(mc);
		step("hidden: real inventory after close", m -> {
			check("hidden: diamond kept", count(m, Items.DIAMOND) == 1, inventory(m).toString());
			check("hidden: picked-up gold ingot in the real inventory", count(m, Items.GOLD_INGOT) == 1,
				inventory(m).toString());
			check("hidden: no stone in the real inventory", count(m, Items.STONE) == 0, inventory(m).toString());
		});
	}

	// --- player_inventory: visible -----------------------------------------

	private void visible(Minecraft mc) {
		giveDiamond(mc);
		open(mc, "e2e_visible", m -> m.player.containerMenu.slots.size() == ALL);
		step("visible: real inventory shown", m -> checkVisible(m, "after open"));
		for (int slot : new int[] {0, HOTBAR_0}) {
			for (Click click : CLICKS) {
				clickAndCheck(mc, slot, click, "visible", m -> checkVisible(m, ""));
			}
		}
		close(mc);
		step("visible: real inventory after close", m -> check("visible: real inventory intact after close",
			inventory(m).equals(realInventory), "before " + realInventory + ", after " + inventory(m)));
	}

	private void checkVisible(Minecraft mc, String when) {
		AbstractContainerMenu menu = mc.player.containerMenu;
		List<Integer> wrong = new ArrayList<>();
		for (int i = 0; i < TOP; i++) if (!menu.getSlot(i).getItem().is(Items.STONE)) wrong.add(i);
		check("visible: stone on top " + when, wrong.isEmpty(), "not stone: " + wrong);
		List<Integer> bottom = new ArrayList<>();
		for (int i = TOP; i < menu.slots.size(); i++) {
			ItemStack stack = menu.getSlot(i).getItem();
			boolean ok = i == HOTBAR_0 ? stack.is(Items.DIAMOND) && stack.getCount() == 1 : stack.isEmpty();
			if (!ok) bottom.add(i);
		}
		check("visible: bottom is the real inventory " + when, bottom.isEmpty(), "wrong slots: " + bottom);
	}

	// --- navigation ----------------------------------------------------------

	private void navigation(Minecraft mc) {
		open(mc, "e2e_nav_a", m -> isA(m));
		step("nav: A without history", m -> checkHistory(m, false, "A opened by command"));

		press(mc, TO_NEXT, "nav: A → B", MenuScenarios::isB);
		step("nav: B shown whole", m -> checkOnly(m, "B", Set.of(TO_NEXT, BACK)));

		press(mc, TO_NEXT, "nav: B → C", MenuScenarios::isC);
		step("nav: C shown whole", m -> {
			checkOnly(m, "C", Set.of(BACK, HISTORY));
			checkHistory(m, true, "C opened from B");
		});

		press(mc, BACK, "nav: back C → B", MenuScenarios::isB);
		press(mc, BACK, "nav: back B → A", MenuScenarios::isA);
		step("nav: A after two backs", m -> checkHistory(m, false, "history consumed"));

		step("nav: back with no history", m -> clickSlot(m, BACK, 0, ContainerInput.PICKUP));
		sleep(20);
		step("nav: still A", m -> {
			check("nav: back with no history stays on A", isA(m), describeMenu(m));
			check("nav: back with no history keeps the menu open",
				m.player.containerMenu != m.player.inventoryMenu, "menu closed");
		});
		close(mc);
	}

	private static boolean isA(Minecraft mc) {
		AbstractContainerMenu menu = mc.player.containerMenu;
		return menu != mc.player.inventoryMenu && menu.slots.size() == ALL && menu.getSlot(1).getItem().is(Items.COBBLESTONE);
	}

	private static boolean isB(Minecraft mc) {
		AbstractContainerMenu menu = mc.player.containerMenu;
		return menu != mc.player.inventoryMenu && menu.slots.size() == ALL
			&& menu.getSlot(TO_NEXT).getItem().is(Items.ARROW) && menu.getSlot(HISTORY).getItem().isEmpty();
	}

	private static boolean isC(Minecraft mc) {
		AbstractContainerMenu menu = mc.player.containerMenu;
		return menu != mc.player.inventoryMenu && menu.slots.size() == ALL
			&& menu.getSlot(TO_NEXT).getItem().isEmpty() && !menu.getSlot(HISTORY).getItem().isEmpty();
	}

	private void checkHistory(Minecraft mc, boolean expected, String when) {
		ItemStack stack = mc.player.containerMenu.getSlot(HISTORY).getItem();
		check("nav: has_previous_menu " + expected + " (" + when + ")",
			stack.getItem() == (expected ? Items.EMERALD : Items.COAL), describe(stack));
	}

	/** Seuls les slots [filled] portent un objet : rien du menu précédent ne reste. */
	private void checkOnly(Minecraft mc, String name, Set<Integer> filled) {
		AbstractContainerMenu menu = mc.player.containerMenu;
		List<Integer> wrong = new ArrayList<>();
		for (int i = 0; i < menu.slots.size(); i++) {
			if (menu.getSlot(i).getItem().isEmpty() == filled.contains(i)) wrong.add(i);
		}
		check("nav: " + name + " has nothing left from the previous menu", wrong.isEmpty(), "wrong slots: " + wrong);
	}

	// --- steps shared by the scenarios ---------------------------------------

	private void giveDiamond(Minecraft mc) {
		step("clear and give", m -> {
			m.getConnection().sendCommand("clear");
			m.getConnection().sendCommand("give @s diamond 1");
		});
		await("diamond received", () -> count(mc, Items.DIAMOND) == 1 && count(mc, Items.GOLD_INGOT) == 0);
		step("snapshot inventory", m -> realInventory = inventory(m));
	}

	private void open(Minecraft mc, String menuId, Predicate<Minecraft> shown) {
		step("open " + menuId, m -> m.getConnection().sendCommand("artisan menu " + menuId));
		await(menuId + " open", () -> mc.player.containerMenu != mc.player.inventoryMenu && shown.test(mc));
		sleep(10);
	}

	private void close(Minecraft mc) {
		step("close menu", m -> m.player.closeContainer());
		await("menu closed", () -> mc.player.containerMenu == mc.player.inventoryMenu);
		sleep(20);
	}

	/** Clic gauche sur un bouton, puis attente de l'écran qu'il doit ouvrir. */
	private void press(Minecraft mc, int slot, String name, Predicate<Minecraft> next) {
		step(name, m -> clickSlot(m, slot, 0, ContainerInput.PICKUP));
		await(name + " shown", () -> next.test(mc));
		sleep(10);
	}

	private void clickAndCheck(Minecraft mc, int slot, Click click, String scenario, Scenario.Action expectations) {
		String name = scenario + ": " + click.name() + " on slot " + slot;
		step(name, m -> clickSlot(m, slot, click.button(), click.input()));
		// Le client prédit le déplacement ; on laisse le serveur le corriger.
		sleep(10);
		step("after " + name, m -> {
			check(name + ": still open", m.player.containerMenu != m.player.inventoryMenu, "menu closed");
			checkCursorEmpty(m, name);
			expectations.run(m);
		});
	}

	private static void clickSlot(Minecraft mc, int slot, int button, ContainerInput input) {
		mc.gameMode.handleContainerInput(mc.player.containerMenu.containerId, slot, button, input, mc.player);
	}

	private void checkCursorEmpty(Minecraft mc, String name) {
		ItemStack carried = mc.player.containerMenu.getCarried();
		check(name + ": cursor empty", carried.isEmpty(), "cursor holds " + describe(carried));
	}

	private void checkAllStone(Minecraft mc, String when) {
		List<Integer> wrong = new ArrayList<>();
		AbstractContainerMenu menu = mc.player.containerMenu;
		for (int i = 0; i < menu.slots.size(); i++) {
			if (!menu.getSlot(i).getItem().is(Items.STONE)) wrong.add(i);
		}
		check("hidden: stone in all " + menu.slots.size() + " slots " + when,
			wrong.isEmpty() && menu.slots.size() == ALL, "not stone: " + wrong);
	}

	private static List<String> inventory(Minecraft mc) {
		List<String> out = new ArrayList<>();
		var items = mc.player.getInventory().getNonEquipmentItems();
		for (int i = 0; i < items.size(); i++) {
			if (!items.get(i).isEmpty()) out.add(i + "=" + describe(items.get(i)));
		}
		return out;
	}

	private static int count(Minecraft mc, Item item) {
		int n = 0;
		for (ItemStack s : mc.player.getInventory().getNonEquipmentItems()) if (s.is(item)) n += s.getCount();
		return n;
	}

	private static String describeMenu(Minecraft mc) {
		AbstractContainerMenu menu = mc.player.containerMenu;
		if (menu == mc.player.inventoryMenu) return "no menu open";
		List<String> out = new ArrayList<>();
		for (int i = 0; i < Math.min(TOP, menu.slots.size()); i++) {
			if (!menu.getSlot(i).getItem().isEmpty()) out.add(i + "=" + describe(menu.getSlot(i).getItem()));
		}
		return out.toString();
	}

	private static String describe(ItemStack s) {
		return s.isEmpty() ? "nothing" : s.getCount() + "x" + s.getItem();
	}
}
