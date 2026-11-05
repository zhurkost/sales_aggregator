package by.autopost.address.infrastructure;

import static by.autopost.shared.Json.*;

import by.autopost.address.application.AddressProvider;
import by.autopost.shared.ApiException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.io.IOException;
import java.net.URI;
import java.net.http.*;
import java.time.Duration;
import java.util.List;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

/** HTTP transport, credentials, response limits and provider backoff. */
@Component
public class DadataAddressGateway implements AddressProvider {
  private final URI endpoint;
  private final String authorization;
  private final boolean relay;
  private final HttpClient client =
      HttpClient.newBuilder()
          .connectTimeout(Duration.ofSeconds(4))
          .followRedirects(HttpClient.Redirect.NEVER)
          .build();
  private volatile long cooldownUntil;

  public DadataAddressGateway(
      @Value("${autopost.dadata-key:}") String key,
      @Value("${autopost.dadata-relay-url:}") String relayUrl,
      @Value("${autopost.dadata-relay-token:}") String relayToken) {
    relay = !relayUrl.isBlank();
    if (relay) {
      endpoint = URI.create(relayUrl.strip());
      if (!"https".equals(endpoint.getScheme())
          || endpoint.getHost() == null
          || endpoint.getUserInfo() != null
          || endpoint.getQuery() != null
          || endpoint.getFragment() != null)
        throw new IllegalArgumentException(
            "DADATA_RELAY_URL must be an HTTPS endpoint without credentials, query or fragment");
      if (relayToken.strip().length() < 32)
        throw new IllegalArgumentException(
            "DADATA_RELAY_TOKEN must contain at least 32 characters");
      authorization = "Bearer " + relayToken.strip();
    } else {
      endpoint = URI.create("https://suggestions.dadata.ru/suggestions/api/4_1/rs/suggest/address");
      authorization = key.isBlank() ? "" : "Token " + key.strip();
    }
  }

  public boolean configured() {
    return !authorization.isEmpty();
  }

  public JsonNode fetch(String query, int count) {
    if (System.currentTimeMillis() < cooldownUntil)
      throw new ApiException(429, "Сервис адресов просит подождать. Введённые данные сохранены.");
    if (!configured())
      throw new ApiException(
          503, "Адресные подсказки ещё не подключены. Адрес можно заполнить вручную.");
    var request = buildRequest(query, count);
    try {
      var response = client.send(request, HttpResponse.BodyHandlers.ofInputStream());
      try (var stream = response.body()) {
        int status = response.statusCode();
        if (status == 429 || status >= 500) {
          long retry = 60;
          try {
            retry =
                Math.max(
                    60,
                    Math.min(
                        3600,
                        Long.parseLong(response.headers().firstValue("Retry-After").orElse("60"))));
          } catch (NumberFormatException ignored) {
          }
          synchronized (this) {
            cooldownUntil = System.currentTimeMillis() + retry * 1000;
          }
          throw new ApiException(
              503,
              "Подсказки временно недоступны. Можно сохранить адрес вручную и повторить позже.");
        }
        if (status != 200)
          throw new ApiException(
              503,
              "Не удалось получить адресные подсказки. Проверьте подключение сервиса или заполните"
                  + " адрес вручную.");
        byte[] bytes = stream.readNBytes(256001);
        if (bytes.length > 256000)
          throw new ApiException(502, "Ответ сервиса адресов слишком большой.");
        JsonNode result = MAPPER.readTree(bytes);
        if (!result.path("suggestions").isArray())
          throw new ApiException(502, "Не удалось прочитать ответ сервиса адресов.");
        return result.path("suggestions");
      }
    } catch (InterruptedException e) {
      Thread.currentThread().interrupt();
      throw new ApiException(503, "Поиск адреса прерван. Повторите запрос.");
    } catch (IOException e) {
      throw new ApiException(
          503, "Сервис адресов не ответил. Введённый адрес можно сохранить вручную.");
    }
  }

  public HttpRequest buildRequest(String query, int count) {
    ObjectNode body = object("query", query, "count", count);
    if (!relay) {
      body.set("locations", array(List.of(object("country", "Беларусь"))));
      body.put("restrict_value", true);
    }
    return HttpRequest.newBuilder(endpoint)
        .timeout(Duration.ofSeconds(relay ? 12 : 10))
        .header("Content-Type", "application/json")
        .header("Accept", "application/json")
        .header("User-Agent", "Autopost-Address-Service/1.0")
        .header("Authorization", authorization)
        .POST(HttpRequest.BodyPublishers.ofString(body.toString()))
        .build();
  }
}
