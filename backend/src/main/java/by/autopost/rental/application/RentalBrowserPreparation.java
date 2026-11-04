package by.autopost.rental.application;

import static by.autopost.shared.Json.*;

import by.autopost.rental.catalog.ReferenceSnapshot;
import by.autopost.rental.model.SchemaFields;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;

/**
 * Compiles filled native values and verified selectors. Issues never block a launch; each job's
 * checksPassed (no issues for that platform) only decides whether the extension may submit itself.
 */
final class RentalBrowserPreparation {
  ObjectNode compile(ReferenceSnapshot snapshot, JsonNode prepared, JsonNode draft) {
    var jobs = array();
    for (var result : prepared.path("platforms")) {
      String platform = text(result, "platform");
      ObjectNode recipe = (ObjectNode) snapshot.browser(platform);
      var fields = SchemaFields.fields(snapshot.schema(platform));
      var controls = array();
      for (var source : recipe.path("controls")) {
        String id = text(source, "field");
        JsonNode value = result.path("values").get(id);
        if (source.has("addressPart"))
          value = draft.path("address").get(text(source, "addressPart"));
        if (!text(source, "action").equals("files")
            && (value == null
                || value.isNull()
                || value.isTextual() && value.asText().isBlank()
                || value.isArray() && value.isEmpty())) continue;
        ObjectNode control = source.deepCopy();
        control.set("value", value == null ? array() : value.deepCopy());
        var matchContext = array();
        for (var part : source.path("autocomplete").path("contextParts")) {
          String context = text(draft.path("address"), part.asText());
          // A city may be its own first-level region (DaData's "г Минск").
          // The city already matches the primary suggestion label; treating it as an
          // additional oblast would reject the correct suggestion on another platform.
          if (part.asText().equals("region")
              && placeName(context).equals(placeName(text(draft.path("address"), "settlement"))))
            continue;
          if (!context.isBlank()) matchContext.add(context);
        }
        if (!matchContext.isEmpty()) control.set("matchContext", matchContext);
        control.put("name", text(fields.get(id), "name"));
        var labels = object();
        for (var choice : fields.get(id).path("options")) {
          var v = choice.path("fill_rule").get("value");
          if (v != null) labels.put(v.asText(), text(choice, "name"));
        }
        control.set("labels", labels);
        controls.add(control);
      }
      // The fields the user enters on the platform, as the check of the card lists them.
      var unbound = array();
      for (var manual : result.path("manual")) unbound.add(text(manual, "name"));
      recipe.set("controls", controls);
      recipe.set("unbound", unbound);
      recipe.put("checksPassed", result.path("checksPassed").asBoolean());
      jobs.add(recipe);
    }
    return object(
        "format", 1, "integrationVersion", snapshot.integrationVersion(), "jobs", jobs);
  }

  private String placeName(String value) {
    return value
        .toLowerCase(java.util.Locale.ROOT)
        .replaceAll("\\s+", " ")
        .trim()
        .replaceFirst("^(?:г\\.?|город)\\s+", "");
  }
}
