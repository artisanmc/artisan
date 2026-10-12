rootProject.name = "artisan-plugin"

include("api", "core", "database", "paper")

project(":api").name = "artisan-api"
project(":core").name = "artisan-core"
project(":database").name = "artisan-database"
project(":paper").name = "artisan-paper"
