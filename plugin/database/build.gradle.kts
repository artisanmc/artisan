dependencies {
    implementation(project(":artisan-api"))
    // HikariCP et les pilotes JDBC ne sont pas embarqués : Paper les télécharge depuis
    // `libraries:` de plugin.yml. Garder les deux listes alignées.
    compileOnly("com.zaxxer:HikariCP:6.2.1")
    testImplementation("com.zaxxer:HikariCP:6.2.1")
    testImplementation("com.h2database:h2:2.3.232")
}
