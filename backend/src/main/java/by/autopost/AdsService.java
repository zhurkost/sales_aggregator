package by.autopost;

import static by.autopost.shared.Json.*;

import by.autopost.shared.ApiException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.*;
import java.time.Instant;
import java.util.*;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
class AdsService {
  final Database db;
  final Domain domain;

  AdsService(Database db, Domain domain) {
    this.db = db;
    this.domain = domain;
  }

  ObjectNode get(String profile, String id) {
    var row = db.one("SELECT data FROM ads WHERE profile_id=? AND id=?", profile, id);
    return row == null ? null : domain.normalize((ObjectNode) parse(row.get("data").toString()));
  }

  ObjectNode summary(ObjectNode record) {
    ObjectNode n = record.deepCopy();
    n.remove(List.of("text", "photos"));
    n.put("photoCount", record.path("photos").size());
    return n;
  }

  ArrayNode all(String profile) {
    ArrayNode result = array();
    for (var row :
        db.rows("SELECT summary FROM ads WHERE profile_id=? ORDER BY updated DESC", profile))
      result.add(domain.normalize((ObjectNode) parse(row.get("summary").toString())));
    return result;
  }

  private ArrayNode content(JsonNode r) {
    ArrayNode photos = array();
    for (var p : list(r.path("photos")))
      photos.add(array(List.of(text(p, "id"), text(p, "dataUrl"))));
    return array(
        List.of(
            r.path("listing"),
            r.path("attributes"),
            r.path("categoryOverrides"),
            r.path("platformText"),
            photos));
  }

  @Transactional
  public ObjectNode save(String profile, JsonNode raw, String actor) {
    if (!raw.isObject()) throw new ApiException(400, "Нужен объект объявления.");
    if (raw.hasNonNull("profileId")
        && !text(raw, "profileId").isEmpty()
        && !text(raw, "profileId").equals(profile))
      throw new ApiException(403, "Профиль изменился. Откройте кабинет заново.");
    if (!id(text(raw, "id"))) throw new ApiException(400, "Некорректный идентификатор карточки.");
    ObjectNode input = domain.normalize(raw.deepCopy()), old = get(profile, text(input, "id"));
    if (old != null
        && (!input.path("revision").isNumber()
            || input.path("revision").asInt() != old.path("revision").asInt()))
      throw new ApiException(409, "Карточка изменена в другой вкладке. Откройте её заново.");
    if (old == null && db.count("SELECT count(*) FROM ads WHERE profile_id=?", profile) >= 500)
      throw new ApiException(400, "Лимит MVP: 500 карточек на профиль.");
    ObjectNode listing = domain.listing(input.path("listing"));
    JsonNode category = domain.category(text(listing, "taxonomyId"));
    if (!text(listing, "taxonomyId").isEmpty() && category == null)
      throw new ApiException(400, "Категория не найдена в справочнике.");
    if (category != null && !text(category, "group").equals(text(listing, "category")))
      throw new ApiException(400, "Категория не соответствует карточке.");
    List<JsonNode> photos = list(input.path("photos"));
    if (photos.size() > 12
        || photos.stream()
            .anyMatch(
                p ->
                    !text(p, "dataUrl")
                            .matches("data:image/(jpeg|png|webp);base64,[a-zA-Z0-9+/]+=*")
                        || text(p, "dataUrl").length() > 350000))
      throw new ApiException(400, "Некорректные фотографии.");
    if (old != null
        && old.path("jobs").size() > 0
        && !text(old.path("listing"), "taxonomyId").equals(text(listing, "taxonomyId")))
      throw new ApiException(
          400, "У карточки уже есть задания. Для другой категории создайте отдельную карточку.");
    ObjectNode overrides = domain.overrides(input.get("categoryOverrides")),
        attributes = domain.attributes(listing, input.get("attributes"), overrides),
        platformText = platformText(input.path("platformText"));
    ObjectNode candidate =
        object(
            "listing",
            listing,
            "attributes",
            attributes,
            "categoryOverrides",
            overrides,
            "platformText",
            platformText,
            "photos",
            photos);
    boolean changed = old == null || !content(old).equals(content(candidate));
    int contentVersion =
        (old == null ? 1 : old.path("contentVersion").asInt(1)) + (old != null && changed ? 1 : 0);
    var allowed = domain.platforms(listing).stream().map(p -> text(p, "id")).toList();
    ArrayNode selected = array();
    for (var v : list(input.path("selected")))
      if (allowed.contains(v.asText()) && !has(selected, v.asText())) selected.add(v.asText());
    List<JsonNode> requested = new ArrayList<>(list(input.path("jobs")));
    for (var previous : old == null ? List.<JsonNode>of() : list(old.path("jobs"))) {
      var next =
          requested.stream()
              .filter(j -> text(j, "platformId").equals(text(previous, "platformId")))
              .findFirst()
              .orElse(null);
      if (next == null) {
        requested.add(previous);
        continue;
      }
      String previousBatch = previous.path("batchId").asText(text(old, "batchId")),
          nextBatch = next.path("batchId").asText(text(input, "batchId"));
      if (!previousBatch.isEmpty()
          && !previousBatch.equals(nextBatch)
          && (!text(previous, "url").isEmpty()
              || !Set.of("draft", "ready", "cancelled", "unsupported")
                  .contains(text(previous, "status"))))
        throw new ApiException(
            409, "У площадки уже есть задание. Обновите карточку и продолжите его.");
      if (!text(previous, "url").isEmpty() && text(next, "url").isEmpty())
        ((ObjectNode) next).set("url", previous.get("url"));
    }
    ArrayNode jobs = array();
    Set<String> seen = new HashSet<>();
    for (var j : requested) {
      String platform = text(j, "platformId");
      if (!seen.add(platform) || !allowed.contains(platform) || jobs.size() >= 8) continue;
      JsonNode previous =
          old == null
              ? null
              : list(old.path("jobs")).stream()
                  .filter(p -> text(p, "platformId").equals(platform))
                  .findFirst()
                  .orElse(null);
      int sent = previous == null ? 0 : previous.path("sentVersion").asInt();
      if (sent == 0 && Set.of("opening", "ready", "queued").contains(text(j, "status")))
        sent = contentVersion;
      String status =
          domain.catalog.path("statusLabel").has(text(j, "status"))
              ? text(j, "status")
              : "manual_required";
      ObjectNode job =
          object(
              "platformId",
              platform,
              "sentVersion",
              sent,
              "status",
              status,
              "message",
              clean(j, "message", 600),
              "filledFields",
              Math.max(0, Math.min(50, j.path("filledFields").asInt())),
              "photosTransferred",
              Math.max(0, Math.min(12, j.path("photosTransferred").asInt())));
      if (id(text(j, "batchId"))) job.put("batchId", text(j, "batchId"));
      String url = domain.safeUrl(platform, text(j, "url"));
      if (!url.isEmpty()) {
        job.put("url", url);
        JsonNode remote = domain.remoteStatus(j.path("remoteStatus"));
        if (remote != null) job.set("remoteStatus", remote);
      }
      if (j.path("tabId").isIntegralNumber()) job.set("tabId", j.get("tabId"));
      jobs.add(job);
    }
    String now = Instant.now().toString();
    ArrayNode events = old == null ? array() : old.path("events").deepCopy();
    String message =
        old == null
            ? "Карточка создана"
            : input.path("archived").asBoolean() && !old.path("archived").asBoolean()
                ? "Убрано в архив Автопоста"
                : !input.path("archived").asBoolean() && old.path("archived").asBoolean()
                    ? "Восстановлено из архива"
                    : !jobs.equals(old.path("jobs"))
                        ? "Обновлены задания на площадках"
                        : "Карточка обновлена";
    if (old != null && old.path("sold").asBoolean() != input.path("sold").asBoolean())
      message =
          input.path("sold").asBoolean() ? "Товар отмечен проданным" : "Товар возвращён в продажу";
    if (changed
        || events.isEmpty()
        || !text(events.get(events.size() - 1), "message").equals(message))
      events.add(object("at", now, "message", message, "actor", actor));
    while (events.size() > 100) events.remove(0);
    ArrayNode storedPhotos = array();
    for (var p : photos) {
      String data = text(p, "dataUrl"), photoId = clean(p, "id", 80);
      storedPhotos.add(
          object(
              "id",
              photoId.isEmpty() ? UUID.randomUUID().toString() : photoId,
              "name",
              clean(p, "name", 160),
              "type",
              data.substring(5, data.indexOf(';')),
              "dataUrl",
              data));
    }
    String assignee = clean(input, "assigneeId", 80);
    if (!assignee.equals(profile)
        && db.one("SELECT 1 FROM members WHERE owner_id=? AND member_id=?", profile, assignee)
            == null) assignee = "";
    ArrayNode photoRefs = array();
    for (var v : list(input.path("photoRefs")).stream().limit(12).toList()) {
      String ref = clean(v, 2000);
      if (!ref.isEmpty()) photoRefs.add(ref);
    }
    ObjectNode record =
        object(
            "id",
            text(input, "id"),
            "revision",
            old == null ? 1 : old.path("revision").asInt() + 1,
            "contentVersion",
            contentVersion,
            "createdAt",
            old == null ? now : text(old, "createdAt"),
            "updatedAt",
            now,
            "text",
            clean(input, "text", 8000),
            "listing",
            listing,
            "photos",
            storedPhotos,
            "selected",
            selected,
            "prepared",
            input.path("prepared").asBoolean(),
            "categoryConfirmed",
            category != null && input.path("categoryConfirmed").asBoolean(),
            "categoryOverrides",
            overrides,
            "attributes",
            attributes,
            "archived",
            input.path("archived").asBoolean(),
            "sold",
            input.path("sold").asBoolean(),
            "assigneeId",
            assignee,
            "jobs",
            jobs,
            "batchId",
            id(text(input, "batchId")) ? text(input, "batchId") : "",
            "externalId",
            clean(input, "externalId", 120),
            "sourceId",
            clean(input, "sourceId", 80),
            "platformText",
            platformText,
            "photoRefs",
            photoRefs,
            "events",
            events);
    if (changed && old != null) {
      ObjectNode snapshot = object();
      for (String k : List.of("listing", "attributes", "categoryOverrides", "platformText", "text"))
        snapshot.set(k, old.path(k));
      db.run(
          "INSERT OR IGNORE INTO versions VALUES(?,?,?,?,?)",
          profile,
          text(old, "id"),
          old.path("contentVersion").asInt(1),
          snapshot.toString(),
          now);
      db.run(
          "DELETE FROM versions WHERE profile_id=? AND record_id=? AND version NOT IN (SELECT"
              + " version FROM versions WHERE profile_id=? AND record_id=? ORDER BY version DESC"
              + " LIMIT 20)",
          profile,
          text(old, "id"),
          profile,
          text(old, "id"));
    }
    db.run(
        "INSERT INTO ads(profile_id,id,data,updated,summary) VALUES(?,?,?,?,?) ON"
            + " CONFLICT(profile_id,id) DO UPDATE SET"
            + " data=excluded.data,updated=excluded.updated,summary=excluded.summary",
        profile,
        text(record, "id"),
        record.toString(),
        now,
        summary(record).toString());
    for (var job : jobs) {
      JsonNode exception = exception(job),
          previous =
              old == null
                  ? null
                  : list(old.path("jobs")).stream()
                      .filter(j -> text(j, "platformId").equals(text(job, "platformId")))
                      .findFirst()
                      .orElse(null);
      if (exception != null && !exception.equals(exception(previous)))
        db.run(
            "INSERT INTO notifications(profile_id,record_id,platform_id,message,created)"
                + " VALUES(?,?,?,?,?)",
            profile,
            text(record, "id"),
            text(job, "platformId"),
            domain.title(listing) + ": " + exception.path(1).asText(),
            now);
    }
    db.run(
        "DELETE FROM notifications WHERE profile_id=? AND id NOT IN (SELECT id FROM notifications"
            + " WHERE profile_id=? ORDER BY id DESC LIMIT 200)",
        profile,
        profile);
    return record;
  }

  private JsonNode exception(JsonNode job) {
    if (job == null) return null;
    JsonNode remote = job.path("remoteStatus");
    if (Set.of("rejected", "action_required").contains(text(remote, "state")))
      return array(List.of(text(remote, "state"), text(remote, "message")));
    if (Set.of("error", "authorization_required", "captcha_required", "category_required")
        .contains(text(job, "status")))
      return array(List.of(text(job, "status"), text(job, "message")));
    return null;
  }

  ObjectNode platformText(JsonNode input) {
    ObjectNode result = object();
    for (String id : List.of("kufar", "onliner", "bamper", "av", "abw", "flagma", "drom")) {
      String value = clean(input, id, 1000);
      if (!value.isEmpty()) result.put(id, value);
    }
    return result;
  }

  @Transactional
  public ArrayNode batch(Access.Actor actor, JsonNode input) {
    List<JsonNode> items = list(input.path("items"));
    if (items.isEmpty()
        || items.size() > 100
        || items.stream().map(i -> text(i, "id")).distinct().count() != items.size())
      throw new ApiException(400, "Выберите от 1 до 100 разных карточек.");
    ArrayNode result = array();
    for (var item : items) {
      ObjectNode old = get(actor.workspace(), text(item, "id"));
      if (old == null || old.path("revision").asInt() != item.path("revision").asInt())
        throw new ApiException(409, "Одна из карточек изменилась. Обновите предпросмотр.");
      old.set("listing", domain.edit(old.path("listing"), input.path("edit")));
      result.add(summary(save(actor.workspace(), old, actor.name())));
    }
    return result;
  }

  @Transactional
  public ObjectNode restore(Access.Actor actor, String id, JsonNode input) {
    ObjectNode old = get(actor.workspace(), id);
    var row =
        db.one(
            "SELECT data FROM versions WHERE profile_id=? AND record_id=? AND version=?",
            actor.workspace(),
            id,
            input.path("version").asInt());
    if (old == null || row == null) throw new ApiException(400, "Версия не найдена.");
    if (old.path("revision").asInt() != input.path("revision").asInt())
      throw new ApiException(409, "Карточка изменилась. Обновите историю.");
    old.setAll((ObjectNode) parse(row.get("data").toString()));
    return save(actor.workspace(), old, actor.name());
  }

  @Transactional
  public ObjectNode importRecord(Access.Actor actor, JsonNode input) {
    String source = clean(input, "sourceId", 80);
    JsonNode incoming = input.path("record");
    if (source.isEmpty() || !incoming.isObject() || !input.path("fields").isArray())
      throw new ApiException(400, "Выберите источник и сопоставьте колонки.");
    String external = clean(incoming, "externalId", 120);
    List<ObjectNode> matches = new ArrayList<>();
    for (var row : db.rows("SELECT data FROM ads WHERE profile_id=?", actor.workspace())) {
      ObjectNode ad = (ObjectNode) parse(row.get("data").toString());
      if (text(ad, "sourceId").equals(source)
          && !external.isEmpty()
          && text(ad, "externalId").equals(external)) matches.add(ad);
    }
    if (matches.size() > 1)
      throw new ApiException(400, "В кабинете несколько карточек с одним ID. Устраните дубли.");
    ObjectNode old = matches.isEmpty() ? null : matches.get(0);
    if (old != null && old.path("revision").asInt() != input.path("expectedRevision").asInt())
      throw new ApiException(409, "Карточка изменилась после предпросмотра.");
    if (old != null && (old.path("archived").asBoolean() || old.path("sold").asBoolean()))
      throw new ApiException(400, "Карточка с этим ID в архиве или продана. Восстановите её явно.");
    ObjectNode record = incoming.deepCopy();
    record
        .put(
            "id",
            "import-"
                + Access.hash(
                        source
                            + "\0"
                            + (external.isEmpty() ? incoming.path("listing").toString() : external))
                    .substring(0, 40))
        .put("sourceId", source);
    if (old != null) {
      if (has(input.path("fields"), "currency")
          && text(incoming.path("listing"), "currency").isEmpty())
        throw new ApiException(400, "В выгрузке неподдерживаемая валюта.");
      if (has(input.path("fields"), "currency")
          && !text(incoming.path("listing"), "currency")
              .equals(text(old.path("listing"), "currency"))
          && (!has(input.path("fields"), "price")
              || text(incoming.path("listing"), "price").isEmpty()))
        throw new ApiException(400, "При смене валюты укажите новую цену в той же строке.");
      record = old.deepCopy();
      ObjectNode listing = record.path("listing").deepCopy();
      for (var field : input.path("fields")) {
        String k = field.asText();
        if (listing.has(k)
            && !Set.of("category", "taxonomyId").contains(k)
            && !text(incoming.path("listing"), k).isEmpty())
          listing.set(k, incoming.path("listing").get(k));
      }
      record.set("listing", listing);
      record.put("text", text(listing, "description"));
      if (incoming.path("photos").size() > 0) record.set("photos", incoming.get("photos"));
      if (has(input.path("fields"), "photoUrls") && incoming.path("photoRefs").size() > 0)
        record.set("photoRefs", incoming.get("photoRefs"));
    } else if (external.isEmpty()) {
      ObjectNode same = get(actor.workspace(), text(record, "id"));
      if (same != null) return object("ad", same, "action", "unchanged");
    }
    return object(
        "ad",
        save(actor.workspace(), record, actor.name()),
        "action",
        old == null ? "created" : "updated");
  }

  @Transactional
  public ArrayNode recipes(Access.Actor actor, JsonNode input) {
    String profile = actor.workspace();
    if (input.has("profileId") && !text(input, "profileId").equals(profile))
      throw new ApiException(403, "Профиль изменился. Откройте кабинет заново.");
    List<JsonNode> items = list(input.path("items"));
    if (items.isEmpty() || items.size() > 20)
      throw new ApiException(400, "Нужно от 1 до 20 карточек.");
    ArrayNode result = array();
    for (var item : items) {
      result.add(domain.recipe(item));
      ObjectNode old = get(profile, text(item, "recordId"));
      if (old != null && old.path("sold").asBoolean())
        throw new ApiException(400, "Товар отмечен проданным. Подача остановлена.");
      if (!input.path("reserve").asBoolean() && !input.path("verify").asBoolean()) continue;
      if (!id(text(item, "recordId"))
          || !id(text(item, "batchId"))
          || !item.path("platforms").isArray()
          || item.path("platforms").isEmpty()) throw new ApiException(400, "Некорректный запуск.");
      if (old != null && (old.path("sold").asBoolean() || old.path("archived").asBoolean()))
        throw new ApiException(400, "Товар продан или убран в архив.");
      for (var platform : item.path("platforms")) {
        String pid = text(platform, "id"), batch = text(item, "batchId");
        if (domain.platforms(item.path("listing")).stream()
            .noneMatch(p -> text(p, "id").equals(pid)))
          throw new ApiException(400, "Неизвестная площадка.");
        var previous =
            db.one(
                "SELECT batch_id FROM launches WHERE profile_id=? AND record_id=? AND"
                    + " platform_id=?",
                profile,
                text(item, "recordId"),
                pid);
        JsonNode job =
            old == null
                ? null
                : list(old.path("jobs")).stream()
                    .filter(j -> text(j, "platformId").equals(pid))
                    .findFirst()
                    .orElse(null);
        boolean verify = input.path("verify").asBoolean();
        if (verify && (previous == null || !batch.equals(previous.get("batch_id"))))
          throw new ApiException(400, "Запуск не подтверждён в кабинете.");
        if (!verify && previous != null
            || job != null
                && !job.path("batchId").asText(text(old, "batchId")).equals(batch)
                && (!text(job, "url").isEmpty()
                    || !Set.of("draft", "ready", "cancelled", "unsupported")
                        .contains(text(job, "status"))))
          throw new ApiException(
              400,
              "Для этой карточки уже есть задание на площадке. Повторная подача заблокирована.");
        if (old == null
            || job == null
            || !job.path("batchId").asText(text(old, "batchId")).equals(batch))
          throw new ApiException(
              409, "Ожидаем сохранения карточки перед подачей.", "WAIT_FOR_SAVE");
        ObjectNode expected = old.path("listing").deepCopy();
        expected
            .put("title", domain.title(expected))
            .put(
                "description",
                domain.description(
                    expected, old.path("attributes"), old.path("categoryOverrides")));
        ArrayNode photoIds = array();
        for (var p : old.path("photos")) photoIds.add(text(p, "id"));
        boolean equal = true;
        var iterator = expected.fields();
        while (iterator.hasNext()) {
          var e = iterator.next();
          if (!e.getValue().equals(item.path("listing").path(e.getKey()))) equal = false;
        }
        for (String key : List.of("platformText", "categoryOverrides", "attributes"))
          if (!old.path(key).equals(item.has(key) ? item.get(key) : object())) equal = false;
        if (!equal || !photoIds.equals(item.path("photoIds")))
          throw new ApiException(
              400, "Карточка изменилась после подготовки. Обновите её перед подачей.");
        if (text(old.path("listing"), "quantity").equals("0")
            || text(old.path("listing"), "availability").equals("Нет в наличии"))
          throw new ApiException(400, "Товар отсутствует в наличии.");
        if (!verify) {
          if (db.count("SELECT count(*) FROM launches WHERE profile_id=?", profile) >= 3500)
            throw new ApiException(400, "Достигнут лимит запусков кабинета.");
          db.run(
              "INSERT OR IGNORE INTO launches VALUES(?,?,?,?,?)",
              profile,
              text(item, "recordId"),
              pid,
              batch,
              Instant.now().toString());
        }
      }
    }
    return result;
  }
}
