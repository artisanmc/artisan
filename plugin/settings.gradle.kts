rootProject.name = "artisan-plugin"

include("api", "core", "database", "hub", "paper")

project(":api").name = "artisan-api"
project(":core").name = "artisan-core"
project(":database").name = "artisan-database"
project(":hub").name = "artisan-hub"
project(":paper").name = "artisan-paper"
