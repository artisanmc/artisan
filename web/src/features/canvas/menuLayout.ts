export const SLOT_SIZE = 32;
export const SLOT_GAP = 2;
export const GRID_PADDING = 8;
export const COLS = 9;
export const MENU_HEADER_HEIGHT = 24;

export const COMMAND_BOX = { width: 140, height: 48 };

export const menuBoxSize = (rows: number) => ({
  width: GRID_PADDING * 2 + COLS * SLOT_SIZE + (COLS - 1) * SLOT_GAP,
  height: GRID_PADDING * 2 + MENU_HEADER_HEIGHT + rows * SLOT_SIZE + (rows - 1) * SLOT_GAP,
});

export const slotPos = (index: number) => ({
  col: index % COLS,
  row: Math.floor(index / COLS),
});

export const slotXY = (index: number) => {
  const { col, row } = slotPos(index);
  return {
    x: GRID_PADDING + col * (SLOT_SIZE + SLOT_GAP),
    y: GRID_PADDING + MENU_HEADER_HEIGHT + row * (SLOT_SIZE + SLOT_GAP),
  };
};
