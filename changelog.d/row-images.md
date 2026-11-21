- **Added**: An `image` on a menu element that iterates or places rows: each slot shows its own
  18×18 image, chosen per row by the element's states, with the row's tooltip and clicks. The
  resource pack (editor and hub builders) adds one glyph per image and slot row. Without the
  image (pack declined or not rebuilt, Bedrock), the appearance's `material` shows instead.
  The menu schema accepts `image` with `material` or `item` in one look for that fallback (a fixed
  image button still names neither in a look that has an image).
