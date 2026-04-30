import styles from './StatusBar.module.css';

interface StatusBarProps {
  server: string;
  playerCount: number;
  lastSync: string;
  version: string;
  user: string;
  wsConnected: boolean;
}

export function StatusBar({
  server,
  playerCount,
  lastSync,
  version,
  user,
  wsConnected,
}: StatusBarProps) {
  return (
    <footer className={styles.bar}>
      <span className={styles.item}>
        <span
          className={wsConnected ? styles.dot : `${styles.dot} ${styles.warn}`}
        />
        WS · live edit {wsConnected ? 'on' : 'reconnecting'}
      </span>
      <span className={styles.divider} />
      <span className={styles.item}>{server}</span>
      <span className={`${styles.item} ${styles.muted2}`}>
        {playerCount} players
      </span>
      <span className={styles.flex} />
      <span className={styles.item}>last sync {lastSync}</span>
      <span className={styles.divider} />
      <span className={styles.item}>{version}</span>
      <span className={styles.divider} />
      <span className={styles.item}>@{user}</span>
    </footer>
  );
}
