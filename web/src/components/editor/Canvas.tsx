import { PixelSprite } from '@/components/ui/PixelSprite';
import { findSlot, SHOP_DATA } from '@/data/shopData';
import type { Category, SlotData } from '@/types/menu';
import { cx } from '@/utils/cx';
import styles from './Canvas.module.css';

interface CanvasProps {
  selected: { row: number; col: number };
  onSelect: (row: number, col: number) => void;
  leftPanelOpen: boolean;
  rightPanelOpen: boolean;
  onToggleLeft: () => void;
  onToggleRight: () => void;
}

const ROWS = 6;
const COLS = 9;

interface SlotContentsProps {
  isCat: boolean;
  cat: Category | null;
  item: SlotData | null;
}

function SlotContents({ isCat, cat, item }: SlotContentsProps) {
  if (isCat && cat) {
    return <PixelSprite name={cat.icon} size={32} />;
  }
  if (!item) return null;

  const isDiamondSword = item.title?.includes('Diamond Sword') ?? false;

  return (
    <>
      {item.icon && (
        <PixelSprite name={item.icon} size={32} glow={isDiamondSword} />
      )}
      {item.kind === 'item' && (
        <span className={styles.slotPrice}>${item.price}</span>
      )}
      {item.kind === 'item' && item.count && item.count > 1 && (
        <span className={styles.slotCount}>{item.count}</span>
      )}
      <div className={styles.cornerBadges}>
        {item.template && (
          <span className={`${styles.cornerBadge} ${styles.cbT}`}>T</span>
        )}
        {item.states && (
          <span className={`${styles.cornerBadge} ${styles.cbS}`}>
            +{item.states}
          </span>
        )}
        {item.component && (
          <span className={`${styles.cornerBadge} ${styles.cbC}`}>·</span>
        )}
        {item.locked && (
          <span className={`${styles.cornerBadge} ${styles.cbL}`}>⚿</span>
        )}
      </div>
    </>
  );
}

export function Canvas({
  selected,
  onSelect,
  leftPanelOpen,
  rightPanelOpen,
  onToggleLeft,
  onToggleRight,
}: CanvasProps) {
  return (
    <main className={styles.wrap}>
      <div className={styles.toolbar}>
        <button className={styles.iconBtn} onClick={onToggleLeft}>
          {leftPanelOpen ? '⟨' : '⟩'} {leftPanelOpen ? 'Hide' : 'Show'} palette
          <span className={styles.kbHint}>[</span>
        </button>
        <span className={styles.flex} />
        <span>shop_main · 6 × 9 · 18 / 54 used</span>
        <span className={styles.smallDivider} />
        <button className={styles.iconBtn}>−</button>
        <span>100%</span>
        <button className={styles.iconBtn}>+</button>
        <span className={styles.smallDivider} />
        <button className={`${styles.iconBtn} ${styles.active}`}>⊞ Grid</button>
        <button className={styles.iconBtn}>⌗ Snap</button>
        <span className={styles.flex} />
        <button className={styles.iconBtn} onClick={onToggleRight}>
          {rightPanelOpen ? 'Hide' : 'Show'} props {rightPanelOpen ? '⟩' : '⟨'}
          <span className={styles.kbHint}>]</span>
        </button>
      </div>

      <div className={styles.canvas}>
        <div className={styles.canvasDots} />
        <div className={styles.canvasGlow} />
        <div className={styles.invframe}>
          <div className={styles.invtitle}>
            <span>
              <b>{SHOP_DATA.menuName}</b> &nbsp;·&nbsp; size: {ROWS * COLS}{' '}
              &nbsp;·&nbsp;{' '}
              <span className={styles.gold}>§6{SHOP_DATA.menuTitle}</span>
            </span>
            <span className={styles.invtitleRight}>
              <span>page 1 / 4</span>
              <span className={styles.invtitleAccent}>
                ● slot[{selected.row}][{selected.col}]
              </span>
            </span>
          </div>

          <div className={styles.grid} role="grid">
            {Array.from({ length: ROWS * COLS }).map((_, i) => {
              const r = Math.floor(i / COLS);
              const c = i % COLS;
              const isCat = c === 0;
              const cat = isCat ? SHOP_DATA.categories[r] ?? null : null;
              const item = !isCat ? findSlot(SHOP_DATA, r, c) : null;
              const isSel = selected.row === r && selected.col === c;
              const isDiamondSword =
                item?.title?.includes('Diamond Sword') ?? false;

              return (
                <div
                  key={i}
                  role="gridcell"
                  aria-selected={isSel}
                  className={cx(
                    styles.slot,
                    isCat && styles.cat,
                    isCat && cat?.active && styles.activeCat,
                    isSel && styles.selected,
                    !isCat && !item && styles.empty,
                    isDiamondSword && styles.glowEnchant
                  )}
                  onClick={() => onSelect(r, c)}
                  title={isCat ? cat?.name : item?.title}
                >
                  <SlotContents isCat={isCat} cat={cat} item={item} />
                  {isCat && cat?.premium && (
                    <div className={styles.cornerBadges}>
                      <span
                        className={`${styles.cornerBadge} ${styles.cbS}`}
                      >
                        ★
                      </span>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          <div className={styles.invfoot}>
            <span>↕ Resize · 6 rows</span>
            <span>
              uses_plugins:{' '}
              <span className={styles.pluginRef}>QuestX</span>{' '}
              <span className={styles.pluginRef}>ShopGUIPlus</span>{' '}
              <span className={styles.pluginRef}>Vault</span>
            </span>
            <span>sample · all data demo</span>
          </div>
        </div>
      </div>
    </main>
  );
}
