package by.autopost.rental.catalog;

import static by.autopost.rental.model.Conditions.*;
import static by.autopost.rental.model.MappingSources.sources;
import static by.autopost.shared.Json.*;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.util.List;

public final class EditorCardDecorator {
  /**
   * Adds card.json and, to every card field, its uses: the platform rows it feeds and whether
   * that platform's form needs the value ({@code transferred}, from the coverage of the plan).
   */
  public static void decorate(ObjectNode editor, ReferenceSnapshot snapshot) {
    JsonNode card = snapshot.card();
    editor.set("card", card.deepCopy());
    ArrayNode groups = array();
    for (var group : editor.path("category").path("options")) {
      if (text(group, "id").equals("group.address_projection")) continue;
      ObjectNode copy = group.deepCopy();
      for (var f : copy.path("options")) {
        ArrayNode uses = array();
        editor
            .path("platforms")
            .fields()
            .forEachRemaining(
                platform -> {
                  for (var row : platform.getValue().path("rules")) {
                    List<String> sources = sources(row);
                    String target = text(row, "platform_option_id");
                    if (sources.contains(text(f, "id")))
                      uses.add(
                          object(
                              "platform",
                              platform.getKey(),
                              "target",
                              target,
                              "when",
                              platform.getValue().path("conditions").get(target),
                              "transferred",
                              snapshot.coverage(platform.getKey()).needed().contains(target)));
                  }
                });
        ((ObjectNode) f).set("uses", uses);
      }
      groups.add(copy);
    }
    ((ObjectNode) editor.path("category")).set("options", groups);
  }
}
