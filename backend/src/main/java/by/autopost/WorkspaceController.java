package by.autopost;

import static by.autopost.Json.*;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.*;
import jakarta.servlet.http.*;
import java.util.*;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.*;

@RestController
class WorkspaceController {
  final Database db;
  final Access access;
  final AdsService ads;
  final Domain domain;
  final FeedService feed;

  WorkspaceController(Database db, Access access, AdsService ads, Domain domain, FeedService feed) {
    this.db = db;
    this.access = access;
    this.ads = ads;
    this.domain = domain;
    this.feed = feed;
  }

  @GetMapping("/healthz")
  ObjectNode health() {
    return object("ok", true);
  }

  @GetMapping("/api/workspace/session")
  ObjectNode session(HttpServletRequest req) {
    var actor = access.user(req);
    return object(
        "profile",
        actor == null ? null : actor.profile(),
        "profiles",
        db.rows("SELECT id,login,name FROM profiles ORDER BY login"));
  }

  @PostMapping("/api/workspace/{action:login|register}")
  ObjectNode login(
      @PathVariable String action, @RequestBody JsonNode input, HttpServletResponse response) {
    return access.login(input, action.equals("register"), response);
  }

  @PostMapping("/api/workspace/logout")
  ObjectNode logout(HttpServletRequest req, HttpServletResponse res) {
    db.run("DELETE FROM sessions WHERE token=?", Access.hash(Access.token(req)));
    res.setHeader("Set-Cookie", access.cookie("", 0));
    return object("ok", true);
  }

  @GetMapping("/api/workspace/ads")
  ObjectNode ads(HttpServletRequest req) {
    return object("ads", ads.all(access.require(req).workspace()));
  }

  @PostMapping("/api/workspace/ads")
  ObjectNode save(HttpServletRequest req, @RequestBody JsonNode input) {
    var actor = access.require(req);
    return object("ad", ads.save(actor.workspace(), input, actor.name()));
  }

  @GetMapping("/api/workspace/ads/{id}")
  ObjectNode get(HttpServletRequest req, @PathVariable String id) {
    var ad = ads.get(access.require(req).workspace(), id);
    if (ad == null) throw new ApiException(404, "Объявление не найдено.");
    return object("ad", ad);
  }

  @PostMapping("/api/workspace/batch-edit")
  ObjectNode batch(HttpServletRequest req, @RequestBody JsonNode input) {
    return object("ads", ads.batch(access.require(req), input));
  }

  @GetMapping("/api/workspace/ads/{id}/versions")
  ObjectNode versions(HttpServletRequest req, @PathVariable String id) {
    var actor = access.require(req);
    ArrayNode result = array();
    for (var row :
        db.rows(
            "SELECT version,created,data FROM versions WHERE profile_id=? AND record_id=? ORDER BY"
                + " version DESC",
            actor.workspace(),
            id))
      result.add(
          object(
              "version",
              row.get("version"),
              "created",
              row.get("created"),
              "data",
              parse(row.get("data").toString())));
    return object("versions", result);
  }

  @PostMapping("/api/workspace/ads/{id}/versions")
  ObjectNode restore(HttpServletRequest req, @PathVariable String id, @RequestBody JsonNode input) {
    return object("ad", ads.restore(access.require(req), id, input));
  }

  @PostMapping("/api/workspace/import")
  ObjectNode importRecord(HttpServletRequest req, @RequestBody JsonNode input) {
    return ads.importRecord(access.require(req), input);
  }

  @PostMapping("/api/workspace/extension-config")
  ObjectNode recipes(HttpServletRequest req, @RequestBody JsonNode input) {
    return object("recipes", ads.recipes(access.require(req), input));
  }

  @PostMapping("/api/workspace/feed")
  ObjectNode feed(HttpServletRequest req, @RequestBody JsonNode input) {
    return object("text", feed.fetch(access.require(req).workspace(), clean(input, "url", 2000)));
  }

  @GetMapping("/api/workspace/notifications")
  ObjectNode notifications(HttpServletRequest req) {
    return notifications(access.require(req).workspace());
  }

  private ObjectNode notifications(String profile) {
    return object(
        "notifications",
        db.rows(
            "SELECT id,record_id AS recordId,platform_id AS platformId,message,created,seen FROM"
                + " notifications WHERE profile_id=? ORDER BY id DESC",
            profile));
  }

  @PostMapping("/api/workspace/notifications")
  ObjectNode seen(HttpServletRequest req, @RequestBody JsonNode input) {
    String profile = access.require(req).workspace();
    if (!input.path("ids").isArray() || input.path("ids").size() > 200)
      throw new ApiException(400, "Некорректные уведомления.");
    for (var id : input.path("ids"))
      if (id.isIntegralNumber())
        db.run("UPDATE notifications SET seen=1 WHERE profile_id=? AND id=?", profile, id.asLong());
    return notifications(profile);
  }

  @GetMapping("/api/workspace/team")
  ObjectNode team(HttpServletRequest req) {
    return team(access.require(req));
  }

  private ObjectNode team(Access.Actor actor) {
    var owner = db.one("SELECT id,name,login FROM profiles WHERE id=?", actor.workspace());
    owner.put("role", "owner");
    ArrayNode members = array();
    members.add(MAPPER.valueToTree(owner));
    for (var row :
        db.rows(
            "SELECT p.id,p.name,p.login FROM profiles p JOIN members m ON m.member_id=p.id WHERE"
                + " m.owner_id=?",
            actor.workspace())) {
      row.put("role", "manager");
      members.add(MAPPER.valueToTree(row));
    }
    return object(
        "role",
        actor.id().equals(actor.workspace()) ? "owner" : "manager",
        "accountId",
        actor.id(),
        "workspaceId",
        actor.workspace(),
        "workspaces",
        db.rows(
            "SELECT id,name FROM profiles WHERE id=? OR id IN(SELECT owner_id FROM members WHERE"
                + " member_id=?)",
            actor.id(),
            actor.id()),
        "members",
        members);
  }

  @Transactional
  @PostMapping("/api/workspace/team")
  ObjectNode team(HttpServletRequest req, @RequestBody JsonNode input) {
    var actor = access.require(req);
    String action = text(input, "action");
    if (action.equals("switch")) {
      String owner = clean(input, "workspaceId", 80);
      if (!owner.equals(actor.id())
          && db.one("SELECT 1 FROM members WHERE owner_id=? AND member_id=?", owner, actor.id())
              == null) throw new ApiException(403, "Нет доступа к кабинету.");
      db.run(
          "UPDATE sessions SET workspace_id=? WHERE token=?",
          owner,
          Access.hash(Access.token(req)));
      return object("ok", true);
    }
    if (!actor.workspace().equals(actor.id()))
      throw new ApiException(403, "Управлять участниками может только владелец кабинета.");
    if (action.equals("add")) {
      var member =
          db.one(
              "SELECT id FROM profiles WHERE login=?",
              clean(input, "login", 40).toLowerCase(Locale.ROOT));
      if (member == null)
        throw new ApiException(
            400, "Пользователь должен сначала создать профиль. Укажите его точный логин.");
      if (member.get("id").equals(actor.id()))
        throw new ApiException(400, "Вы уже владелец кабинета.");
      if (db.count("SELECT count(*) FROM members WHERE owner_id=?", actor.id()) >= 20)
        throw new ApiException(400, "До 20 участников на кабинет.");
      db.run("INSERT OR IGNORE INTO members VALUES(?,?)", actor.id(), member.get("id"));
    } else if (action.equals("remove"))
      db.run(
          "DELETE FROM members WHERE owner_id=? AND member_id=?",
          actor.id(),
          clean(input, "memberId", 80));
    else throw new ApiException(400, "Неизвестное действие.");
    return team(actor);
  }

  @GetMapping("/api/workspace/settings")
  ObjectNode settings(HttpServletRequest req) {
    return object("settings", settings(access.require(req).workspace()));
  }

  private ObjectNode settings(String profile) {
    var row = db.one("SELECT data FROM settings WHERE profile_id=?", profile);
    return row == null ? object() : (ObjectNode) parse(row.get("data").toString());
  }

  @Transactional
  @PostMapping("/api/workspace/settings")
  ObjectNode settings(HttpServletRequest req, @RequestBody JsonNode input) {
    String profile = access.require(req).workspace();
    ObjectNode merged = settings(profile);
    if (!input.isObject()) throw new ApiException(400, "Нужен объект настроек.");
    merged.setAll((ObjectNode) input);
    ObjectNode result = object();
    for (String key : List.of("company", "contactPerson", "phone", "city"))
      result.put(
          key, clean(merged, key, key.equals("company") ? 150 : key.equals("phone") ? 40 : 100));
    if (!text(result, "phone").isEmpty()
        && !text(result, "phone").replaceAll("[\\s()-]", "").matches("\\+375\\d{9}"))
      throw new ApiException(400, "Телефон в формате +375XXXXXXXXX.");
    ArrayNode presets = array();
    for (var p : list(merged.path("importPresets")).stream().limit(30).toList()) {
      String id = clean(p, "id", 80), name = clean(p, "name", 80);
      if (id.isEmpty() || name.isEmpty()) continue;
      JsonNode cat = domain.category(text(p, "categoryId"));
      ObjectNode columns = object();
      if (p.path("columns").isObject()) {
        var it = p.path("columns").fields();
        int count = 0;
        while (it.hasNext() && count++ < 100) {
          var e = it.next();
          if (e.getKey().length() <= 200
              && e.getValue().isTextual()
              && e.getValue().asText().length() <= 50) columns.set(e.getKey(), e.getValue());
        }
      }
      presets.add(
          object(
              "id",
              id,
              "name",
              name,
              "categoryId",
              cat == null ? "" : text(cat, "id"),
              "url",
              clean(p, "url", 2000),
              "columns",
              columns));
    }
    result.set("importPresets", presets);
    ArrayNode templates = array();
    for (var t : list(merged.path("templates")).stream().limit(30).toList()) {
      String id = clean(t, "id", 80), name = clean(t, "name", 80);
      if (id.isEmpty() || name.isEmpty()) continue;
      templates.add(
          object(
              "id",
              id,
              "name",
              name,
              "delivery",
              clean(t, "delivery", 500),
              "warranty",
              clean(t, "warranty", 500),
              "warehouse",
              clean(t, "warehouse", 500),
              "platformText",
              ads.platformText(t.path("platformText"))));
    }
    result.set("templates", templates);
    ObjectNode integrations = object();
    for (String key : List.of("kufar", "bamper", "flagma")) {
      JsonNode value =
          input.path("integrations").has(key)
              ? input.path("integrations").path(key)
              : settings(profile).path("integrations").path(key);
      integrations.set(
          key,
          object(
              "enabled", value.path("enabled").asBoolean(), "notes", clean(value, "notes", 400)));
    }
    result.set("integrations", integrations);
    db.run(
        "INSERT INTO settings VALUES(?,?) ON CONFLICT(profile_id) DO UPDATE SET data=excluded.data",
        profile,
        result.toString());
    return object("settings", result);
  }
}
