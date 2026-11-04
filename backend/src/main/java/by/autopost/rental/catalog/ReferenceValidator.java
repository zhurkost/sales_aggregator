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

/** Reject broken bundles before any card can use them. Does not infer missing mappings. */
public final class ReferenceValidator {
  private static final Set<String> KINDS =
      Set.of(
          "identity",
          "lookup",
          "list_lookup",
          "multi_lookup",
          "decimal",
          "phone",
          "plain_text_html",
          "files");
  private static final Set<String> OPERATORS =
      Set.of("equals", "not_equals", "in", "not_in", "exists", "gt", "gte", "lt", "lte");

  public void validate(
      String category,
      JsonNode common,
      JsonNode card,
      Map<String, JsonNode> schemas,
      Map<String, JsonNode> plans) {
    check(common.isArray() && common.size() == 1, "common должен содержать одну категорию");
    var canonical = fields(common);
    check(!canonical.isEmpty(), "нет полей общей карточки");
    if (card.has("profileDefaults")) {
      check(card.path("profileDefaults").isArray(), "profileDefaults должен быть массивом");
      Set<String> defaults = new HashSet<>();
      for (var rule : card.path("profileDefaults")) {
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
    check(card.path("platforms").isObject(), "нет названий площадок");
    Set<String> registered = new HashSet<>();
    card.path("platforms").fieldNames().forEachRemaining(registered::add);
    check(registered.equals(schemas.keySet()), "реестр площадок не совпадает с комплектом");
    uniqueOptions(common);
    for (String platform : schemas.keySet()) {
      JsonNode schema = schemas.get(platform), plan = plans.get(platform);
      var nativeFields = fields(schema);
      check(schema.isArray() && !schema.isEmpty(), platform + ": пустая схема");
      uniqueOptions(schema);
      check(
          ReferenceContract.PREPARATION_VERSION.equals(text(plan, "runtime_version")),
          platform + ": неподдерживаемая версия плана");
      check(platform.equals(text(plan, "platform")), platform + ": неверная площадка в плане");
      if (plan.has("category_id"))
        check(
            category.equals(text(plan, "category_id")), platform + ": неверная категория в плане");
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
      Set<String> targets = new HashSet<>();
      for (var row : plan.path("fields")) {
        String target = text(row, "platform_option_id"),
            kind = text(row.path("conversion"), "kind");
        check(
            nativeFields.containsKey(target)
                && !text(nativeFields.get(target), "type").equals("group"),
            "неизвестное целевое поле " + target);
        check(targets.add(target), "несколько маппингов целевого поля " + target);
        check(KINDS.contains(kind), "неподдерживаемое преобразование " + kind);
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
  }

  private static Iterable<String> iterable(Iterator<String> iterator) {
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
