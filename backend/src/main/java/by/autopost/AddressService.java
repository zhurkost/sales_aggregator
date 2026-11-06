package by.autopost;

import static by.autopost.shared.Json.*;

import by.autopost.address.application.AddressProvider;
import by.autopost.address.application.StreetKind;
import by.autopost.shared.ApiException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.*;
import java.util.*;
import org.springframework.stereotype.Service;

/** Provider-backed selection; an OSM identifier is never a marketplace identifier. */
@Service
public class AddressService {
  private final AddressProvider provider;
  private final Map<String, Entry> cache = new LinkedHashMap<>();
  private final Map<String, long[]> budgets = new HashMap<>();
  private long secondWindow;
  private int secondRequests;

  record Entry(long expires, String workspace, JsonNode suggestion) {}

  public AddressService(AddressProvider provider) {
    this.provider = provider;
  }

  public boolean configured() {
    return provider.configured();
  }

  synchronized void budget(String workspace) {
    long now = System.currentTimeMillis();
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
    return provider.fetch(query, count);
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
    String code = StreetKind.parse(text(a, "street")).code();
    if (!code.isBlank()) a.put("streetType", code);
    // Foreign Belarus addresses legitimately have fias_level=-1. Assess actual parts, not Russian
    // levels.
    for (var axis : Map.of("latitude", "geo_lat", "longitude", "geo_lon").entrySet()) {
      String v = text(d, axis.getValue());
      if (v.matches("-?\\d+(?:\\.\\d+)?")) a.put(axis.getKey(), v);
    }
    return a;
  }
}
