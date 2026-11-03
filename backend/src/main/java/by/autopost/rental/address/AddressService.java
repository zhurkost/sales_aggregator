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

/**
 * Provider-backed selection; an OSM identifier is never a marketplace identifier.
 *
 * <p>The lock guards only the caches and counters. Provider calls run outside it, so a slow
 * answer delays only the request that waits for it.
 */
@Service
public class AddressService {
  static final int SUGGESTIONS_PER_QUERY = 8;
  static final long QUERY_TTL = 5 * 60_000;
  static final int QUERY_CAPACITY = 1000;
  static final long SUGGESTION_TTL = 20 * 60_000;
  static final int REQUESTS_PER_MINUTE = 300;
  static final int WORKSPACE_REQUESTS_PER_MINUTE = 60;
  static final int PROVIDER_REQUESTS_PER_SECOND = 10;

  /**
   * Every issued ID passes the per-minute limit, so within one TTL at most this many IDs can be
   * alive (TTL minutes plus one partial window). A live suggestion is therefore never pushed out.
   */
  static final int SUGGESTION_CAPACITY =
      REQUESTS_PER_MINUTE * (int) (SUGGESTION_TTL / 60_000 + 1) * SUGGESTIONS_PER_QUERY;

  private final AddressProvider provider;
  private final LongSupplier clock;
  private final Object lock = new Object();

  /** Provider answers by normalized query; identical for every workspace. Guarded by lock. */
  private final LinkedHashMap<String, CachedQuery> queries = new LinkedHashMap<>();

  /** Suggestions handed to a workspace, by ID. Guarded by lock. */
  private final LinkedHashMap<String, Issued> issued = new LinkedHashMap<>();

  private final Map<String, long[]> windows = new HashMap<>();
  private long cooldownUntil;
  private long secondWindow;
  private int secondRequests;

  private record CachedQuery(long expires, List<DadataSuggestion> suggestions) {}

  private record Issued(long expires, String workspace, DadataSuggestion suggestion) {}

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

  public ObjectNode suggest(String workspace, String query) {
    query = query.strip();
    if (query.length() < 3 || query.length() > 300)
      throw new ApiException(400, "Введите от 3 до 300 символов адреса.");
    requireConfigured();
    String key = Text.normalized(query);
    List<DadataSuggestion> found;
    synchronized (lock) {
      long now = clock.getAsLong();
      prune(now);
      admit(workspace, now);
      CachedQuery hit = queries.get(key);
      found = hit == null || hit.expires < now ? null : hit.suggestions;
      if (found == null) reserveProvider(now);
    }
    if (found == null) {
      found =
          fetch(query, SUGGESTIONS_PER_QUERY).stream().filter(DadataSuggestion::belarus).toList();
      synchronized (lock) {
        queries.remove(key);
        queries.put(key, new CachedQuery(clock.getAsLong() + QUERY_TTL, found));
        for (var oldest = queries.keySet().iterator(); queries.size() > QUERY_CAPACITY; ) {
          oldest.next();
          oldest.remove();
        }
      }
    }
    List<String> ids = new ArrayList<>();
    synchronized (lock) {
      if (issued.size() + found.size() > SUGGESTION_CAPACITY)
        throw new ApiException(429, "Слишком много запросов адреса. Подождите минуту.");
      long expires = clock.getAsLong() + SUGGESTION_TTL;
      for (var suggestion : found) {
        String id = UUID.randomUUID().toString();
        issued.put(id, new Issued(expires, workspace, suggestion));
        ids.add(id);
      }
    }
    ArrayNode suggestions = array();
    for (int i = 0; i < found.size(); i++)
      suggestions.add(
          object(
              "id", ids.get(i), "label", found.get(i).value(), "address", found.get(i).address()));
    return object("suggestions", suggestions, "provider", "dadata");
  }

  public ObjectNode select(String workspace, String id) {
    requireConfigured();
    DadataSuggestion old;
    synchronized (lock) {
      long now = clock.getAsLong();
      prune(now);
      Issued selected = issued.get(id);
      if (selected == null || selected.expires < now || !selected.workspace.equals(workspace))
        throw new ApiException(409, "Подсказка устарела. Найдите адрес ещё раз.");
      admit(workspace, now);
      reserveProvider(now);
      old = selected.suggestion;
    }
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

  private void requireConfigured() {
    if (!configured())
      throw new ApiException(
          503, "Адресные подсказки ещё не подключены. Адрес можно заполнить вручную.");
  }

  /** Request rate per workspace and overall; counts cache hits, because each issues IDs. */
  private void admit(String workspace, long now) {
    windows.entrySet().removeIf(e -> e.getValue()[1] < now);
    for (String id : List.of("all", "workspace:" + workspace)) {
      long[] window = windows.computeIfAbsent(id, k -> new long[] {0, now + 60_000});
      if (window[0]
          >= (id.equals("all") ? REQUESTS_PER_MINUTE : WORKSPACE_REQUESTS_PER_MINUTE))
        throw new ApiException(429, "Слишком много запросов адреса. Подождите минуту.");
      window[0]++;
    }
  }

  /** Budget of real provider calls; cache hits do not spend it. */
  private void reserveProvider(long now) {
    if (now < cooldownUntil)
      throw new ApiException(429, "Сервис адресов просит подождать. Введённые данные сохранены.");
    if (now - secondWindow >= 1000) {
      secondWindow = now;
      secondRequests = 0;
    }
    if (secondRequests >= PROVIDER_REQUESTS_PER_SECOND)
      throw new ApiException(429, "Подождите секунду перед следующим поиском адреса.");
    secondRequests++;
  }

  /** Network call; must be made without holding the lock. */
  private List<DadataSuggestion> fetch(String query, int count) {
    try {
      return provider.suggest(query, count);
    } catch (AddressProvider.Throttled e) {
      synchronized (lock) {
        cooldownUntil = clock.getAsLong() + e.retryAfterSeconds * 1000;
      }
      throw new ApiException(
          503, "Подсказки временно недоступны. Можно сохранить адрес вручную и повторить позже.");
    }
  }

  /** Entries of each cache share one TTL, so the oldest entries expire first. */
  private void prune(long now) {
    for (var it = queries.values().iterator(); it.hasNext() && it.next().expires < now; )
      it.remove();
    for (var it = issued.values().iterator(); it.hasNext() && it.next().expires < now; )
      it.remove();
  }
}
