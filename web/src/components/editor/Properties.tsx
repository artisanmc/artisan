import { PixelSprite } from '@/components/ui/PixelSprite';
import { SAMPLE_ACTIONS } from '@/data/shopData';
import type { ActionCard, ClickType, SlotData } from '@/types/menu';
import { stripMc } from '@/utils/renderMc';
import { cx } from '@/utils/cx';
import styles from './Properties.module.css';

interface PropertiesProps {
  slot: SlotData | null;
  selected: { row: number; col: number };
  click: ClickType;
  onClickChange: (click: ClickType) => void;
}

const CLICK_TABS: { key: ClickType; label: string }[] = [
  { key: 'left', label: 'Left' },
  { key: 'right', label: 'Right' },
  { key: 'shift-left', label: 'Shift+L' },
  { key: 'shift-right', label: 'Shift+R' },
];

function ActionCardView({ action }: { action: ActionCard }) {
  const cardClass = cx(
    styles.actionCard,
    action.kind === 'cond' && styles.cond,
    action.kind === 'do' && styles.do,
    action.kind === 'else' && styles.elseCard
  );
  const tagClass = cx(
    styles.actionTag,
    action.kind === 'cond' && styles.cond,
    action.kind === 'do' && styles.do,
    action.kind === 'else' && styles.elseTag
  );
  const tagText =
    action.kind === 'cond'
      ? 'if'
      : action.kind === 'else'
        ? 'else'
        : `do · ${String(action.n).padStart(2, '0')}`;

  return (
    <div className={cardClass}>
      <div className={styles.actionHeader}>
        <span className={tagClass}>{tagText}</span>
        <div className={styles.actionControls}>
          <button title="Move up" aria-label="Move up">
            ↑
          </button>
          <button title="Move down" aria-label="Move down">
            ↓
          </button>
          <button title="Delete" aria-label="Delete">
            ×
          </button>
        </div>
      </div>
      <div className={styles.actionBody}>
        <span className={styles.k}>{action.name}</span>(
        {action.args.map((arg, j) => (
          <span key={j}>
            {j > 0 && <span className={styles.argSep}>, </span>}
            <span className={styles.argName}>{arg.k}</span>
            <span className={styles.argSep}>: </span>
            <span className={styles.v}>{arg.v}</span>
          </span>
        ))}
        )
      </div>
    </div>
  );
}

function EmptyState({ selected }: { selected: { row: number; col: number } }) {
  return (
    <>
      <div className={styles.header}>
        <div className={styles.headerIcon}>
          <span
            style={{
              color: 'var(--muted)',
              fontSize: 11,
              fontFamily: 'var(--font-mono)',
            }}
          >
            —
          </span>
        </div>
        <div className={styles.headerBody}>
          <div className={styles.headerName}>
            <span className={styles.empty}>Empty slot</span>
          </div>
          <div className={styles.headerMeta}>
            slot[{selected.row}][{selected.col}] · AIR
          </div>
          <div className={styles.tags}>
            <span className={styles.chip}>Drag from palette →</span>
          </div>
        </div>
      </div>
      <div className={styles.section}>
        <div className={styles.sectionHeader}>
          Quick add <span>▾</span>
        </div>
        <div className={styles.addBtnRow}>
          <button className={styles.addBtn}>＋ Item</button>
          <button className={styles.addBtn}>＋ Component</button>
          <button className={styles.addBtn}>＋ Template</button>
          <button className={styles.addBtn}>＋ Background</button>
        </div>
      </div>
    </>
  );
}

function FilledState({
  slot,
  selected,
  click,
  onClickChange,
}: PropertiesProps & { slot: SlotData }) {
  const isDiamondSword = slot.title?.includes('Diamond Sword') ?? false;
  const sampleActions = SAMPLE_ACTIONS[click] ?? [];
  const lorePreview = slot.lore;

  return (
    <>
      <div className={styles.header}>
        <div className={styles.headerIcon}>
          <PixelSprite
            name={slot.icon ?? 'stone'}
            size={36}
            glow={isDiamondSword}
          />
        </div>
        <div className={styles.headerBody}>
          <div className={styles.headerName}>
            {stripMc(slot.title) || 'Slot'}
          </div>
          <div className={styles.headerMeta}>
            slot[{selected.row}][{selected.col}] ·{' '}
            {(slot.icon ?? 'air').toUpperCase()}
          </div>
          <div className={styles.tags}>
            <span className={`${styles.chip} ${styles.active}`}>shop</span>
            <span className={`${styles.chip} ${styles.active}`}>tools</span>
            <span className={styles.chip}>+ tag</span>
          </div>
        </div>
      </div>

      {/* Appearance */}
      <section className={styles.section}>
        <div className={styles.sectionHeader}>
          Appearance <span className={styles.sectionMeta}>5 fields</span>
        </div>

        <div className={styles.field}>
          <div className={styles.fieldLabel}>
            <span>Asset</span>
            <code>asset</code>
          </div>
          <div className={styles.assetField}>
            <div className={styles.assetThumb}>
              <PixelSprite name={slot.icon ?? 'stone'} size={22} />
            </div>
            <input
              className={`${styles.input} ${styles.mono}`}
              defaultValue={slot.icon ?? 'stone'}
              style={{ flex: 1, minWidth: 0 }}
            />
          </div>
        </div>

        <div className={styles.field}>
          <div className={styles.fieldLabel}>
            <span>Material</span>
            <code>material</code>
          </div>
          <input
            className={`${styles.input} ${styles.mono}`}
            defaultValue={(slot.icon ?? 'stone').toUpperCase()}
          />
        </div>

        <div className={styles.row2}>
          <div className={styles.field}>
            <div className={styles.fieldLabel}>
              <span>Count</span>
              <code>1–64</code>
            </div>
            <input className={styles.input} defaultValue={slot.count ?? 1} />
          </div>
          <div className={styles.field}>
            <div className={styles.fieldLabel}>
              <span>Glow</span>
            </div>
            <div className={styles.toggle}>
              <div
                className={cx(styles.switch, isDiamondSword && styles.on)}
              />
              <span className={styles.toggleLabel}>Enchanted</span>
            </div>
          </div>
        </div>

        <div className={styles.field}>
          <div className={styles.fieldLabel}>
            <span>Title</span>
            <code>§ codes ok</code>
          </div>
          <input
            className={`${styles.input} ${styles.mono}`}
            defaultValue={slot.title ?? ''}
          />
        </div>

        <div className={styles.field}>
          <div className={styles.fieldLabel}>
            <span>Lore</span>
            <code>{lorePreview ? '5 lines' : '0 lines'}</code>
          </div>
          <div className={styles.loreBox}>
            {lorePreview ? (
              <>
                <div className={styles.loreLine}>
                  <span className={styles.handle}>⋮⋮</span>
                  <span style={{ color: '#AAAAAA' }}>{lorePreview}</span>
                </div>
                <div className={styles.loreLine}>
                  <span className={styles.handle}>⋮⋮</span>
                  <span style={{ color: '#AAAAAA' }}>Unbreaking II</span>
                </div>
                <div className={styles.loreLine}>
                  <span className={styles.handle}>⋮⋮</span>
                </div>
                <div className={styles.loreLine}>
                  <span className={styles.handle}>⋮⋮</span>
                  <span>
                    <span style={{ color: '#FFFF55' }}>
                      Click to purchase for{' '}
                    </span>
                    <span style={{ color: '#55FF55' }}>${slot.price ?? 0}</span>
                  </span>
                </div>
                <div className={styles.loreLine}>
                  <span className={styles.handle}>⋮⋮</span>
                  <span>
                    <span style={{ color: '#AAAAAA' }}>Balance: </span>
                    <span style={{ color: '#55FFFF' }}>
                      %vault_eco_balance%
                    </span>
                  </span>
                </div>
              </>
            ) : (
              <div className={`${styles.loreLine} ${styles.loreEmpty}`}>
                No lore lines yet
              </div>
            )}
          </div>
          <div className={styles.loreControls}>
            <button className={styles.chipBtn}>+ line</button>
            <button className={styles.chipBtn}>§ color</button>
            <button className={styles.chipBtn}>% placeholder</button>
          </div>
        </div>
      </section>

      {/* Click actions */}
      <section className={styles.section}>
        <div className={styles.sectionHeader}>
          Click actions{' '}
          <span className={styles.sectionMeta}>
            {sampleActions.length} on {click}
          </span>
        </div>

        <div className={styles.clickTabs} role="tablist">
          {CLICK_TABS.map(({ key, label }) => {
            const count = SAMPLE_ACTIONS[key]?.length ?? 0;
            return (
              <button
                key={key}
                role="tab"
                aria-selected={click === key}
                className={cx(styles.clickTab, click === key && styles.active)}
                onClick={() => onClickChange(key)}
              >
                {label}
                {count > 0 && (
                  <span className={styles.clickTabCount}>{count}</span>
                )}
              </button>
            );
          })}
          <button className={`${styles.clickTab} ${styles.clickTabAdd}`}>
            +
          </button>
        </div>

        {sampleActions.map((a, i) => (
          <ActionCardView key={i} action={a} />
        ))}

        {sampleActions.length === 0 && (
          <div className={styles.noActions}>No actions on {click}.</div>
        )}

        <div className={styles.addBtnRow} style={{ marginTop: 8 }}>
          <button className={styles.addBtn}>＋ Action</button>
          <button className={styles.addBtn}>＋ Condition</button>
        </div>
        <button className={styles.addBtn} style={{ marginTop: 6 }}>
          ＋ Cooldown · Fallback · …
        </button>
      </section>

      {/* Cooldown */}
      <section className={styles.section}>
        <div className={styles.sectionHeader}>
          Cooldown <span className={styles.sectionMeta}>3s · player</span>
        </div>
        <div className={styles.row2}>
          <div className={styles.field}>
            <div className={styles.fieldLabel}>
              <span>Duration</span>
              <code>5s · 1m · 1h</code>
            </div>
            <input
              className={`${styles.input} ${styles.mono}`}
              defaultValue="3s"
            />
          </div>
          <div className={styles.field}>
            <div className={styles.fieldLabel}>
              <span>Scope</span>
            </div>
            <input
              className={`${styles.input} ${styles.mono}`}
              defaultValue="player"
            />
          </div>
        </div>
        <div className={styles.field}>
          <div className={styles.fieldLabel}>
            <span>Message if cooling</span>
          </div>
          <input
            className={`${styles.input} ${styles.mono}`}
            defaultValue="§cWait %time_remaining%s before re-buying"
          />
        </div>
      </section>

      {/* View states */}
      <section className={styles.section}>
        <div className={styles.sectionHeader}>
          View states <span className={styles.sectionMeta}>none</span>
        </div>
        <div className={styles.viewStateNote}>
          Override appearance based on conditions — e.g. show "Owned ✓" once
          the player owns this.
        </div>
        <button className={styles.addBtn}>＋ Add conditional state</button>
      </section>

      {/* Advanced */}
      <section className={`${styles.section} ${styles.last}`}>
        <div className={styles.sectionHeader}>
          Advanced <span className={styles.sectionMeta}>·</span>
        </div>
        <div className={styles.addBtnRow}>
          <button className={styles.addBtn}>＋ Permission</button>
          <button className={styles.addBtn}>＋ Save as template</button>
        </div>
      </section>
    </>
  );
}

export function Properties(props: PropertiesProps) {
  const { slot, selected } = props;
  return (
    <aside className={styles.panel} aria-label="Properties">
      <div className={styles.scroll}>
        {slot ? (
          <FilledState {...props} slot={slot} />
        ) : (
          <EmptyState selected={selected} />
        )}
      </div>
    </aside>
  );
}
