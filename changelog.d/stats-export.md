- **Added**: Rankings and player profiles on your website. Add-ons declare **player metrics**
  (`StatsApi.declareMetric`, `setMetric`, API 1.8.0); Artisan provides play time and the Vault
  balance. With `stats-export` set in `environment.yml`, one server pushes the values that
  changed to the website every 2 minutes, over HTTPS, with no port to open; the website keeps
  them while the server is off. `/artisan stats forget` also erases the player there. A metric declared
  `cumulative()` (play time) can also be ranked per week, month and quarter by the website.
