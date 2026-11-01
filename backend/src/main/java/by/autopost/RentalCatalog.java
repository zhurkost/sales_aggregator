package by.autopost;

import static by.autopost.Json.*;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.*;
import java.nio.file.*;
import java.util.*;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

/** Private reference data live outside the JAR and public repository. */
@Service
class RentalCatalog {
  static final String CATEGORY = "apartments_long_term_rent";
  static final Set<String> PLATFORMS = Set.of("kufar", "onliner", "realt", "domovita");
  final Path root;

  RentalCatalog(@Value("${autopost.rental-reference-dir:}") String directory) {
    root = directory.isBlank() ? null : Path.of(directory).toAbsolutePath().normalize();
  }

  JsonNode load(String relative) {
    if (root == null)
      throw new ApiException(503, "Справочники аренды ещё не подключены на сервере.");
    Path p = root.resolve(relative).normalize();
    if (!p.startsWith(root)) throw new ApiException(400, "Некорректный путь справочника.");
    try {
      if (Files.size(p) > 5 * 1024 * 1024) throw new IllegalArgumentException();
      return MAPPER.readTree(Files.readAllBytes(p));
    } catch (Exception e) {
      throw new ApiException(
          503, "Нужна актуальная версия справочников аренды. Обратитесь к администратору.");
    }
  }

  JsonNode common() {
    return load("integration/" + CATEGORY + "_common.json");
  }

  JsonNode schema(String p) {
    platform(p);
    return load(p + "/" + CATEGORY + "_" + p + ".json");
  }

  JsonNode plan(String p) {
    platform(p);
    JsonNode plan = load("runtime/preparation_" + p + ".json");
    if (!text(plan, "schema_hash").equals(Access.hash(schema(p).toString()))
        || !text(plan, "common_hash").equals(Access.hash(common().toString())))
      throw new ApiException(
          409, "Справочник изменился: обновите правила подготовки вместе со схемой.");
    return plan;
  }

  static void platform(String p) {
    if (!PLATFORMS.contains(p)) throw new ApiException(400, "Неизвестная площадка.");
  }

  String version() {
    ObjectNode snapshot = object("common", common());
    for (String p : new TreeSet<>(PLATFORMS)) snapshot.set(p, plan(p));
    return Access.hash(snapshot.toString());
  }

  ObjectNode editor() {
    JsonNode common = common(), audit = load("integration/integration-audit.json");
    ObjectNode canonical = object();
    for (var e : audit.path("field_evidence"))
      if (e.has("canonical_values"))
        canonical.set(text(e, "common_option_id"), e.get("canonical_values"));
    ObjectNode platforms = object();
    for (String p : new TreeSet<>(PLATFORMS)) {
      var schema = schema(p);
      var plan = plan(p);
      Set<String> mapped = new HashSet<>();
      for (var row : plan.path("fields")) mapped.add(text(row, "platform_option_id"));
      ArrayNode extra = array();
      for (var f : editorFields(schema).values()) {
        String id = text(f, "id"), type = text(f, "type");
        if (type.equals("group") || plan.path("constants").has(id)) continue;
        if (!mapped.contains(id) || type.equals("multi_enum")) extra.add(f.deepCopy());
      }
      ObjectNode labels = object(), choiceLabels = object();
      for (var f : PreparationEngine.fields(schema).values()) {
        String id = text(f, "id");
        labels.put(id, text(f, "name"));
        ObjectNode choices = object();
        for (var choice : f.path("options"))
          if (text(choice, "type").equals("choice"))
            choices.put(choice.path("fill_rule").path("value").toString(), text(choice, "name"));
        if (!choices.isEmpty()) choiceLabels.set(id, choices);
      }
      ArrayNode bindings = array();
      for (var row : plan.path("fields"))
        if (text(row.path("conversion"), "kind").equals("lookup"))
          bindings.add(
              object(
                  "source",
                  text(row, "common_option_id"),
                  "target",
                  text(row, "platform_option_id"),
                  "pairs",
                  row.path("conversion").path("values")));
      platforms.set(
          p,
          object(
              "extras",
              extra,
              "labels",
              labels,
              "choiceLabels",
              choiceLabels,
              "constants",
              plan.path("constants"),
              "bindings",
              bindings,
              "coverage",
              "partial"));
    }
    return object(
        "category",
        common.get(0),
        "canonicalValues",
        canonical,
        "platforms",
        platforms,
        "version",
        version(),
        "runtimeVersion",
        PreparationEngine.VERSION);
  }

  // Preserve inherited group conditions in the editor without changing the source contract.
  static Map<String, JsonNode> editorFields(JsonNode schema) {
    Map<String, JsonNode> result = new LinkedHashMap<>();
    for (var category : schema) editorFields(category.path("options"), null, result);
    return result;
  }

  static void editorFields(JsonNode options, JsonNode parent, Map<String, JsonNode> result) {
    for (var field : options) {
      JsonNode own = field.path("fill_rule").get("when");
      JsonNode condition =
          parent == null ? own : own == null ? parent : object("all", List.of(parent, own));
      if (text(field, "type").equals("group"))
        editorFields(field.path("options"), condition, result);
      else if (!text(field, "type").equals("choice")) {
        ObjectNode copy = field.deepCopy();
        if (condition != null) copy.set("uiWhen", condition);
        result.put(text(field, "id"), copy);
      }
    }
  }

  ObjectNode prepare(JsonNode input) {
    ObjectNode common = object(), extras = object();
    if (input.path("values").isObject()) common = (ObjectNode) input.get("values").deepCopy();
    if (input.path("extras").isObject()) extras = (ObjectNode) input.get("extras").deepCopy();
    if (!text(input, "schemaVersion").equals(version()))
      throw new ApiException(
          409, "Схема обновилась. Обновите форму и проверьте сохранённые данные.");
    ArrayNode output = array();
    PreparationEngine engine = new PreparationEngine();
    var selected = list(input.path("platforms"));
    if (selected.isEmpty() || selected.size() > 4)
      throw new ApiException(400, "Выберите от одной до четырёх площадок.");
    Set<String> seen = new HashSet<>();
    for (var id : selected) {
      String p = id.asText();
      platform(p);
      if (!seen.add(p)) continue;
      JsonNode specific = extras.path(p);
      if (!specific.isObject() && !specific.isMissingNode())
        throw new ApiException(400, "Уточнения площадки должны быть объектом.");
      output.add(
          engine.prepare(
              schema(p),
              plan(p),
              common,
              specific.isObject() ? (ObjectNode) specific : object(),
              input.path("address")));
    }
    return object("platforms", output, "schemaVersion", text(input, "schemaVersion"));
  }
}
