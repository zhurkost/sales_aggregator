package by.autopost.rental.address;

import static by.autopost.shared.Json.*;

import by.autopost.shared.ApiException;
import by.autopost.shared.Text;
import com.fasterxml.jackson.databind.node.*;
import java.time.Instant;
import java.util.*;
import java.util.function.LongSupplier;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

/** Provider-backed selection; an OSM identifier is never a marketplace identifier. */
@Service
public class AddressService {
  private final AddressProvider provider;
  private final LongSupplier clock;
  private final Map<String, Entry> cache = new LinkedHashMap<>();
  private final Map<String, long[]> budgets = new HashMap<>();
  private long cooldownUntil;
  private long secondWindow;
  private int secondRequests;

  record Entry(long expires, String workspace, ObjectNode result, DadataSuggestion suggestion) {}

  @Autowired
  public AddressService(AddressProvider provider) {
    this(provider, System::currentTimeMillis);
  }

  AddressService(AddressProvider provider, LongSupplier clock) {
    this.provider = provider;
    this.clock = clock;
  }

  public boolean configured() {
    return provider.configured();
  }

  synchronized void budget(String workspace) {
    long now = clock.getAsLong();
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

  private List<DadataSuggestion> fetch(String query, int count) {
    if (!configured())
      throw new ApiException(
          503, "Адресные подсказки ещё не подключены. Адрес можно заполнить вручную.");
    try {
      return provider.suggest(query, count);
    } catch (AddressProvider.Throttled e) {
      synchronized (this) {
        cooldownUntil = clock.getAsLong() + e.retryAfterSeconds * 1000;
      }
      throw new ApiException(
          503, "Подсказки временно недоступны. Можно сохранить адрес вручную и повторить позже.");
    }
  }

  public synchronized ObjectNode suggest(String workspace, String query) {
    query = query.strip();
    if (query.length() < 3 || query.length() > 300)
      throw new ApiException(400, "Введите от 3 до 300 символов адреса.");
    prune();
    String queryKey = "q:" + workspace + ":" + Text.normalized(query);
    Entry hit = cache.get(queryKey);
    if (hit != null) return hit.result.deepCopy();
    budget(workspace);
    ArrayNode suggestions = array();
    for (var s : fetch(query, 8)) {
      if (!s.belarus()) continue;
      String id = UUID.randomUUID().toString();
      cache.put(id, new Entry(clock.getAsLong() + 1200000, workspace, null, s));
      suggestions.add(object("id", id, "label", s.value(), "address", s.address()));
    }
    ObjectNode result = object("suggestions", suggestions, "provider", "dadata");
    cache.put(queryKey, new Entry(clock.getAsLong() + 300000, workspace, result.deepCopy(), null));
    return result;
  }

  public synchronized ObjectNode select(String workspace, String id) {
    prune();
    Entry selected = cache.get(id);
    if (selected == null || !selected.workspace.equals(workspace) || id.startsWith("q:"))
      throw new ApiException(409, "Подсказка устарела. Найдите адрес ещё раз.");
    budget(workspace);
    DadataSuggestion old = selected.suggestion;
    var found = fetch(old.confirmationQuery(), 1);
    if (found.size() != 1)
      throw new ApiException(409, "Адрес не удалось подтвердить. Выберите его ещё раз.");
    DadataSuggestion next = found.get(0);
    if (!next.belarus()
        || (!old.fiasId().isEmpty()
            ? !old.fiasId().equals(next.fiasId())
            : !old.value().equals(next.value())))
      throw new ApiException(409, "Сервис вернул другой адрес. Уточните выбор.");
    var nextParts = next.parts();
    for (var part : old.parts().entrySet())
      if (!part.getValue().isEmpty()
          && !Text.normalized(part.getValue()).equals(Text.normalized(nextParts.get(part.getKey()))))
        throw new ApiException(409, "Сервис уточнил адрес иначе. Найдите нужный дом ещё раз.");
    ObjectNode address = next.address();
    address.put("confirmed", true);
    address.put("confirmedAt", Instant.ofEpochMilli(clock.getAsLong()).toString());
    return object("address", address);
  }

  private void prune() {
    long now = clock.getAsLong();
    cache.entrySet().removeIf(e -> e.getValue().expires < now);
    while (cache.size() > 1000) cache.remove(cache.keySet().iterator().next());
  }
}
