import { useMemo } from 'react';
import { PixelSprite } from '@/components/ui/PixelSprite';
import {
  ASSETS_ITEMS,
  QUESTX_ITEMS,
  TEMPLATE_ITEMS,
  VANILLA_ITEMS,
} from '@/data/shopData';
import type { PaletteKind, PaletteTabKey } from '@/types/menu';
import { cx } from '@/utils/cx';
import styles from './Palette.module.css';

interface PaletteProps {
  activeTab: PaletteTabKey;
  onTabChange: (tab: PaletteTabKey) => void;
  search: string;
  onSearchChange: (search: string) => void;
}

interface TabDef {
  key: PaletteTabKey;
  label: string;
  count: string;
  kind: PaletteKind;
  title: string;
  items: string[];
  /** Footer text. */
  foot: string;
  /** Optional inline action label rendered as a link in the footer. */
  footAction?: string;
}

const TABS: TabDef[] = [
  {
    key: 'vanilla',
    label: 'Vanilla',
    count: '374',
    kind: 'vanilla',
    title: 'Vanilla materials',
    items: VANILLA_ITEMS,
    foot: 'Drag to canvas →',
  },
  {
    key: 'assets',
    label: 'Assets',
    count: '47',
    kind: 'assets',
    title: 'My uploaded assets',
    items: ASSETS_ITEMS,
    foot: '47 / 200 MB',
    footAction: '+ Upload',
  },
  {
    key: 'questx',
    label: 'QuestX',
    count: '8',
    kind: 'plugin',
    title: 'QuestX components',
    items: QUESTX_ITEMS,
    foot: 'questx v2.1.4 connected',
  },
  {
    key: 'tpl',
    label: 'Templates',
    count: '12',
    kind: 'tpl',
    title: 'Saved templates',
    items: TEMPLATE_ITEMS,
    foot: '12 saved',
    footAction: '+ New',
  },
];

/**
 * Pick a deterministic vanilla sprite to stand in for non-vanilla palette
 * entries. Keeps the demo visually populated without inventing fake textures.
 */
const STAND_IN: Record<Exclude<PaletteKind, 'vanilla'>, string[]> = {
  assets: [
    'paper',
    'enchanted_book',
    'golden_apple',
    'emerald',
    'nether_star',
    'totem',
  ],
  plugin: ['enchanted_book', 'totem', 'golden_apple', 'emerald'],
  tpl: [
    'diamond_sword',
    'iron_pickaxe',
    'emerald',
    'arrow_left',
    'barrier',
    'golden_apple',
  ],
};

export function Palette({
  activeTab,
  onTabChange,
  search,
  onSearchChange,
}: PaletteProps) {
  const tab = TABS.find((t) => t.key === activeTab) ?? TABS[0];

  const filtered = useMemo(() => {
    if (tab.kind !== 'vanilla') return tab.items;
    const q = search.toLowerCase();
    return tab.items.filter((n) => !q || n.includes(q));
  }, [tab, search]);

  const totalCount = tab.count;
  const shownCount = tab.kind === 'vanilla' ? filtered.length : tab.items.length;

  return (
    <aside className={styles.panel} aria-label="Item palette">
      <div className={styles.tabs} role="tablist">
        {TABS.map((t) => (
          <button
            key={t.key}
            role="tab"
            aria-selected={activeTab === t.key}
            className={cx(
              styles.tab,
              activeTab === t.key && styles.active,
              t.kind === 'plugin' && styles.plugin
            )}
            onClick={() => onTabChange(t.key)}
          >
            {t.label}
            <span className={styles.tabCount}>{t.count}</span>
          </button>
        ))}
      </div>

      <div className={styles.search}>
        <svg
          className={styles.searchIcon}
          width="14"
          height="14"
          viewBox="0 0 14 14"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
        >
          <circle cx="6" cy="6" r="4" />
          <path d="M9 9l3 3" />
        </svg>
        <input
          placeholder={`Search ${tab.title.toLowerCase()}…`}
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
        />
        <kbd className={styles.searchKbd}>/</kbd>
      </div>

      <div className={styles.header}>
        <span>{tab.title}</span>
        <span className={styles.headerNum}>
          {shownCount} / {totalCount}
        </span>
      </div>

      <div className={styles.grid}>
        {filtered.slice(0, 32).map((name) => {
          const standIn =
            tab.kind === 'vanilla'
              ? name
              : STAND_IN[tab.kind][name.length % STAND_IN[tab.kind].length];
          return (
            <div
              key={name}
              className={cx(
                styles.cell,
                tab.kind === 'plugin' && styles.plugin,
                tab.kind === 'tpl' && styles.tpl,
                tab.kind === 'assets' && styles.assets
              )}
              draggable
            >
              <PixelSprite name={standIn} size={tab.kind === 'vanilla' ? 28 : 26} />
              <div className={styles.cellName}>{name}</div>
            </div>
          );
        })}
      </div>

      <div className={styles.foot}>
        <span>{tab.foot}</span>
        {tab.footAction && <a>{tab.footAction}</a>}
      </div>
    </aside>
  );
}
