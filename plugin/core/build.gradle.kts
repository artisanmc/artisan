// Domaine d'Artisan : projets, menus, langage d'actions, expressions, protocole.
// Aucune dépendance de plateforme : un import org.bukkit ici ne compile pas.
dependencies {
    implementation(project(":artisan-api"))
    implementation("com.fasterxml.jackson.dataformat:jackson-dataformat-yaml:2.17.2")
    implementation("com.fasterxml.jackson.module:jackson-module-kotlin:2.17.2")
}
