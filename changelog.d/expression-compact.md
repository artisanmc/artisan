- **Added**: The expression method `compact()` shortens a number to fit a small space:
  `{guild.balance.compact()}` reads `18.4K`, then `184K`, `1.8M`, `250B`, `12T` (as is below
  10,000, rounded toward zero, five characters at most up to 999T).
