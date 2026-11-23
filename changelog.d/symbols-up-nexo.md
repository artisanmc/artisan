- **Fixed**: Behind Nexo, Unifont symbols in HUD (action bar) texts showed as a placeholder: Nexo
  replaced `symbols_up.png`, whose 272 px cells exceed its 256 px limit. The rising fonts now draw
  symbols from a 256 px cell sheet up to a rise of 120 px, and from a half-resolution sheet
  (`symbols_up_half.png`) from 121 to 128 px. The symbol sheets hold up to 16 symbols per row.
