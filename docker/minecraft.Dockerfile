# Stage 1: Build the plugin shadow JAR
FROM gradle:8.10-jdk21 AS builder
WORKDIR /build
COPY plugin/ .
RUN gradle shadowJar --no-daemon

# Stage 2: Run Paper 1.21.11
FROM eclipse-temurin:21-jre
WORKDIR /server

RUN apt-get update \
    && apt-get install -y --no-install-recommends curl jq \
    && rm -rf /var/lib/apt/lists/*

RUN BUILD=$(curl -sf https://api.papermc.io/v2/projects/paper/versions/1.21.11 \
        | jq -r '.builds[-1]') \
    && curl -fL \
        "https://api.papermc.io/v2/projects/paper/versions/1.21.11/builds/${BUILD}/downloads/paper-1.21.11-${BUILD}.jar" \
        -o paper.jar

RUN echo "eula=true" > eula.txt

COPY --from=builder /build/build/libs/interfaze-plugin-*-all.jar plugins/InterfazePlugin.jar

COPY docker/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

EXPOSE 25565
ENTRYPOINT ["/entrypoint.sh"]
