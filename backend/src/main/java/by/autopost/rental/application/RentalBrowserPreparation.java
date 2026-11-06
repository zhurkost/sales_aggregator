package by.autopost.rental.application;

import static by.autopost.shared.Json.*;

import by.autopost.rental.catalog.ReferenceSnapshot;
import by.autopost.rental.ai.LiteralAddress;
import by.autopost.address.application.StreetKind;
import by.autopost.rental.model.SchemaFields;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;

/** Compiles filled native values and verified selectors, independent of advisory readiness. */
final class RentalBrowserPreparation {
  ObjectNode compile(ReferenceSnapshot snapshot, JsonNode prepared, JsonNode card) {
    var jobs = array();
    for (var result : prepared.path("platforms")) {
      String platform = text(result, "platform");
      ObjectNode recipe = (ObjectNode) snapshot.browser(platform);
      var fields = SchemaFields.fields(snapshot.schema(platform));
      var controls = array();
      var unsupported = array();
      var supported = new java.util.HashSet<String>();
      for (var source : recipe.path("controls")) {
        String id = text(source, "field");
        supported.add(id);
        JsonNode value = result.path("values").get(id);
        if (source.has("addressPart")) {
          value = card.path("address").get(text(source, "addressPart"));
          if (value != null && value.isTextual())
            value = com.fasterxml.jackson.databind.node.TextNode.valueOf(
                text(source, "addressPart").equals("label")
                    ? LiteralAddress.searchText(card.path("address"))
                    : text(source, "addressPart").equals("settlement") &&
                        text(source.path("autocomplete"), "kind").equals("address")
                    ? LiteralAddress.searchText(object("label", value.asText()))
                    : LiteralAddress.cleanComponent(value.asText(), text(source, "addressPart")));
        }
        if (!text(source, "action").equals("files")
            && (value == null
                || value.isNull()
                || value.isTextual() && value.asText().isBlank()
                || value.isArray() && value.isEmpty() && !source.path("replaceGroup").asBoolean())) continue;
        ObjectNode control = source.deepCopy();
        control.set("value", value == null ? array() : value.deepCopy());
        if (source.has("addressPart")) {
          String part = text(source, "addressPart");
          String current = text(card.path("address"), part);
          String original = text(card.path("address"), part + "WithType");
          if (original.isBlank() || !LiteralAddress.cleanComponent(current, part).equals(current))
            original = current;
          boolean sameAddress = value != null && (part.equals("label")
              ? LiteralAddress.searchText(object("label", original)).equals(value.asText())
              : LiteralAddress.cleanComponent(original, part).equals(value.asText()));
          if (sameAddress)
            control.put("matchValue", original);
        }
        if (text(source, "addressPart").equals("street") || text(source, "addressPart").equals("label")) {
          var address = card.path("address");
          var street = StreetKind.parse(text(address, "street"));
          String code = street.code();
          if (code.isBlank()) {
            var previous = StreetKind.parse(text(address, "streetWithType"));
            code = previous.name().equalsIgnoreCase(street.name()) && !previous.code().isBlank()
                ? previous.code() : text(address, "streetType");
          }
          if (!street.name().isBlank()) {
            control.put("streetName", street.name());
            if (code.matches("[а-яё]{2}")) control.put("streetType", code);
          }
        }
        var matchContext = array();
        for (var part : source.path("autocomplete").path("contextParts")) {
          String context = text(card.path("address"), part.asText());
          // A city may be its own first-level region (DaData's "г Минск").
          // The city already matches the primary suggestion label; treating it as an
          // additional oblast would reject the correct suggestion on another platform.
          if (part.asText().equals("region")
              && placeName(context).equals(placeName(text(card.path("address"), "settlement"))))
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
      result
          .path("values")
          .fieldNames()
          .forEachRemaining(
              id -> {
                if (!supported.contains(id) && !snapshot.plan(platform).path("constants").has(id))
                  unsupported.add(fields.containsKey(id) ? text(fields.get(id), "name") : id);
              });
      recipe.set("controls", controls);
      recipe.set("unbound", unsupported);
      jobs.add(recipe);
    }
    return object("format", 1, "schemaVersion", snapshot.version(), "jobs", jobs);
  }

  private String placeName(String value) {
    return value
        .toLowerCase(java.util.Locale.ROOT)
        .replaceAll("\\s+", " ")
        .trim()
        .replaceFirst("^(?:г\\.?|город)\\s+", "");
  }
}
