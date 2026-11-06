package by.autopost.rental.catalog;

import static by.autopost.shared.Json.*;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.util.List;

/** Explicit public read model: never serialize preparation plans into the web editor. */
public final class EditorContract {
  public ObjectNode project(ObjectNode internal) {
    var result =
        object(
            "version",
            internal.path("version"),
            "serverApplicability",
            true,
            "canonicalValues",
            internal.path("canonicalValues"),
            "category",
            field(internal.path("category")));
    var card = object();
    for (String key : List.of("version", "valueLabels", "addressDependentFacts", "profileDefaults", "mainFields"))
      if (internal.path("card").has(key)) card.set(key, internal.path("card").get(key).deepCopy());
    if (internal.path("card").path("addressProjection").isObject()) {
      var projected = array();
      internal.path("card").path("addressProjection").fieldNames().forEachRemaining(projected::add);
      card.set("addressProjectionFields", projected);
    }
    if (!card.isEmpty()) result.set("card", card);
    var platforms = object();
    internal
        .path("platforms")
        .fields()
        .forEachRemaining(
            entry -> {
              var platform = object();
              for (String key : List.of("name", "labels", "choiceLabels", "addressBoundFields"))
                if (entry.getValue().has(key))
                  platform.set(key, entry.getValue().get(key).deepCopy());
              platforms.set(entry.getKey(), platform);
            });
    result.set("platforms", platforms);
    return result;
  }

  private ObjectNode field(JsonNode source) {
    var result = object();
    for (String key : List.of("id", "name", "description", "type"))
      if (source.has(key)) result.set(key, source.get(key).deepCopy());
    var options = array();
    for (var child : source.path("options")) options.add(field(child));
    result.set("options", options);
    if (source.has("uses")) {
      var uses = array();
      for (var use : source.path("uses"))
        uses.add(object("platform", use.path("platform"), "target", use.path("target")));
      result.set("uses", uses);
    }
    return result;
  }
}
