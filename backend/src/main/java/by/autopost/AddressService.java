package by.autopost;

import static by.autopost.shared.Json.*;

import by.autopost.shared.ApiException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.*;
import java.io.*;
import java.net.URI;
import java.net.http.*;
import java.time.Duration;
import java.util.*;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

/** Provider-backed selection; an OSM identifier is never a marketplace identifier. */
@Service
public class AddressService {
  private final URI endpoint;
  private final String authorization;
  private final boolean relay;
  private final HttpClient client =
      HttpClient.newBuilder()
          .connectTimeout(Duration.ofSeconds(4))
          .followRedirects(HttpClient.Redirect.NEVER)
          .build();
  private final Map<String, Entry> cache = new LinkedHashMap<>();
  private final Map<String, long[]> budgets = new HashMap<>();
  private long cooldownUntil;
  private long secondWindow;
  private int secondRequests;

  record Entry(long expires, String workspace, JsonNode suggestion) {}

  AddressService(
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

  synchronized void budget(String workspace) {
    long now = System.currentTimeMillis();
    if (now < cooldownUntil)
      throw new ApiException(429, "Сервис адресов просит подождать. Введённые данные сохранены.");
    if (now - secondWindow >= 1000) {
      secondWindow = now;
      secondRequests = 0;
    }
    if (secondRequests >= 10)
      throw new ApiException(429, "Подождите секунду перед следующим поиском адреса.");
    secondRequests++;
    budgets.entrySet().removeIf(e -> e.getValue()[1] < now);
    for (String id : List.of("all", "workspace:" + workspace)) {
      long[] b = budgets.computeIfAbsent(id, k -> new long[] {0, now + 60000});
      if (b[0] >= (id.equals("all") ? 300 : 60))
        throw new ApiException(429, "Слишком много запросов адреса. Подождите минуту.");
      b[0]++;
    }
  }

  JsonNode fetch(String query, int count) {
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

  HttpRequest buildRequest(String query, int count) {
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

  public synchronized ObjectNode suggest(String workspace, String query) {
    query = query.strip();
    if (query.length() < 3 || query.length() > 300)
      throw new ApiException(400, "Введите от 3 до 300 символов адреса.");
    prune();
    String queryKey = "q:" + workspace + ":" + by.autopost.shared.Text.normalized(query);
    Entry hit = cache.get(queryKey);
    if (hit != null) return (ObjectNode) hit.suggestion.deepCopy();
    budget(workspace);
    ArrayNode suggestions = array();
    for (var s : fetch(query, 8)) {
      if (!text(s.path("data"), "country_iso_code").equals("BY")) continue;
      String id = UUID.randomUUID().toString();
      cache.put(id, new Entry(System.currentTimeMillis() + 1200000, workspace, s.deepCopy()));
      suggestions.add(object("id", id, "label", text(s, "value"), "address", normalize(s)));
    }
    ObjectNode result = object("suggestions", suggestions, "provider", "dadata");
    cache.put(
        queryKey, new Entry(System.currentTimeMillis() + 300000, workspace, result.deepCopy()));
    return result;
  }

  public synchronized ObjectNode select(String workspace, String id) {
    prune();
    Entry selected = cache.get(id);
    if (selected == null || !selected.workspace.equals(workspace) || id.startsWith("q:"))
      throw new ApiException(409, "Подсказка устарела. Найдите адрес ещё раз.");
    budget(workspace);
    JsonNode old = selected.suggestion;
    String query = text(old, "unrestricted_value");
    if (query.isEmpty()) query = text(old, "value");
    JsonNode found = fetch(query, 1);
    if (found.size() != 1)
      throw new ApiException(409, "Адрес не удалось подтвердить. Выберите его ещё раз.");
    JsonNode next = found.get(0);
    String oldId = text(old.path("data"), "fias_id"), nextId = text(next.path("data"), "fias_id");
    if (!text(next.path("data"), "country_iso_code").equals("BY")
        || (!oldId.isEmpty()
            ? !oldId.equals(nextId)
            : !text(old, "value").equals(text(next, "value"))))
      throw new ApiException(409, "Сервис вернул другой адрес. Уточните выбор.");
    for (String part : List.of("city", "settlement", "street", "house", "block")) {
      String previous = text(old.path("data"), part);
      if (!previous.isEmpty()
          && !by.autopost.shared.Text.normalized(previous)
              .equals(by.autopost.shared.Text.normalized(text(next.path("data"), part))))
        throw new ApiException(409, "Сервис уточнил адрес иначе. Найдите нужный дом ещё раз.");
    }
    ObjectNode address = normalize(next);
    address.put("confirmed", true);
    address.put("confirmedAt", java.time.Instant.now().toString());
    return object("address", address);
  }

  private void prune() {
    long now = System.currentTimeMillis();
    cache.entrySet().removeIf(e -> e.getValue().expires < now);
    while (cache.size() > 1000) cache.remove(cache.keySet().iterator().next());
  }

  static ObjectNode normalize(JsonNode s) {
    JsonNode d = s.path("data");
    String settlement = text(d, "settlement_with_type");
    if (settlement.isEmpty()) settlement = text(d, "city_with_type");
    if (settlement.isEmpty()) settlement = text(d, "city");
    String house = text(d, "house");
    String block = text(d, "block");
    ObjectNode a =
        object(
            "provider",
            "dadata",
            "sourceId",
            text(d, "fias_id"),
            "label",
            text(s, "value"),
            "countryIso",
            "BY",
            "region",
            text(d, "region_with_type"),
            "district",
            text(d, "area_with_type"),
            "settlement",
            settlement,
            "street",
            text(d, "street_with_type"),
            "house",
            house,
            "block",
            block,
            "blockType",
            text(d, "block_type"),
            "precision",
            text(d, "qc_geo"),
            "confirmed",
            false,
            "level",
            house.isEmpty() ? (text(d, "street").isEmpty() ? "settlement" : "street") : "house");
    // Foreign Belarus addresses legitimately have fias_level=-1. Assess actual parts, not Russian
    // levels.
    for (var axis : Map.of("latitude", "geo_lat", "longitude", "geo_lon").entrySet()) {
      String v = text(d, axis.getValue());
      if (v.matches("-?\\d+(?:\\.\\d+)?")) a.put(axis.getKey(), v);
    }
    return a;
  }
}
