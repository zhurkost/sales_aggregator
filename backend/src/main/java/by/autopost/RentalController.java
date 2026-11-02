package by.autopost;

import static by.autopost.Json.*;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.*;
import jakarta.servlet.http.HttpServletRequest;
import java.time.Instant;
import java.util.*;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/workspace/rental")
class RentalController {
  final Access access;
  final RentalCatalog catalog;
  final AddressService addresses;
  final Database db;

  RentalController(Access access, RentalCatalog catalog, AddressService addresses, Database db) {
    this.access = access;
    this.catalog = catalog;
    this.addresses = addresses;
    this.db = db;
    db.run(
        "CREATE TABLE IF NOT EXISTS rental_drafts(id TEXT NOT NULL,workspace_id TEXT NOT NULL"
            + " REFERENCES profiles(id),revision INTEGER NOT NULL,data TEXT NOT NULL,updated TEXT"
            + " NOT NULL,PRIMARY KEY(workspace_id,id))");
  }

  @GetMapping("/editor")
  ObjectNode editor(HttpServletRequest req) {
    access.require(req);
    ObjectNode result = catalog.editor();
    result.put("addressSuggestions", addresses.configured());
    return result;
  }

  @PostMapping("/address/suggest")
  ObjectNode suggest(HttpServletRequest req, @RequestBody JsonNode input) {
    String workspace = access.require(req).workspace();
    if (!input.path("query").isTextual()) throw new ApiException(400, "Введите адрес.");
    return addresses.suggest(workspace, input.get("query").asText());
  }

  @PostMapping("/address/select")
  ObjectNode select(HttpServletRequest req, @RequestBody JsonNode input) {
    return addresses.select(access.require(req).workspace(), clean(input, "id", 80));
  }

  @PostMapping("/normalize")
  ObjectNode normalize(HttpServletRequest req, @RequestBody JsonNode input) {
    access.require(req);
    if (!input.isObject() || input.toString().length() > 250000)
      throw new ApiException(400, "Некорректная карточка.");
    return catalog.normalize(input);
  }

  @PostMapping("/prepare")
  ObjectNode prepare(HttpServletRequest req, @RequestBody JsonNode input) {
    access.require(req);
    return catalog.prepare(input);
  }

  @GetMapping("/drafts")
  ObjectNode drafts(HttpServletRequest req) {
    String workspace = access.require(req).workspace();
    ArrayNode items = array();
    for (var row :
        db.rows(
            "SELECT id,revision,data,updated FROM rental_drafts WHERE workspace_id=? ORDER BY"
                + " updated DESC",
            workspace)) {
      JsonNode data = parse(row.get("data").toString());
      items.add(
          object(
              "id",
              row.get("id"),
              "revision",
              row.get("revision"),
              "title",
              text(data.path("values"), "listing.title"),
              "address",
              text(data.path("address"), "label"),
              "updatedAt",
              row.get("updated")));
    }
    return object("drafts", items);
  }

  @GetMapping("/drafts/{id}")
  ObjectNode draft(HttpServletRequest req, @PathVariable String id) {
    var row =
        db.one(
            "SELECT revision,data FROM rental_drafts WHERE workspace_id=? AND id=?",
            access.require(req).workspace(),
            id);
    if (row == null) throw new ApiException(404, "Карточка аренды не найдена.");
    return object(
        "id", id, "revision", row.get("revision"), "draft", catalog.normalize(parse(row.get("data").toString())));
  }

  @PostMapping("/drafts/{id}")
  @Transactional
  ObjectNode save(HttpServletRequest req, @PathVariable String id, @RequestBody JsonNode input) {
    String workspace = access.require(req).workspace();
    if (!Json.id(id)
        || !input.path("draft").isObject()
        || !input.path("revision").isIntegralNumber())
      throw new ApiException(400, "Некорректная карточка.");
    JsonNode draft = input.get("draft");
    if (draft.toString().length() > 250000)
      throw new ApiException(413, "Карточка слишком большая.");
    var row =
        db.one("SELECT revision FROM rental_drafts WHERE workspace_id=? AND id=?", workspace, id);
    int revision = input.get("revision").asInt();
    if ((row == null && revision != 0)
        || (row != null && ((Number) row.get("revision")).intValue() != revision))
      throw new ApiException(
          409, "Карточка изменена в другой вкладке. Сохраните свои правки перед обновлением.");
    if (row == null
        && db.count("SELECT count(*) FROM rental_drafts WHERE workspace_id=?", workspace) >= 500)
      throw new ApiException(400, "Достигнут лимит карточек аренды.");
    db.run(
        "INSERT INTO rental_drafts VALUES(?,?,?,?,?) ON CONFLICT(workspace_id,id) DO UPDATE SET"
            + " revision=excluded.revision,data=excluded.data,updated=excluded.updated",
        id,
        workspace,
        revision + 1,
        draft.toString(),
        Instant.now().toString());
    return object("id", id, "revision", revision + 1);
  }

  @PostMapping("/drafts/{id}/delete")
  @Transactional
  ObjectNode delete(HttpServletRequest req, @PathVariable String id, @RequestBody JsonNode input) {
    String workspace = access.require(req).workspace();
    JsonNode revision = input.path("revision");
    if (!Json.id(id) || !revision.isIntegralNumber() || !revision.canConvertToInt()
        || revision.asInt() < 1)
      throw new ApiException(400, "Некорректная версия карточки.");
    var row = db.one(
        "SELECT revision FROM rental_drafts WHERE workspace_id=? AND id=?", workspace, id);
    if (row == null) throw new ApiException(404, "Карточка аренды не найдена.");
    if (((Number) row.get("revision")).intValue() != revision.asInt())
      throw new ApiException(409,
          "Квартира изменена в другой вкладке. Откройте её заново и проверьте перед удалением.");
    db.run("DELETE FROM rental_drafts WHERE workspace_id=? AND id=? AND revision=?",
        workspace, id, revision.asInt());
    return object("deleted", true, "id", id);
  }
}
