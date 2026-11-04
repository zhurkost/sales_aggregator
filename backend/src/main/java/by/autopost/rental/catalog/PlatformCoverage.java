package by.autopost.rental.catalog;

import static by.autopost.rental.catalog.ReferenceValidator.check;
import static by.autopost.shared.Json.*;

import by.autopost.rental.model.MappingSources;
import by.autopost.rental.model.SchemaFields;
import by.autopost.rental.model.Values;
import com.fasterxml.jackson.databind.JsonNode;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;

/**
 * Coverage of one platform, computed once when the bundle is loaded: every field its plan prepares
 * or fixes, with the recipe control that fills it or the reason it is not filled.
 *
 * @param needed native fields whose values matter to the form: the recipe fills them, or a field it
 *     fills depends on them (conditions, {@code depends_on}, {@code requires})
 */
public record PlatformCoverage(String platform, List<CoverageRow> rows, Set<String> needed) {
  public PlatformCoverage {
    rows = List.copyOf(rows);
    needed = Set.copyOf(needed);
  }

  public long count(Transfer transfer) {
    return rows.stream().filter(row -> row.transfer() == transfer).count();
  }

  public Optional<CoverageRow> row(String field) {
    return rows.stream().filter(row -> row.field().equals(field)).findFirst();
  }

  /**
   * What one prepared card sends to the form and what its user enters on the platform: the prepared
   * native values, and the address parts the address controls take from the card.
   */
  public CardTransfer transfer(JsonNode values, JsonNode address) {
    List<CardTransfer.FormValue> form = new ArrayList<>();
    List<CardTransfer.ManualValue> manual = new ArrayList<>();
    for (var row : rows) {
      JsonNode value =
          row.addressPart().isEmpty() ? values.get(row.field()) : address.get(row.addressPart());
      if (Values.missing(value)) continue;
      if (row.inForm())
        form.add(new CardTransfer.FormValue(row.field(), row.name(), value.deepCopy()));
      else if (row.transfer() == Transfer.MANUAL)
        manual.add(
            new CardTransfer.ManualValue(row.field(), row.name(), value.deepCopy(), row.reason()));
    }
    return new CardTransfer(form, manual);
  }

  /**
   * Plan rows in plan order, then address parts, coordinates, constants and deferred fields; one
   * row per native field. {@code graph} is what each native field depends on, with the conversion
   * dependencies of the plan.
   */
  static PlatformCoverage of(
      String platform,
      JsonNode schema,
      JsonNode plan,
      JsonNode recipe,
      Map<String, Set<String>> graph) {
    var fields = SchemaFields.fields(schema);
    Map<String, JsonNode> controls = new HashMap<>();
    for (var control : recipe.path("controls")) controls.put(text(control, "field"), control);
    Map<String, String> deferred = new LinkedHashMap<>();
    plan.path("deferred_fields")
        .fields()
        .forEachRemaining(e -> deferred.put(e.getKey(), e.getValue().asText()));
    Map<String, CoverageRow> rows = new LinkedHashMap<>();
    for (var row : plan.path("fields")) {
      String target = text(row, "platform_option_id");
      var control = controls.get(target);
      boolean manual = row.has("transfer");
      check(
          !(manual && control != null),
          platform
              + ": поле "
              + target
              + " помечено transfer: manual, но его заполняет рецепт формы");
      Transfer transfer =
          plan.path("constants").has(target)
              ? Transfer.CONSTANT
              : manual
                  ? Transfer.MANUAL
                  : control != null ? Transfer.TRANSFERRED : Transfer.PREPARED_ONLY;
      rows.put(
          target,
          row(
              MappingSources.sources(row),
              target,
              fields,
              control,
              transfer,
              manual ? text(row, "manual_reason") : ""));
    }
    for (var address : plan.path("addresses"))
      fromAddress(
          rows, List.of("address." + text(address, "part")), address, fields, controls, deferred);
    for (var coordinate : plan.path("coordinates")) {
      String axis = text(coordinate, "axis");
      var sources =
          axis.equals("pair")
              ? List.of("address.latitude", "address.longitude")
              : List.of("address." + axis);
      fromAddress(rows, sources, coordinate, fields, controls, deferred);
    }
    plan.path("constants")
        .fields()
        .forEachRemaining(
            constant ->
                rows.putIfAbsent(
                    constant.getKey(),
                    row(
                        List.of(),
                        constant.getKey(),
                        fields,
                        controls.get(constant.getKey()),
                        Transfer.CONSTANT,
                        constant.getValue().toString())));
    deferred.forEach(
        (field, reason) -> {
          var control = controls.get(field);
          String part = control == null ? "" : text(control, "addressPart");
          rows.putIfAbsent(
              field,
              row(
                  part.isEmpty() ? List.of() : List.of("address." + part),
                  field,
                  fields,
                  control,
                  control != null ? Transfer.TRANSFERRED : Transfer.DEFERRED,
                  control != null ? "" : reason));
        });
    var list = new ArrayList<>(rows.values());
    // Nothing is prepared from the card without saying how it reaches the form.
    var unmarked =
        list.stream()
            .filter(row -> row.transfer() == Transfer.PREPARED_ONLY)
            .map(CoverageRow::field)
            .toList();
    check(
        unmarked.isEmpty(),
        platform
            + ": поля подготовлены, но не попадают в форму: "
            + String.join(", ", unmarked)
            + ". Привяжите их в рецепте или пометьте в плане transfer: manual с причиной"
            + " manual_reason");
    return new PlatformCoverage(platform, list, needed(list, graph));
  }

  private static void fromAddress(
      Map<String, CoverageRow> rows,
      List<String> sources,
      JsonNode entry,
      Map<String, JsonNode> fields,
      Map<String, JsonNode> controls,
      Map<String, String> deferred) {
    String target = text(entry, "platform_option_id");
    var control = controls.get(target);
    Transfer transfer =
        control != null
            ? Transfer.TRANSFERRED
            : deferred.containsKey(target) ? Transfer.DEFERRED : Transfer.PREPARED_ONLY;
    rows.putIfAbsent(
        target,
        row(
            sources,
            target,
            fields,
            control,
            transfer,
            transfer == Transfer.DEFERRED ? deferred.get(target) : ""));
  }

  private static CoverageRow row(
      List<String> sources,
      String field,
      Map<String, JsonNode> fields,
      JsonNode control,
      Transfer transfer,
      String reason) {
    return new CoverageRow(
        sources,
        field,
        text(fields.get(field), "name"),
        element(control),
        control == null ? "" : text(control, "addressPart"),
        transfer,
        reason);
  }

  /** The control as the coverage table shows it: action, selector, index and group label. */
  private static String element(JsonNode control) {
    if (control == null) return "";
    var element =
        new StringBuilder(text(control, "action")).append(' ').append(text(control, "selector"));
    if (control.has("index"))
      element.append(" [").append(control.path("index").asInt()).append(']');
    if (control.has("label")) element.append(" «").append(text(control, "label")).append('»');
    return element.toString();
  }

  private static Set<String> needed(List<CoverageRow> rows, Map<String, Set<String>> graph) {
    Set<String> needed = new HashSet<>();
    var todo = new ArrayDeque<String>();
    for (var row : rows) if (row.inForm()) todo.add(row.field());
    while (!todo.isEmpty()) {
      String field = todo.pop();
      if (needed.add(field)) todo.addAll(graph.getOrDefault(field, Set.of()));
    }
    return needed;
  }
}
