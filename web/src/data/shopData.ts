import type { MenuData, SlotData } from '@/types/menu';

/**
 * Fake data for the alpha demo: a 6-row Adventurer's Market shop
 * with categories down column 0 and items in columns 2-7.
 * Mirrors the design canvas sample so the demo lands as designed.
 */
export const SHOP_DATA: MenuData = {
  menuName: 'shop_main',
  menuTitle: "Adventurer's Market",
  rows: 6,
  categories: [
    {
      id: 'tools',
      name: 'Tools & Weapons',
      icon: 'iron_sword',
      count: 24,
      active: true,
    },
    {
      id: 'armor',
      name: 'Armor',
      icon: 'diamond_chestplate',
      count: 16,
      active: false,
    },
    {
      id: 'blocks',
      name: 'Building Blocks',
      icon: 'oak_planks',
      count: 48,
      active: false,
    },
    {
      id: 'food',
      name: 'Food & Potions',
      icon: 'golden_apple',
      count: 12,
      active: false,
    },
    {
      id: 'magic',
      name: 'Enchantments',
      icon: 'enchanted_book',
      count: 8,
      active: false,
    },
    {
      id: 'special',
      name: 'VIP Bundles',
      icon: 'nether_star',
      count: 4,
      active: false,
      premium: true,
    },
  ],
  items: [
    // row 0: nav row
    { row: 0, col: 4, kind: 'label', title: "§6Adventurer's Market" },
    {
      row: 0,
      col: 7,
      kind: 'nav',
      action: 'back',
      icon: 'arrow',
      title: '§7← Back',
    },
    {
      row: 0,
      col: 8,
      kind: 'nav',
      action: 'close',
      icon: 'barrier',
      title: '§cClose',
    },
    // rows 1-3: items
    {
      row: 1,
      col: 2,
      kind: 'item',
      icon: 'iron_sword',
      title: 'Iron Sword',
      price: 250,
      lore: '+6 attack damage',
    },
    {
      row: 1,
      col: 3,
      kind: 'item',
      icon: 'diamond_sword',
      title: 'Diamond Sword',
      price: 1200,
      lore: '+7 attack damage',
      states: 2,
    },
    {
      row: 1,
      col: 4,
      kind: 'item',
      icon: 'netherite_sword',
      title: 'Netherite Sword',
      price: 4500,
      lore: '+8 attack damage',
      premium: true,
      template: true,
    },
    {
      row: 1,
      col: 5,
      kind: 'item',
      icon: 'bow',
      title: "Hunter's Bow",
      price: 380,
      lore: 'Power II preloaded',
    },
    {
      row: 1,
      col: 6,
      kind: 'item',
      icon: 'crossbow',
      title: 'Crossbow',
      price: 520,
      lore: 'Quick Charge III',
    },
    {
      row: 1,
      col: 7,
      kind: 'item',
      icon: 'trident',
      title: 'Trident',
      price: 2200,
      lore: 'Loyalty III · Channeling I',
      component: 'ShopGUIPlus',
    },

    {
      row: 2,
      col: 2,
      kind: 'item',
      icon: 'iron_pickaxe',
      title: 'Iron Pickaxe',
      price: 200,
      lore: 'Standard mining tool',
    },
    {
      row: 2,
      col: 3,
      kind: 'item',
      icon: 'diamond_pickaxe',
      title: 'Diamond Pickaxe',
      price: 1100,
      lore: 'Efficiency III',
      selected: true,
    },
    {
      row: 2,
      col: 4,
      kind: 'item',
      icon: 'netherite_pickaxe',
      title: 'Netherite Pickaxe',
      price: 4200,
      lore: 'Fortune II + Eff IV',
      premium: true,
    },
    {
      row: 2,
      col: 5,
      kind: 'item',
      icon: 'iron_axe',
      title: 'Iron Axe',
      price: 220,
      lore: '+9 attack damage',
    },
    {
      row: 2,
      col: 6,
      kind: 'item',
      icon: 'diamond_axe',
      title: 'Diamond Axe',
      price: 1100,
      lore: 'Sharpness II',
    },
    {
      row: 2,
      col: 7,
      kind: 'item',
      icon: 'shears',
      title: 'Shears',
      price: 60,
      lore: 'For wool farming',
    },

    {
      row: 3,
      col: 2,
      kind: 'item',
      icon: 'shield',
      title: 'Reinforced Shield',
      price: 340,
      lore: 'Unbreaking II',
    },
    {
      row: 3,
      col: 3,
      kind: 'item',
      icon: 'elytra',
      title: 'Elytra',
      price: 6800,
      lore: 'VIP rank required',
      premium: true,
      locked: true,
    },
    {
      row: 3,
      col: 4,
      kind: 'item',
      icon: 'fishing_rod',
      title: 'Lucky Rod',
      price: 180,
      lore: 'Luck of the Sea II',
    },
    {
      row: 3,
      col: 5,
      kind: 'item',
      icon: 'flint_and_steel',
      title: 'Flint & Steel',
      price: 25,
      lore: 'Fire-starter',
    },
    {
      row: 3,
      col: 6,
      kind: 'item',
      icon: 'ender_pearl',
      title: 'Ender Pearl ×4',
      price: 90,
      lore: 'Stack of 4',
    },
    {
      row: 3,
      col: 7,
      kind: 'item',
      icon: 'totem',
      title: 'Totem of Undying',
      price: 3200,
      lore: 'Saves you once',
      component: 'QuestX',
    },

    // row 4: pagination
    { row: 4, col: 2, kind: 'page', title: '§7Page 1 of 4' },
    {
      row: 4,
      col: 4,
      kind: 'nav',
      action: 'prev',
      icon: 'arrow_left',
      title: '§e← Previous',
    },
    {
      row: 4,
      col: 5,
      kind: 'nav',
      action: 'next',
      icon: 'arrow_right',
      title: '§eNext →',
    },

    // row 5: footer
    {
      row: 5,
      col: 4,
      kind: 'balance',
      icon: 'emerald',
      title: 'Balance: $4,820',
      lore: '%vault_eco_balance%',
    },
  ],
};

/** Default selected slot when the editor first loads. */
export const DEFAULT_SELECTED = { row: 2, col: 3 } as const;

/** Vanilla item palette (subset) — drives the default Vanilla tab. */
export const VANILLA_ITEMS: string[] = [
  'diamond_sword',
  'iron_sword',
  'netherite_sword',
  'bow',
  'crossbow',
  'trident',
  'diamond_pickaxe',
  'iron_pickaxe',
  'netherite_pickaxe',
  'iron_axe',
  'shears',
  'shield',
  'elytra',
  'diamond_chestplate',
  'diamond_helmet',
  'diamond_boots',
  'golden_apple',
  'enchanted_book',
  'ender_pearl',
  'totem',
  'emerald',
  'nether_star',
  'oak_planks',
  'stone',
  'obsidian',
  'fishing_rod',
  'flint_and_steel',
];

/** Synthetic palettes for the other tabs (assets, questx, templates). */
export const ASSETS_ITEMS: string[] = [
  'shop_bg',
  'vip_crown',
  'sale_tag',
  'daily_box',
  'quest_orb',
  'currency_gem',
  'category_combat',
  'category_armor',
  'category_blocks',
  'category_food',
  'custom_sword_1',
  'custom_sword_2',
  'divider_line',
  'rank_vip',
  'rank_mvp',
  'rank_god',
];

export const QUESTX_ITEMS: string[] = [
  'quest_button',
  'quest_filter_active',
  'quest_filter_completed',
  'quest_filter_locked',
  'quest_paginated',
  'quest_progress_bar',
  'quest_reward',
  'quest_claim',
];

export const TEMPLATE_ITEMS: string[] = [
  'shop_item_basic',
  'shop_item_premium',
  'category_button',
  'nav_back',
  'nav_close',
  'price_emerald',
];

export interface SampleClickActions {
  left: import('@/types/menu').ActionCard[];
  right: import('@/types/menu').ActionCard[];
  'shift-left': import('@/types/menu').ActionCard[];
  'shift-right': import('@/types/menu').ActionCard[];
}

/**
 * Demo click-action data for the selected slot (Diamond Pickaxe).
 * In production this would be loaded from the menu's persisted JSON.
 */
export const SAMPLE_ACTIONS: SampleClickActions = {
  left: [
    {
      tag: 'if',
      kind: 'cond',
      name: 'has_money',
      args: [{ k: 'amount', v: '1100' }],
    },
    {
      tag: 'do',
      kind: 'do',
      n: 1,
      name: 'take_money',
      args: [{ k: 'amount', v: '1100' }],
    },
    {
      tag: 'do',
      kind: 'do',
      n: 2,
      name: 'give_item',
      args: [
        { k: 'material', v: 'DIAMOND_PICKAXE' },
        { k: 'enchants', v: 'efficiency:3, unbreaking:2' },
      ],
    },
    {
      tag: 'do',
      kind: 'do',
      n: 3,
      name: 'send_message',
      args: [{ k: 'text', v: '"§aPurchased! §7-1100$"' }],
    },
    {
      tag: 'do',
      kind: 'do',
      n: 4,
      name: 'play_sound',
      args: [
        { k: 'sound', v: 'ENTITY_PLAYER_LEVELUP' },
        { k: 'volume', v: '0.6' },
      ],
    },
    {
      tag: 'else',
      kind: 'else',
      name: 'send_message',
      args: [{ k: 'text', v: '"§cNot enough money!"' }],
    },
  ],
  right: [
    {
      tag: 'do',
      kind: 'do',
      n: 1,
      name: 'open_menu',
      args: [
        { k: 'id', v: 'item_preview' },
        { k: 'context', v: '%slot_id%' },
      ],
    },
  ],
  'shift-left': [
    {
      tag: 'if',
      kind: 'cond',
      name: 'has_permission',
      args: [{ k: 'node', v: 'shop.bulk' }],
    },
    {
      tag: 'do',
      kind: 'do',
      n: 1,
      name: 'run_command',
      args: [
        { k: 'cmd', v: '/buy DIAMOND_PICKAXE 8' },
        { k: 'as', v: 'player' },
      ],
    },
  ],
  'shift-right': [],
};

/** Helper: find a slot in SHOP_DATA by row/col. */
export const findSlot = (
  data: MenuData,
  row: number,
  col: number
): SlotData | null =>
  data.items.find((s) => s.row === row && s.col === col) ?? null;
