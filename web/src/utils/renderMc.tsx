import { Fragment, type ReactNode } from 'react';

/**
 * Minecraft §-color code map. §0-§f are colors, §l bold, §o italic, §r reset.
 * The plugin renders these in-game; the editor mirrors them so admins see
 * what players will see.
 */
const COLOR_MAP: Record<string, string> = {
  '0': '#000000',
  '1': '#0000aa',
  '2': '#00aa00',
  '3': '#00aaaa',
  '4': '#aa0000',
  '5': '#aa00aa',
  '6': '#ffaa00',
  '7': '#aaaaaa',
  '8': '#555555',
  '9': '#5555ff',
  a: '#55ff55',
  b: '#55ffff',
  c: '#ff5555',
  d: '#ff55ff',
  e: '#ffff55',
  f: '#ffffff',
};

interface Cursor {
  color: string;
  bold: boolean;
  italic: boolean;
}

const RESET: Cursor = { color: '#E6E7EA', bold: false, italic: false };

interface Span extends Cursor {
  text: string;
}

/**
 * Parse a Minecraft-formatted string into styled spans.
 * Returns null for empty input. Spans are React nodes ready to render.
 */
export function renderMc(s: string | undefined): ReactNode {
  if (!s) return null;
  const parts: Span[] = [];
  let cur: Cursor = { ...RESET };
  let buf = '';
  let i = 0;

  while (i < s.length) {
    if (s[i] === '§' && i + 1 < s.length) {
      if (buf) {
        parts.push({ ...cur, text: buf });
        buf = '';
      }
      const code = s[i + 1].toLowerCase();
      if (COLOR_MAP[code]) {
        cur = { ...cur, color: COLOR_MAP[code], bold: false, italic: false };
      } else if (code === 'l') {
        cur = { ...cur, bold: true };
      } else if (code === 'o') {
        cur = { ...cur, italic: true };
      } else if (code === 'r') {
        cur = { ...RESET };
      }
      i += 2;
    } else {
      buf += s[i++];
    }
  }
  if (buf) parts.push({ ...cur, text: buf });

  return parts.map((p, idx) => (
    <Fragment key={idx}>
      <span
        style={{
          color: p.color,
          fontWeight: p.bold ? 700 : 400,
          fontStyle: p.italic ? 'italic' : 'normal',
        }}
      >
        {p.text}
      </span>
    </Fragment>
  ));
}

/** Strip §-codes for plain-text rendering (e.g., property panel name). */
export const stripMc = (s: string | undefined): string =>
  s ? s.replace(/§./g, '') : '';
