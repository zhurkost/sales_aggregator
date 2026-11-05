package by.autopost.rental.catalog;

import by.autopost.rental.engine.CoverageRow;
import by.autopost.rental.engine.PlatformCoverage;
import by.autopost.rental.engine.Transfer;
import by.autopost.rental.model.CardModel;
import by.autopost.rental.model.Condition;
import by.autopost.rental.model.Conversion;
import by.autopost.rental.model.FieldDef;
import by.autopost.rental.model.FieldType;
import by.autopost.rental.model.FormRecipe;
import by.autopost.rental.model.Mapping;
import by.autopost.rental.model.ReferenceContract;
import by.autopost.rental.model.Schema;
import by.autopost.rental.model.Value;
import by.autopost.shared.ApiException;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * Rejects broken bundles before any card can use them. Does not infer missing mappings. The
 * records already refuse unknown keys and values of another type; these checks are the references
 * between files and the facts no single record can check. Each check covers one file (common,
 * card.json, a schema, a plan), so the loader names the file to fix.
 */
public final class ReferenceValidator {
  private ReferenceValidator() {}

  /** common: one category of uniquely named fields. Returns the card fields by id. */
  static Map<String, FieldDef> common(Schema common) {
    check(common.categories().size() == 1, "common должен содержать одну категорию");
    var canonical = common.fields();
    check(!canonical.isEmpty(), "нет полей общей карточки");
    uniqueOptions(common);
    return canonical;
  }

  /** card.json against the card fields and the platforms registered in the manifest. */
  static void card(CardModel card, Map<String, FieldDef> canonical, Set<String> platforms) {
    Set<String> defaults = new HashSet<>();
    for (var rule : card.profileDefaults()) {
      String field = rule.field() == null ? "" : rule.field();
      check(
          Set.of("phone", "contactPerson", "company").contains(String.valueOf(rule.setting())),
          "неизвестное поле профиля");
      check(
          canonical.containsKey(field) && canonical.get(field).type() == FieldType.TEXT,
          "неизвестное текстовое поле профиля " + field);
      check(defaults.add(field), "несколько значений профиля для " + field);
    }
    check(
        card.version() != null && card.version() == ReferenceContract.CARD_MODEL_VERSION,
        "card.json должен описывать модель карточки версии "
            + ReferenceContract.CARD_MODEL_VERSION);
    check(card.platforms() != null, "нет названий площадок");
    check(card.canonicalValues() != null, "нет вариантов общей карточки canonicalValues");
    card.platforms()
        .forEach(
            (id, name) ->
                check(name != null && name.name() != null, "card.json: название " + id));
    check(card.platforms().keySet().equals(platforms), "реестр площадок не совпадает с комплектом");
  }

  /**
   * A source schema: unique ids, conditions and dependencies on its own fields, no cycles. Returns
   * what each field depends on, for the check of its plan.
   */
  static Map<String, Set<String>> schema(String platform, Schema schema) {
    check(!schema.categories().isEmpty(), platform + ": пустая схема");
    uniqueOptions(schema);
    var nativeFields = schema.fields();
    Map<String, Set<String>> graph = new LinkedHashMap<>();
    for (var field : nativeFields.values()) {
      var deps = new LinkedHashSet<String>();
      condition(field.when(), nativeFields, deps);
      for (var choice : field.choices()) condition(choice.when(), nativeFields, deps);
      for (String dep : field.rule().dependsOn()) {
        check(nativeFields.containsKey(dep), "зависимость от отсутствующего поля " + dep);
        deps.add(dep);
      }
      graph.put(field.id(), deps);
    }
    acyclic(graph);
    return graph;
  }

  /** A plan against its schema and the card fields; its conversions join the schema graph. */
  static void plan(
      String category,
      Map<String, FieldDef> canonical,
      String platform,
      Schema schema,
      Map<String, Set<String>> graph,
      Mapping plan) {
    var nativeFields = schema.fields();
    check(
        ReferenceContract.PREPARATION_VERSION.equals(plan.runtimeVersion()),
        platform + ": неподдерживаемая версия плана");
    check(platform.equals(plan.platform()), platform + ": неверная площадка в плане");
    String where = platform + ": план";
    if (plan.categoryId() != null)
      check(category.equals(plan.categoryId()), platform + ": неверная категория в плане");
    Set<String> targets = new HashSet<>();
    for (var row : plan.fields()) {
      String target = row.platformOptionId();
      check(
          nativeFields.containsKey(target) && nativeFields.get(target).type() != FieldType.GROUP,
          "неизвестное целевое поле " + target);
      check(targets.add(target), "несколько маппингов целевого поля " + target);
      // The only alternative to a form control: the user enters the field on the platform.
      if (row.manual()) {
        check(
            "manual".equals(row.transfer()),
            where + ", поле " + target + ": transfer может быть только manual");
        check(
            row.manualReason() != null
                && !row.manualReason().isBlank()
                && row.manualReason().length() <= 400,
            where + ", поле " + target + ": transfer: manual требует причину manual_reason");
      }
      conversion(row.conversion());
      check(!row.sources().isEmpty(), "у маппинга нет источника " + target);
      for (String source : row.sources())
        check(canonical.containsKey(source), "неизвестное поле карточки " + source);
      for (String dependency : row.conversion().requires()) {
        check(
            nativeFields.containsKey(dependency),
            "неизвестная зависимость преобразования " + dependency);
        graph.get(target).add(dependency);
      }
    }
    for (String target : plan.constants().keySet())
      check(nativeFields.containsKey(target), "неизвестная константа " + target);
    for (var item : plan.addresses())
      check(
          nativeFields.containsKey(item.platformOptionId()), "неизвестное поле адресного плана");
    for (var item : plan.coordinates())
      check(
          nativeFields.containsKey(item.platformOptionId()), "неизвестное поле адресного плана");
    for (String dep : plan.addressBoundFields())
      check(nativeFields.containsKey(dep), "неизвестное адресное поле " + dep);
    acyclic(graph);
  }

  /** Lookup tables: one native code per card code; a combined list names each card field once. */
  private static void conversion(Conversion conversion) {
    if (conversion instanceof Conversion.Lookup lookup) pairs(lookup.values());
    if (conversion instanceof Conversion.ListLookup lookup) pairs(lookup.values());
    if (conversion instanceof Conversion.MultiLookup list) {
      Set<String> members = new HashSet<>();
      for (var member : list.members()) {
        check(members.add(member.commonOptionId()), "повторный источник multi_lookup");
        pairs(member.values());
      }
    }
  }

  private static void pairs(List<Conversion.ValuePair> pairs) {
    Set<Value> sources = new HashSet<>();
    for (var pair : pairs)
      check(sources.add(pair.from()), "несколько соответствий одного исходного значения");
  }

  /** A row marked manual is entered on the platform: the recipe must not fill it as well. */
  static void manualWithoutControl(String platform, Mapping plan, FormRecipe form) {
    Set<String> controls = new HashSet<>();
    for (var control : form.controlList()) controls.add(control.field());
    for (var row : plan.fields())
      check(
          !(row.manual() && controls.contains(row.platformOptionId())),
          platform
              + ": поле "
              + row.platformOptionId()
              + " помечено transfer: manual, но его заполняет рецепт формы");
  }

  /** Nothing is prepared from the card without saying how it reaches the form. */
  static void everyFieldReachesTheForm(PlatformCoverage coverage) {
    var unmarked =
        coverage.rows().stream()
            .filter(row -> row.transfer() == Transfer.PREPARED_ONLY)
            .map(CoverageRow::field)
            .toList();
    check(
        unmarked.isEmpty(),
        coverage.platform()
            + ": поля подготовлены, но не попадают в форму: "
            + String.join(", ", unmarked)
            + ". Привяжите их в рецепте или пометьте в плане transfer: manual с причиной"
            + " manual_reason");
  }

  private static void uniqueOptions(Schema schema) {
    Set<String> ids = new HashSet<>();
    for (var category : schema.categories()) unique(category.options(), ids);
  }

  private static void unique(List<FieldDef> options, Set<String> ids) {
    for (var field : options) {
      String id = field.id();
      check(!id.isBlank() && ids.add(id), "пустой или повторяющийся id поля " + id);
      unique(field.options(), ids);
    }
  }

  /** A condition reads only fields of its own schema; they become dependencies of the field. */
  static void condition(Condition value, Map<String, FieldDef> fields, Set<String> dependencies) {
    if (value == null) return;
    Set<String> read = new LinkedHashSet<>();
    value.fields(read);
    for (String target : read)
      check(fields.containsKey(target), "условие ссылается на неизвестное поле " + target);
    dependencies.addAll(read);
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

  static void check(boolean valid, String message) {
    if (!valid) throw new ApiException(409, "Ошибка комплекта справочников: " + message + ".");
  }
}
