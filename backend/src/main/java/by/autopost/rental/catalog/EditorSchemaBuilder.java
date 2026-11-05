package by.autopost.rental.catalog;

import static by.autopost.shared.Json.*;

import by.autopost.rental.model.SchemaFields;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.util.TreeSet;

public final class EditorSchemaBuilder {
  public ObjectNode build(ReferenceSnapshot snapshot) {
    JsonNode common = snapshot.common(), audit = snapshot.audit();
    ObjectNode canonical = object();
    for (var e : audit.path("field_evidence"))
      if (e.has("canonical_values"))
        canonical.set(text(e, "common_option_id"), e.get("canonical_values"));
    if (snapshot.card().has("canonicalValues"))
      canonical = (ObjectNode) snapshot.card().get("canonicalValues").deepCopy();
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
      platforms.set(
          p,
          object(
              "name",
              snapshot.card().path("platforms").path(p).path("name").asText(p),
              "rules",
              plan.path("fields"),
              "addressBoundFields",
              plan.path("address_bound_fields"),
              "labels",
              labels,
              "choiceLabels",
              choiceLabels));
    }
    ObjectNode result =
        object(
            "category",
            common.get(0),
            "canonicalValues",
            canonical,
            "platforms",
            platforms,
            "version",
            snapshot.version());
    if (snapshot.card().path("version").asInt() >= 2)
      EditorCardDecorator.decorate(result, snapshot.card());
    return result;
  }
}
