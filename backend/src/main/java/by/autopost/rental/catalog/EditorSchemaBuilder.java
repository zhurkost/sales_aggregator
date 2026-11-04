package by.autopost.rental.catalog;

import static by.autopost.rental.model.Conditions.*;
import static by.autopost.rental.model.SchemaFields.*;
import static by.autopost.shared.Json.*;

import by.autopost.rental.model.ReferenceContract;
import by.autopost.rental.model.SchemaFields;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.TreeSet;

public final class EditorSchemaBuilder {
  public ObjectNode build(ReferenceSnapshot snapshot) {
    JsonNode common = snapshot.common();
    JsonNode canonical = snapshot.card().path("canonicalValues");
    ObjectNode platforms = object();
    for (String p : new TreeSet<>(snapshot.platforms())) {
      var schema = snapshot.schema(p);
      var plan = snapshot.plan(p);
      ObjectNode labels = object(), choiceLabels = object();
      for (var f : SchemaFields.fields(schema).values()) {
        String id = text(f, "id");
        labels.put(id, text(f, "name"));
        ObjectNode choices = object();
        for (var choice : f.path("options"))
          if (text(choice, "type").equals("choice"))
            choices.put(choice.path("fill_rule").path("value").toString(), text(choice, "name"));
        if (!choices.isEmpty()) choiceLabels.set(id, choices);
      }
      ObjectNode conditions = object();
      for (var f : editorFields(schema).values())
        if (f.has("uiWhen")) conditions.set(text(f, "id"), f.get("uiWhen"));
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
              "name",
              snapshot.card().path("platforms").path(p).path("name").asText(p),
              "rules",
              plan.path("fields"),
              "conditions",
              conditions,
              "deferred",
              plan.path("deferred_fields"),
              "labels",
              labels,
              "choiceLabels",
              choiceLabels,
              "constants",
              plan.path("constants"),
              "bindings",
              bindings));
    }
    ObjectNode result =
        object(
            "category",
            common.get(0),
            "canonicalValues",
            canonical,
            "platforms",
            platforms,
            "cardVersion",
            snapshot.cardVersion(),
            "runtimeVersion",
            ReferenceContract.PREPARATION_VERSION);
    EditorCardDecorator.decorate(result, snapshot);
    return result;
  }

  // Preserve inherited group conditions in the editor without changing the source contract.
  public static Map<String, JsonNode> editorFields(JsonNode schema) {
    Map<String, JsonNode> result = new LinkedHashMap<>();
    for (var category : schema) editorFields(category.path("options"), null, result);
    return result;
  }

  public static void editorFields(JsonNode options, JsonNode parent, Map<String, JsonNode> result) {
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
}
