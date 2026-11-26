- **Fixed**: Tests opened real tunnels to `connect.artisanmc.app` and could upload packs to
  `cdn.artisanmc.net`: since environment.yml's template writes `web.tunnel` and `web.pack-cdn`,
  the `artisan.web.tunnel` and `artisan.web.pack-cdn` properties the Gradle tests set were only
  defaults and lost to the file. They now win over environment.yml when set. Each test run opened
  about 400 fresh addresses on the production tunnel and used up its Durable Objects quota.
