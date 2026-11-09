package by.autopost.rental.application;

import by.autopost.address.application.AddressText;

import static by.autopost.shared.Json.*;

import by.autopost.rental.catalog.ReferenceSnapshot;
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
      // Resolve category choices on the server; the extension receives only fixed UI steps.
      for (String phase : java.util.List.of("setup", "ready")) {
        for (var step : recipe.path(phase)) {
          String id = text(step, "valueField");
          if (id.isBlank()) continue;
          String selectedText = text(step.path("textByValue"), text(result.path("values"), id));
          if (selectedText.isBlank())
            throw new by.autopost.shared.ApiException(400, "Для запуска на " + platform + " выберите «" + text(fields.get(id), "name") + "».");
          ((ObjectNode) step).put("text", selectedText);
          ((ObjectNode) step).remove(java.util.List.of("valueField", "textByValue"));
          supported.add(id);
        }
      }
      for (var source : recipe.path("controls")) {
        String id = text(source, "field");
        supported.add(id);
        JsonNode value = result.path("values").get(id);
        var age = source.path("maxBuildingAge");
        if (value != null && value.asBoolean(false) && age.isObject()) {
          int year = result.path("values").path(text(age, "field")).asInt(0);
          if (year < java.time.Year.now(java.time.ZoneId.of("Europe/Minsk")).getValue() - age.path("years").asInt()) {
            unsupported.add(text(fields.get(id), "name") + ": проверьте год постройки (не старше " + age.path("years").asInt() + " лет)");
            continue;
          }
        }
        boolean emptyChoice = SchemaFields.isEmptyChoice(fields.get(id), value);
        if (source.has("addressPart")) {
          value = card.path("address").get(text(source, "addressPart"));
          if (value != null && value.isTextual())
            value = com.fasterxml.jackson.databind.node.TextNode.valueOf(
                text(source, "addressPart").equals("label")
                    ? AddressText.searchText(card.path("address"))
                    : text(source, "addressPart").equals("settlement") &&
                        text(source.path("autocomplete"), "kind").equals("address")
                    ? AddressText.searchText(object("label", value.asText()))
                    : AddressText.cleanComponent(value.asText(), text(source, "addressPart")));
        }
        if (!text(source, "action").equals("files")
            && (value == null
                || value.isNull()
                || value.isTextual() && value.asText().isBlank() && !emptyChoice
                || value.isArray() && value.isEmpty() && !source.path("replaceGroup").asBoolean())) continue;
        ObjectNode control = source.deepCopy();
        if (emptyChoice) control.put("emptyChoice", true);
        control.set("value", value == null ? array() : value.deepCopy());
        if (source.has("addressPart")) {
          String part = text(source, "addressPart");
          String current = text(card.path("address"), part);
          String original = text(card.path("address"), part + "WithType");
          if (original.isBlank() || !AddressText.cleanComponent(current, part).equals(current))
            original = current;
          boolean sameAddress = value != null && (part.equals("label")
              ? AddressText.searchText(object("label", original)).equals(value.asText())
              : AddressText.cleanComponent(original, part).equals(value.asText()));
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
      var constants = snapshot.plan(platform).path("constants");
      result
          .path("values")
          .fieldNames()
          .forEachRemaining(
              id -> {
                if (!supported.contains(id) && !constants.has(id))
                  unsupported.add(fields.containsKey(id) ? text(fields.get(id), "name") : id);
              });
      // Conversion can omit a supplied value entirely. Keep its explanation in
      // the browser report instead of claiming that every value was transferred.
      for (var issue : result.path("issues")) {
        String code = text(issue, "code");
        if (java.util.Set.of("required", "file_acceptance", "adapter_review").contains(code)) continue;
        // Address selection is confirmed by the live control; a static preparation
        // advisory must not remain after that control successfully completes.
        if (text(issue, "source").equals("address") && list(controls).stream().anyMatch(c ->
            c.has("addressPart") && text(c, "field").equals(text(issue, "field")))) continue;
        if (code.equals("condition")) {
          String source = text(issue, "source");
          if (!card.path("values").hasNonNull(source)) continue;
        }
        String message = text(issue, "message");
        if (!message.isBlank() && list(unsupported).stream().noneMatch(v -> v.asText().equals(message)))
          unsupported.add(message);
      }
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
