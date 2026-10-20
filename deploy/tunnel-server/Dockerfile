# Artisan editor tunnel server (ADR `editor-tunnel`). Context: the repository root.
FROM eclipse-temurin:21-jdk AS build
WORKDIR /src/plugin
COPY plugin/ ./
RUN ./gradlew --no-daemon :artisan-tunnel-server:shadowJar

FROM eclipse-temurin:21-jre
WORKDIR /app
COPY --from=build /src/plugin/tunnel-server/build/libs/artisan-tunnel-server-*-all.jar /app/tunnel-server.jar
EXPOSE 8080
USER 1000
CMD ["java", "-Xmx256m", "-jar", "/app/tunnel-server.jar"]
