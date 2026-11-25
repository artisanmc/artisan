- **Added**: a theme's colours are picked on its page, one per family of Artisan's images:
  main (buttons), danger, accent and neutral. The shades of a family follow the colour picked,
  the menu beside shows the result before anything is written, and **Save the colours** writes
  them in the theme's `overrides/colors.yml` (the pack is rebuilt when the theme is in place).
  The page also opens the theme's folder, where a draft of it is deployed.
- **Added**: the assistant computes a theme's colours the same way (`theme_colours`: one colour
  per family, the whole table returned) and sees the families (`survey_ui`'s `kit_ramps`).
