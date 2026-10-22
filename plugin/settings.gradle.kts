rootProject.name = "artisan-plugin"

include("api", "core", "database", "hub", "runtime", "paper", "tunnel", "tunnel-server", "geyser-extension")

project(":api").name = "artisan-api"
project(":core").name = "artisan-core"
project(":database").name = "artisan-database"
project(":hub").name = "artisan-hub"
project(":runtime").name = "artisan-runtime"
project(":paper").name = "artisan-paper"
project(":tunnel").name = "artisan-tunnel"
project(":tunnel-server").name = "artisan-tunnel-server"
project(":geyser-extension").name = "artisan-geyser"
