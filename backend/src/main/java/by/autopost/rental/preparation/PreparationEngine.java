package by.autopost.rental.preparation;

import static by.autopost.rental.model.Conditions.*;
import static by.autopost.rental.model.SchemaFields.*;
import static by.autopost.rental.model.Values.*;
import static by.autopost.rental.preparation.PreparationIssues.*;
import static by.autopost.shared.Json.*;

import by.autopost.shared.ApiException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.BigIntegerNode;
import com.fasterxml.jackson.databind.node.DecimalNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.math.BigDecimal;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Set;

public final class PreparationEngine {
  public static final String VERSION =
      by.autopost.rental.model.ReferenceContract.PREPARATION_VERSION;

  public ObjectNode prepare(
      JsonNode schema, JsonNode plan, ObjectNode common, ObjectNode extras, JsonNode address) {
    if (!text(plan, "runtime_version").equals(VERSION))
      throw new ApiException(409, "Версия правил подготовки не поддерживается.");
    Map<String, JsonNode> fields = fields(schema);
    ObjectNode values = object();
    ArrayNode issues = array();
    // All extras are explicit per-platform input, not a way to alter a server-owned mapping plan.
    extras
        .fields()
        .forEachRemaining(
            e -> {
              if (!fields.containsKey(e.getKey()))
                issue(
                    issues,
                    e.getKey(),
                    "unknown_field",
                    "Поле отсутствует в текущей схеме площадки.");
              else if (!missing(e.getValue())) {
                JsonNode value = e.getValue();
                String type = text(fields.get(e.getKey()), "type");
                if (value.isTextual() && Set.of("integer", "number").contains(type)) {
                  try {
                    BigDecimal n = decimal(value, type.equals("integer"));
                    value =
                        type.equals("integer")
                            ? BigIntegerNode.valueOf(n.toBigIntegerExact())
                            : DecimalNode.valueOf(n);
                  } catch (IllegalArgumentException ex) {
                    issue(issues, e.getKey(), "conversion", ex.getMessage());
                    return;
                  }
                }
                values.set(e.getKey(), value.deepCopy());
              }
            });
    plan.path("constants")
        .fields()
        .forEachRemaining(
            e -> {
              if (values.has(e.getKey()) && !equal(values.get(e.getKey()), e.getValue()))
                issue(
                    issues,
                    e.getKey(),
                    "route_conflict",
                    "Тип объекта или сделки не соответствует выбранной категории.");
              values.set(e.getKey(), e.getValue().deepCopy());
            });
    Map<String, JsonNode> rules = new LinkedHashMap<>();
    for (var row : plan.path("fields")) rules.put(text(row, "platform_option_id"), row);
    Set<String> visiting = new HashSet<>(), done = new HashSet<>();
    for (String target : rules.keySet())
      new RuleExecutor().apply(target, rules, fields, common, values, issues, visiting, done);
    new AddressPreparation().apply(plan, fields, common, values, issues, address);
    for (var c : schema)
      new FieldValidation().validate(c.path("options"), Truth.YES, values, issues);
    for (var check : plan.path("checks")) new FieldValidation().crossCheck(check, values, issues);
    for (var block : plan.path("review")) {
      String id = text(block, "field");
      if (id.isEmpty() || !missing(values.get(id)))
        issue(issues, id, "adapter_review", text(block, "message"));
    }
    return object(
        "applicability",
        new FieldApplicability().evaluate(schema, values),
        "platform",
        text(plan, "platform"),
        "values",
        values,
        "issues",
        issues,
        "dataReady",
        issues.isEmpty(),
        "publicationReady",
        false,
        "runtimeVersion",
        VERSION);
  }
}
