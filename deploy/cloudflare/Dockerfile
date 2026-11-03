# Build context must be produced by scripts/prepare-cloudflare-container.mjs.
# It contains only the application artifact, never the database or credentials.
FROM eclipse-temurin:17-jre-jammy
RUN groupadd --gid 10001 autopost && useradd --uid 10001 --gid autopost --no-create-home autopost \
    && mkdir -p /app /data && chown autopost:autopost /app /data
WORKDIR /app
COPY --chown=autopost:autopost autopost-api.jar /app/autopost-api.jar
ENV SERVER_ADDRESS=0.0.0.0 \
    PORT=8080 \
    DATA_DIR=/data \
    JAVA_TOOL_OPTIONS="-Xms64m -Xmx256m -XX:MaxMetaspaceSize=160m -XX:+ExitOnOutOfMemoryError"
USER 10001:10001
EXPOSE 8080
ENTRYPOINT ["java", "-jar", "/app/autopost-api.jar"]
