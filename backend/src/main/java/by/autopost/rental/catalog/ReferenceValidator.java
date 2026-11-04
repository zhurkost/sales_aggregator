package by.autopost.rental.catalog;

import static by.autopost.rental.model.MappingSources.sources;
import static by.autopost.rental.model.SchemaFields.fields;
import static by.autopost.shared.Json.*;

import by.autopost.rental.model.ReferenceContract;
import by.autopost.shared.ApiException;
import com.fasterxml.jackson.databind.JsonNode;
import java.util.HashSet;
import java.util.Iterator;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * Reject broken bundles before any card can use them. Does not infer missing mappings. Each check
 * covers one file (common, card.json, a schema, a plan), so the loader names the file to fix.
 */
public final class ReferenceValidator {
  /** Keys of each conversion kind; the kinds are the executable handlers. */
  private static final Map<String, Set<String>> CONVERSIONS =
      Map.of(
          "identity", Set.of("kind", "requires"),
          "lookup", Set.of("kind", "values", "requires"),
          "list_lookup", Set.of("kind", "values", "requires"),
          "multi_lookup", Set.of("kind", "members", "requires"),
          "decimal", Set.of("kind", "target", "requires", "currency_field", "integer_currencies"),
          "phone", Set.of("kind", "format", "requires"),
          "plain_text_html", Set.of("kind", "requires"),
          "files", Set.of("kind", "requires"));
  private static final Set<String> KINDS = CONVERSIONS.keySet();
  private static final Set<String> CARD =
      Set.of(
          "version",
          "profileDefaults",
          "valueLabels",
          "platforms",
          "canonicalValues",
          "addressProjection",
          "addressDependentFacts");
  private static final Set<String> PLAN =
      Set.of(
          "runtime_version",
          "category_id",
          "platform",
          "fields",
          "constants",
          "addresses",
          "coordinates",
          "checks",
          "review",
          "address_bound_fields",
          "deferred_fields");
  private static final Set<String> ROW =
      Set.of(
          "common_option_id",
          "platform_option_id",
          "conversion",
          "editor_group",
          "editor_group_name",
          "transfer",
          "manual_reason");
  private static final Map<String, Set<String>> PLAN_LISTS =
      Map.of(
          "addresses", Set.of("platform_option_id", "part", "scalar_verified"),
          "coordinates", Set.of("platform_option_id", "axis"),
          "checks", Set.of("left", "right", "message"),
          "review", Set.of("field", "message"));
  private static final Set<String> OPERATORS =
      Set.of("equals", "not_equals", "in", "not_in", "exists", "gt", "gte", "lt", "lte");

  private ReferenceValidator() {}

  /** common: one category of uniquely named fields. Returns the card fields by id. */
  static Map<String, JsonNode> common(JsonNode common) {
    check(common.isArray() && common.size() == 1, "common должен содержать одну категорию");
    var canonical = fields(common);
    check(!canonical.isEmpty(), "нет полей общей карточки");
    uniqueOptions(common);
    return canonical;
  }

  /** card.json against the card fields and the platforms registered in the manifest. */
  static void card(JsonNode card, Map<String, JsonNode> canonical, Set<String> platforms) {
    cardKeys(card);
    if (card.has("profileDefaults")) {
      check(card.path("profileDefaults").isArray(), "profileDefaults должен быть массивом");
      Set<String> defaults = new HashSet<>();
      for (var rule : card.path("profileDefaults")) {
        keys(rule, "card.json: profileDefaults", Set.of("setting", "field"));
        String field = text(rule, "field");
        check(
            Set.of("phone", "contactPerson", "company").contains(text(rule, "setting")),
            "неизвестное поле профиля");
        check(
            canonical.containsKey(field) && text(canonical.get(field), "type").equals("text"),
            "неизвестное текстовое поле профиля " + field);
        check(defaults.add(field), "несколько значений профиля для " + field);
      }
    }
    check(
        card.path("version").isInt()
            && card.path("version").asInt() == ReferenceContract.CARD_MODEL_VERSION,
        "card.json должен описывать модель карточки версии "
            + ReferenceContract.CARD_MODEL_VERSION);
    check(card.path("platforms").isObject(), "нет названий площадок");
    check(card.path("canonicalValues").isObject(), "нет вариантов общей карточки canonicalValues");
    Set<String> registered = new HashSet<>();
    card.path("platforms").fieldNames().forEachRemaining(registered::add);
    check(registered.equals(platforms), "реестр площадок не совпадает с комплектом");
  }

  /**
   * A source schema: unique ids, conditions and dependencies on its own fields, no cycles. Returns
   * what each field depends on, for the check of its plan.
   */
  static Map<String, Set<String>> schema(String platform, JsonNode schema) {
    check(schema.isArray() && !schema.isEmpty(), platform + ": пустая схема");
    uniqueOptions(schema);
    var nativeFields = fields(schema);
    Map<String, Set<String>> graph = new LinkedHashMap<>();
    for (var field : nativeFields.values()) {
      String id = text(field, "id");
      var deps = new LinkedHashSet<String>();
      condition(field.path("fill_rule").get("when"), nativeFields, deps);
      for (var choice : field.path("options"))
        if (text(choice, "type").equals("choice"))
          condition(choice.path("fill_rule").get("when"), nativeFields, deps);
      for (var dep : field.path("fill_rule").path("depends_on")) {
        check(
            nativeFields.containsKey(dep.asText()),
            "зависимость от отсутствующего поля " + dep.asText());
        deps.add(dep.asText());
      }
      graph.put(id, deps);
    }
    acyclic(graph);
    return graph;
  }

  /** A plan against its schema and the card fields; its conversions join the schema graph. */
  static void plan(
      String category,
      Map<String, JsonNode> canonical,
      String platform,
      JsonNode schema,
      Map<String, Set<String>> graph,
      JsonNode plan) {
    var nativeFields = fields(schema);
    check(
        ReferenceContract.PREPARATION_VERSION.equals(text(plan, "runtime_version")),
        platform + ": неподдерживаемая версия плана");
    check(platform.equals(text(plan, "platform")), platform + ": неверная площадка в плане");
    String where = platform + ": план";
    keys(plan, where, PLAN);
    if (plan.has("category_id"))
      check(category.equals(text(plan, "category_id")), platform + ": неверная категория в плане");
    Set<String> targets = new HashSet<>();
    for (var row : plan.path("fields")) {
      String target = text(row, "platform_option_id"),
          kind = text(row.path("conversion"), "kind");
      check(
          nativeFields.containsKey(target)
              && !text(nativeFields.get(target), "type").equals("group"),
          "неизвестное целевое поле " + target);
      check(targets.add(target), "несколько маппингов целевого поля " + target);
      keys(row, where + ", поле " + target, ROW);
      // The only alternative to a form control: the user enters the field on the platform.
      if (row.has("transfer") || row.has("manual_reason")) {
        check(
            text(row, "transfer").equals("manual"),
            where + ", поле " + target + ": transfer может быть только manual");
        check(
            row.path("manual_reason").isTextual()
                && !text(row, "manual_reason").isBlank()
                && text(row, "manual_reason").length() <= 400,
            where + ", поле " + target + ": transfer: manual требует причину manual_reason");
      }
      check(KINDS.contains(kind), "неподдерживаемое преобразование " + kind);
      keys(
          row.path("conversion"),
          where + ", поле " + target + ", преобразование " + kind,
          CONVERSIONS.get(kind));
      new ConversionValidator().validate(row.path("conversion"));
      check(!sources(row).isEmpty(), "у маппинга нет источника " + target);
      for (String source : sources(row))
        check(canonical.containsKey(source), "неизвестное поле карточки " + source);
      for (var dependency : row.path("conversion").path("requires")) {
        check(
            nativeFields.containsKey(dependency.asText()),
            "неизвестная зависимость преобразования " + dependency.asText());
        graph.get(target).add(dependency.asText());
      }
    }
    for (var list : PLAN_LISTS.entrySet()) {
      var items = plan.path(list.getKey());
      check(items.isMissingNode() || items.isArray(), where + ": " + list.getKey() + " — список");
      for (var item : items) keys(item, where + ": " + list.getKey(), list.getValue());
    }
    for (String key : List.of("constants", "deferred_fields"))
      check(
          plan.path(key).isMissingNode() || plan.path(key).isObject(),
          where + ": " + key + " — объект");
    for (var message : plan.path("deferred_fields"))
      check(message.isTextual(), where + ": deferred_fields содержит текст причины");
    for (String target : iterable(plan.path("constants").fieldNames()))
      check(nativeFields.containsKey(target), "неизвестная константа " + target);
    for (String key : List.of("addresses", "coordinates"))
      for (var item : plan.path(key))
        check(
            nativeFields.containsKey(text(item, "platform_option_id")),
            "неизвестное поле адресного плана");
    for (var dep : plan.path("address_bound_fields"))
      check(nativeFields.containsKey(dep.asText()), "неизвестное адресное поле " + dep.asText());
    acyclic(graph);
  }

  /** card.json: only what the editor and preparation read, each with its JSON type. */
  private static void cardKeys(JsonNode card) {
    keys(card, "card.json", CARD);
    for (var entry : iterable(card.path("platforms").fields())) {
      keys(entry.getValue(), "card.json: площадка " + entry.getKey(), Set.of("name"));
      check(entry.getValue().path("name").isTextual(), "card.json: название " + entry.getKey());
    }
    for (String key : List.of("valueLabels", "addressProjection"))
      for (var value : card.path(key))
        check(value.isTextual(), "card.json: " + key + " содержит только строки");
    for (var values : card.path("canonicalValues")) {
      check(values.isArray(), "card.json: canonicalValues содержит списки");
      for (var value : values) check(value.isTextual(), "card.json: варианты — строки");
    }
    check(
        card.path("addressDependentFacts").isMissingNode()
            || card.path("addressDependentFacts").isArray(),
        "card.json: addressDependentFacts — список");
    for (var fact : card.path("addressDependentFacts"))
      check(fact.isTextual(), "card.json: addressDependentFacts содержит id полей");
  }

  private static <T> Iterable<T> iterable(Iterator<T> iterator) {
    return () -> iterator;
  }

  private static void uniqueOptions(JsonNode schema) {
    Set<String> ids = new HashSet<>();
    for (var category : schema) unique(category.path("options"), ids);
  }

  private static void unique(JsonNode options, Set<String> ids) {
    check(options.isArray(), "options должен быть массивом");
    for (var field : options) {
      String id = text(field, "id");
      check(!id.isBlank() && ids.add(id), "пустой или повторяющийся id поля " + id);
      check(
          Set.of(
                  "group",
                  "text",
                  "integer",
                  "number",
                  "boolean",
                  "date",
                  "datetime",
                  "enum",
                  "multi_enum",
                  "choice",
                  "files")
              .contains(text(field, "type")),
          "неизвестный тип поля " + id);
      unique(field.path("options"), ids);
    }
  }

  static void condition(JsonNode value, Map<String, JsonNode> fields, Set<String> dependencies) {
    if (value == null || value.isMissingNode()) return;
    check(value.isObject(), "некорректное условие применимости");
    int forms =
        (value.has("not") ? 1 : 0)
            + (value.has("all") ? 1 : 0)
            + (value.has("any") ? 1 : 0)
            + (value.has("option_id") ? 1 : 0);
    check(forms == 1, "условие должно содержать одну операцию");
    if (value.has("not")) {
      condition(value.get("not"), fields, dependencies);
      return;
    }
    for (String kind : List.of("all", "any"))
      if (value.has(kind)) {
        check(value.get(kind).isArray(), "неверный список условий");
        for (var child : value.get(kind)) condition(child, fields, dependencies);
        return;
      }
    String target = text(value, "option_id"), operator = text(value, "operator");
    check(fields.containsKey(target), "условие ссылается на неизвестное поле " + target);
    check(OPERATORS.contains(operator), "неизвестная операция условия " + operator);
    check(
        operator.equals("exists") || value.has("value"),
        "в условии отсутствует сравниваемое значение");
    dependencies.add(target);
    if (operator.equals("in") || operator.equals("not_in"))
      check(value.path("value").isArray(), "условие in требует список");
  }

  static void acyclic(Map<String, Set<String>> graph) {
    Set<String> done = new HashSet<>(), visiting = new HashSet<>();
    for (String id : graph.keySet()) visit(id, graph, visiting, done);
  }

  private static void visit(
      String id, Map<String, Set<String>> graph, Set<String> visiting, Set<String> done) {
    if (done.contains(id)) return;
    check(visiting.add(id), "цикл зависимостей в поле " + id);
    for (String dep : graph.getOrDefault(id, Set.of())) visit(dep, graph, visiting, done);
    visiting.remove(id);
    done.add(id);
  }

  /** Every reference object lists its keys: a misspelt or unread key is an error, not a no-op. */
  static void keys(JsonNode value, String where, Set<String> allowed) {
    check(value.isObject(), where + " должен быть объектом");
    for (String key : iterable(value.fieldNames()))
      check(allowed.contains(key), where + ": неизвестный ключ " + key);
  }

  static void check(boolean valid, String message) {
    if (!valid) throw new ApiException(409, "Ошибка комплекта справочников: " + message + ".");
  }
}
