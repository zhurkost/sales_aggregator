package by.autopost.rental.engine;

import by.autopost.rental.model.Address;
import by.autopost.rental.model.Condition.Truth;
import by.autopost.rental.model.Mapping;
import by.autopost.rental.model.MappingRule;
import by.autopost.rental.model.ReferenceContract;
import by.autopost.rental.model.Schema;
import by.autopost.rental.model.Value;
import by.autopost.shared.ApiException;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Prepares the native values of one platform from the card values: the plan's constants, its rows
 * (each after the rows it requires), the address, then the schema's checks.
 */
public final class PreparationEngine {
  public static final String VERSION = ReferenceContract.PREPARATION_VERSION;

  /**
   * What one platform receives.
   *
   * @param values native field → value, in the order they were prepared
   * @param applies native field → whether it applies with these values
   */
  public record Preparation(
      String platform, Map<String, Value> values, List<Issue> issues, Map<String, Truth> applies) {
    public Preparation {
      values = Collections.unmodifiableMap(new LinkedHashMap<>(values));
      issues = List.copyOf(issues);
      applies = Collections.unmodifiableMap(new LinkedHashMap<>(applies));
    }

    public boolean checksPassed() {
      return issues.isEmpty();
    }
  }

  /**
   * @param card card field → value, with the values derived from the address
   */
  public Preparation prepare(Schema schema, Mapping plan, Map<String, Value> card, Address address) {
    if (!plan.runtimeVersion().equals(VERSION))
      throw new ApiException(409, "Версия правил подготовки не поддерживается.");
    var fields = schema.fields();
    Map<String, Value> values = new LinkedHashMap<>(plan.constants());
    var issues = new Issues();
    Map<String, MappingRule> rules = new LinkedHashMap<>();
    for (var row : plan.fields()) rules.put(row.platformOptionId(), row);
    var executor = new RuleExecutor(rules, fields, card, values, issues);
    for (String target : rules.keySet()) executor.apply(target);
    new AddressPreparation().apply(plan, fields, card, values, issues, address);
    Map<String, Truth> applies = new LinkedHashMap<>();
    var validation = new FieldValidation(values, issues, applies);
    for (var category : schema.categories()) validation.validate(category.options(), Truth.YES);
    for (var check : plan.checks()) validation.crossCheck(check);
    for (var note : plan.review())
      if (note.field().isEmpty() || !Value.missing(values.get(note.field())))
        issues.add(note.field(), "adapter_review", note.message());
    return new Preparation(plan.platform(), values, issues.list(), applies);
  }
}
