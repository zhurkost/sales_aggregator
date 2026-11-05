package by.autopost.rental.engine;

import by.autopost.rental.model.Address;
import by.autopost.rental.model.Conversion;
import by.autopost.rental.model.FieldDef;
import by.autopost.rental.model.FormRecipe;
import by.autopost.rental.model.Mapping;
import by.autopost.rental.model.MappingRule;
import by.autopost.rental.model.Schema;
import by.autopost.rental.model.Value;
import java.math.BigDecimal;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.stream.Collectors;

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
   *
   * @param card the card values the native values were prepared from
   */
  public CardTransfer transfer(
      Map<String, Value> values,
      Address address,
      Schema schema,
      Mapping plan,
      Map<String, Value> card) {
    Map<String, MappingRule> rules = new HashMap<>();
    for (var rule : plan.fields()) rules.put(rule.platformOptionId(), rule);
    List<CardTransfer.FormValue> form = new ArrayList<>();
    List<CardTransfer.ManualValue> manual = new ArrayList<>();
    for (var row : rows) {
      Value value =
          row.addressPart().isEmpty()
              ? values.get(row.field())
              : Value.text(address.part(row.addressPart()));
      if (Value.missing(value)) continue;
      String text = text(schema.field(row.field()), rules.get(row.field()), value, card);
      if (row.inForm()) form.add(new CardTransfer.FormValue(row.field(), row.name(), text));
      else if (row.transfer() == Transfer.MANUAL)
        manual.add(new CardTransfer.ManualValue(row.field(), row.name(), text, row.reason()));
    }
    return new CardTransfer(form, manual);
  }

  /**
   * A native value as a person reads it: option names instead of codes, and the description as
   * typed instead of the HTML a rich text editor receives.
   */
  static String text(FieldDef field, MappingRule rule, Value value, Map<String, Value> card) {
    if (rule != null
        && rule.conversion() instanceof Conversion.PlainTextHtml
        && card.get(rule.commonOptionId()) instanceof Value.Text source
        && !source.blank()) return source.value();
    if (value instanceof Value.Items items)
      return items.items().stream().map(v -> option(field, v)).collect(Collectors.joining(", "));
    return option(field, value);
  }

  private static String option(FieldDef field, Value value) {
    if (field != null)
      for (var choice : field.choices())
        if (Value.same(choice.code(), value) && !choice.name().isEmpty()) return choice.name();
    if (value instanceof Value.Text text) return text.value();
    if (value instanceof Value.Num number) {
      BigDecimal n = number.value();
      return n.signum() == 0 ? "0" : n.stripTrailingZeros().toPlainString();
    }
    if (value instanceof Value.Bool bool) return Boolean.toString(bool.value());
    if (value instanceof Value.Items items)
      return items.items().stream().map(v -> option(null, v)).collect(Collectors.joining(", "));
    return "null";
  }

  /**
   * Plan rows in plan order, then address parts, coordinates, constants and deferred fields; one
   * row per native field. {@code graph} is what each native field depends on, with the conversion
   * dependencies of the plan. A row prepared from the card without a control or a reason is {@link
   * Transfer#PREPARED_ONLY}: the catalog rejects such a bundle.
   */
  public static PlatformCoverage of(
      String platform,
      Schema schema,
      Mapping plan,
      FormRecipe recipe,
      Map<String, Set<String>> graph) {
    var fields = schema.fields();
    Map<String, FormRecipe.FormControl> controls = new HashMap<>();
    for (var control : recipe.controlList()) controls.put(control.field(), control);
    Map<String, String> deferred = plan.deferredFields();
    Map<String, CoverageRow> rows = new LinkedHashMap<>();
    for (var row : plan.fields()) {
      String target = row.platformOptionId();
      var control = controls.get(target);
      boolean manual = row.manual();
      Transfer transfer =
          plan.constants().containsKey(target)
              ? Transfer.CONSTANT
              : manual
                  ? Transfer.MANUAL
                  : control != null ? Transfer.TRANSFERRED : Transfer.PREPARED_ONLY;
      rows.put(
          target,
          row(
              row.sources(),
              target,
              fields,
              control,
              transfer,
              manual && row.manualReason() != null ? row.manualReason() : ""));
    }
    for (var address : plan.addresses())
      fromAddress(
          rows,
          List.of("address." + address.part()),
          address.platformOptionId(),
          fields,
          controls,
          deferred);
    for (var coordinate : plan.coordinates()) {
      String axis = coordinate.axis();
      var sources =
          axis.equals("pair")
              ? List.of("address.latitude", "address.longitude")
              : List.of("address." + axis);
      fromAddress(rows, sources, coordinate.platformOptionId(), fields, controls, deferred);
    }
    plan.constants()
        .forEach(
            (field, value) ->
                rows.putIfAbsent(
                    field,
                    row(
                        List.of(),
                        field,
                        fields,
                        controls.get(field),
                        Transfer.CONSTANT,
                        json(value))));
    deferred.forEach(
        (field, reason) -> {
          var control = controls.get(field);
          String part = control == null || control.addressPart() == null ? "" : control.addressPart();
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
    return new PlatformCoverage(platform, list, needed(list, graph));
  }

  /** A constant as the coverage table shows it: its JSON. */
  private static String json(Value value) {
    if (value instanceof Value.Text text)
      return "\"" + text.value().replace("\\", "\\\\").replace("\"", "\\\"") + "\"";
    if (value instanceof Value.Items items)
      return items.items().stream().map(PlatformCoverage::json).collect(Collectors.joining(",", "[", "]"));
    return value.text().isEmpty() ? "null" : value.text();
  }

  private static void fromAddress(
      Map<String, CoverageRow> rows,
      List<String> sources,
      String target,
      Map<String, FieldDef> fields,
      Map<String, FormRecipe.FormControl> controls,
      Map<String, String> deferred) {
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
      Map<String, FieldDef> fields,
      FormRecipe.FormControl control,
      Transfer transfer,
      String reason) {
    var definition = fields.get(field);
    return new CoverageRow(
        sources,
        field,
        definition == null ? "" : definition.name(),
        element(control),
        control == null || control.addressPart() == null ? "" : control.addressPart(),
        transfer,
        reason);
  }

  /** The control as the coverage table shows it: action, selector, index and group label. */
  private static String element(FormRecipe.FormControl control) {
    if (control == null) return "";
    var element = new StringBuilder(control.action()).append(' ').append(control.selector());
    if (control.index() != null) element.append(" [").append(control.index()).append(']');
    if (control.label() != null) element.append(" «").append(control.label()).append('»');
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
