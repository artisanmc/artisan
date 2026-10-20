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

/**
 * Menu {@code e2e_hidden} ({@code player_inventory: hidden}, pierre sur les 63
 * positions), cf. la checklist « Menus en paquets » de docs/architecture/testing.md :
 * pierre partout, aucun clic ne déplace ni ne récupère rien, et le vrai inventaire
 * revient intact à la fermeture.
 */
final class HiddenInventoryScenario extends Scenario {
	private static final int TOP = 27;
	private static final int ALL = TOP + 36;
	/** Premier slot de la barre d'action dans la fenêtre : c'est là qu'est le diamant. */
	private static final int HOTBAR_0 = TOP + 27;

	private List<String> realInventory;

	HiddenInventoryScenario(String server, Path resultFile) {
		super(server, resultFile);
	}

	@Override
	protected void define(Minecraft mc) {
		sleep(40);
		step("clear and give", m -> {
			m.getConnection().sendCommand("clear");
			m.getConnection().sendCommand("give @s diamond 1");
		});
		await("diamond received", () -> count(mc, Items.DIAMOND) == 1);
		step("snapshot inventory", m -> realInventory = inventory(m));

		step("open menu", m -> m.getConnection().sendCommand("artisan menu e2e_hidden"));
		await("menu window open", () -> mc.player.containerMenu != mc.player.inventoryMenu
			&& mc.player.containerMenu.slots.size() == ALL);
		sleep(10);
		step("stone everywhere", m -> checkAllStone(m, "after open"));

		int[] targets = {0, TOP, HOTBAR_0};
		for (int slot : targets) {
			click(mc, slot, 0, ContainerInput.PICKUP, "left click");
			click(mc, slot, 1, ContainerInput.PICKUP, "right click");
			click(mc, slot, 0, ContainerInput.QUICK_MOVE, "shift click");
			click(mc, slot, 0, ContainerInput.PICKUP_ALL, "double click");
			click(mc, slot, 0, ContainerInput.SWAP, "number key 1");
			click(mc, slot, 40, ContainerInput.SWAP, "F key");
			click(mc, slot, 0, ContainerInput.THROW, "drop key");
		}

		step("close menu", m -> m.player.closeContainer());
		await("menu closed", () -> mc.player.containerMenu == mc.player.inventoryMenu);
		sleep(20);
		step("real inventory intact", m -> {
			List<String> now = inventory(m);
			check("real inventory intact after close", now.equals(realInventory),
				"before " + realInventory + ", after " + now);
			check("no stone in real inventory", count(m, Items.STONE) == 0, count(m, Items.STONE) + " stone");
		});
	}

	private void click(Minecraft mc, int slot, int button, ContainerInput input, String what) {
		String name = what + " on slot " + slot;
		step(name, m -> {
			AbstractContainerMenu menu = m.player.containerMenu;
			m.gameMode.handleContainerInput(menu.containerId, slot, button, input, m.player);
		});
		// Le client prédit le déplacement ; on laisse le serveur le corriger.
		sleep(10);
		step("after " + name, m -> {
			check(name + ": still open", m.player.containerMenu != m.player.inventoryMenu, "menu closed");
			check(name + ": cursor empty", m.player.containerMenu.getCarried().isEmpty(),
				"cursor holds " + describe(m.player.containerMenu.getCarried()));
			checkAllStone(m, "after " + name);
		});
	}

	private void checkAllStone(Minecraft mc, String when) {
		List<Integer> wrong = new ArrayList<>();
		AbstractContainerMenu menu = mc.player.containerMenu;
		for (int i = 0; i < menu.slots.size(); i++) {
			if (!menu.getSlot(i).getItem().is(Items.STONE)) wrong.add(i);
		}
		check("stone in all " + menu.slots.size() + " slots " + when, wrong.isEmpty() && menu.slots.size() == ALL,
			"not stone: " + wrong);
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

	private static String describe(ItemStack s) {
		return s.isEmpty() ? "nothing" : s.getCount() + "x" + s.getItem();
	}
}
