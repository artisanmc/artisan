import { useEffect, useState, type CSSProperties } from 'react';
import { DEFAULT_SELECTED, findSlot, SHOP_DATA } from '@/data/shopData';
import type { ClickType, PaletteTabKey } from '@/types/menu';
import { Canvas } from './Canvas';
import { Palette } from './Palette';
import { Properties } from './Properties';
import { StatusBar } from './StatusBar';
import { Toolbar } from './Toolbar';
import styles from './Editor.module.css';

/**
 * Editor — top-level composition for the Interfaze menu editor.
 * Owns selection, palette tab, click-action tab, and panel collapse state.
 *
 * Direction: Modern dev-tool (Direction A from the design canvas).
 * Aesthetic: Linear/Vercel-adjacent dark UI, purple accent, JetBrains Mono
 * for metadata, pixel sprites for vanilla items in the palette.
 */
export function Editor() {
  const [selected, setSelected] = useState<{ row: number; col: number }>(
    DEFAULT_SELECTED
  );
  const [paletteTab, setPaletteTab] = useState<PaletteTabKey>('vanilla');
  const [search, setSearch] = useState('');
  const [click, setClick] = useState<ClickType>('left');
  const [leftPanelOpen, setLeftPanelOpen] = useState(true);
  const [rightPanelOpen, setRightPanelOpen] = useState(true);

  // Keyboard shortcuts: [ toggles left, ] toggles right, / focuses search.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target && (e.target as HTMLElement).tagName === 'INPUT') return;
      if (e.key === '[') setLeftPanelOpen((v) => !v);
      else if (e.key === ']') setRightPanelOpen((v) => !v);
      else if (e.key === '/') {
        e.preventDefault();
        const input = document.querySelector<HTMLInputElement>(
          'input[placeholder^="Search"]'
        );
        input?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const slot =
    selected.col === 0
      ? null
      : findSlot(SHOP_DATA, selected.row, selected.col);

  const cols = `${leftPanelOpen ? 'var(--left-panel-w)' : '0'} 1fr ${rightPanelOpen ? 'var(--right-panel-w)' : '0'}`;

  return (
    <div
      className={styles.shell}
      style={{ '--cols': cols } as CSSProperties & Record<string, string>}
    >
      <Toolbar
        server="shieldcraft-prod"
        menuName={SHOP_DATA.menuName}
        draftChanges={2}
        lastSaved="2s ago"
        version="v8a3f1c2"
      />

      <div className={styles.body}>
        <Palette
          activeTab={paletteTab}
          onTabChange={setPaletteTab}
          search={search}
          onSearchChange={setSearch}
        />
        <Canvas
          selected={selected}
          onSelect={(row, col) => setSelected({ row, col })}
          leftPanelOpen={leftPanelOpen}
          rightPanelOpen={rightPanelOpen}
          onToggleLeft={() => setLeftPanelOpen((v) => !v)}
          onToggleRight={() => setRightPanelOpen((v) => !v)}
        />
        <Properties
          slot={slot}
          selected={selected}
          click={click}
          onClickChange={setClick}
        />
      </div>

      <StatusBar
        server="shieldcraft-prod"
        playerCount={28}
        lastSync="1.2s ago"
        version="v8a3f1c2"
        user="you"
        wsConnected
      />
    </div>
  );
}
