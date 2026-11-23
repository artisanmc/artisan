- **Added**: A menu element can redraw itself while the menu stays open: `refresh_ticks` on the
  element (**refresh every (seconds)** in the editor, 2 ticks minimum). Its states' conditions,
  texts and placeholders are evaluated again at each period and the slot is sent only when its item
  changed, so a countdown (`{offer.expires_at.until()}`) ticks without reopening the menu.
  `{refresh.n}` counts the redraws, for animations. An element with an image or a label keeps the
  state chosen at opening, since the title cannot change without reopening.
- **Added**: The expression method `mod(n)`, the remainder of a division, never negative
  (`{refresh.n.mod(4)}` cycles 0 to 3).
