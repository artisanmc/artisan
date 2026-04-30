import styles from './Toolbar.module.css';

interface ToolbarProps {
  /** Current "server" context shown in breadcrumb (e.g. shieldcraft-prod). */
  server: string;
  /** Menu file name (e.g. shop_main). */
  menuName: string;
  /** Number of unsaved/draft changes. */
  draftChanges: number;
  /** Last save timestamp (relative). */
  lastSaved: string;
  /** Build/version short hash. */
  version: string;
}

export function Toolbar({
  server,
  menuName,
  draftChanges,
  lastSaved,
  version,
}: ToolbarProps) {
  return (
    <div className={styles.toolbar}>
      <div className={styles.logo}>i/</div>
      <div className={styles.divider} />
      <div className={styles.crumb}>
        <span className={styles.crumbServer}>
          <svg
            width="11"
            height="11"
            viewBox="0 0 11 11"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.4"
          >
            <rect x="1" y="2" width="9" height="6" rx="1" />
            <path d="M3 2v6M7 2v6" />
          </svg>
          {server}
        </span>
        <span className={styles.crumbSep}>›</span>
        <span>menus</span>
        <span className={styles.crumbSep}>›</span>
        <span className={styles.here}>{menuName}</span>
      </div>
      <span className={`${styles.badge} ${styles.badgeDraft}`}>
        Draft · {draftChanges} changes
      </span>
      <div className={styles.spacer} />
      <span className={styles.saveind}>
        <span className={styles.saveindOk}>●</span> saved {lastSaved} · {version}
      </span>
      <div className={styles.divider} />
      <button className={styles.btn} title="Undo">
        ↶<kbd className={styles.kshort}>⌘Z</kbd>
      </button>
      <button className={styles.btn} title="Redo">
        ↷
      </button>
      <div className={styles.divider} />
      <button className={styles.btn}>
        {'{ }'} JSON<span className={styles.kshort}>⌘E</span>
      </button>
      <button className={styles.btn}>⏱ History</button>
      <button className={styles.btn}>
        ▷ Preview<span className={styles.kshort}>⌘⇧P</span>
      </button>
      <button className={`${styles.btn} ${styles.btnPrimary}`}>
        Publish<span className={styles.kshort}>⌘P</span>
      </button>
    </div>
  );
}
