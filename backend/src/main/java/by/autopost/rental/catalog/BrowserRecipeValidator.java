package by.autopost.rental.catalog;

import static by.autopost.shared.Json.*;

import by.autopost.rental.model.SchemaFields;
import by.autopost.shared.ApiException;
import com.fasterxml.jackson.databind.JsonNode;
import java.util.*;

/**
 * A data-only browser contract; code and arbitrary navigation are never part of a recipe. Every
 * object lists the keys the server or the extension reads, so a misspelt key fails here and not
 * on a live form.
 */
public final class BrowserRecipeValidator {
  private static final Set<String> RECIPE =
      Set.of("format", "platform", "startUrl", "ready", "controls", "setup", "next", "submit");
  private static final Set<String> READY = Set.of("selector", "text", "absent");
  private static final Set<String> CONTROL =
      Set.of("field", "action", "selector", "index", "after");

  /** Extra keys of each action, as rental-form.js uses them. */
  private static final Map<String, Set<String>> ACTIONS =
      Map.of(
          "text", Set.of("addressPart"),
          "autocomplete", Set.of("addressPart", "autocomplete"),
          "richtext", Set.of(),
          "check", Set.of(),
          "select", Set.of(),
          "files", Set.of(),
          "choices", Set.of("label", "selectedClass", "displaySelector", "uiLabels"),
          "dropdown",
              Set.of(
                  "label",
                  "selectedClass",
                  "displaySelector",
                  "uiLabels",
                  "optionsSelector",
                  "triggerSelector"));

  private static final Set<String> AUTOCOMPLETE =
      Set.of(
          "kind",
          "scopeSelector",
          "optionSelector",
          "labelSelector",
          "busySelector",
          "contextSelector",
          "contextParts",
          "confirm");

  /** Setup and next steps go through Form.clickStep; submit only through its selector and text. */
  private static final Set<String> STEP =
      Set.of("action", "selector", "text", "index", "stepSelector", "matchText", "selectedClass");

  private static final Set<String> SUBMIT = Set.of("action", "selector", "text", "index");

  public void validate(String platform, JsonNode schema, JsonNode recipe) {
    keys(recipe, "рецепт", RECIPE);
    check(
        recipe.path("format").asInt() == 1 && platform.equals(text(recipe, "platform")),
        "версия browser");
    java.net.URI uri;
    try {
      uri = java.net.URI.create(text(recipe, "startUrl"));
    } catch (IllegalArgumentException e) {
      throw new ApiException(409, "Некорректный адрес формы.");
    }
    check(
        "https".equals(uri.getScheme())
            && uri.getHost() != null
            && uri.getUserInfo() == null
            && uri.getPort() == -1
            && uri.getFragment() == null,
        "адрес запуска browser");
    var fields = SchemaFields.fields(schema);
    check(
        recipe.path("ready").isArray()
            && !recipe.path("ready").isEmpty()
            && recipe.path("ready").size() <= 10,
        "признаки категории browser");
    for (var guard : recipe.path("ready")) {
      keys(guard, "признак категории", READY);
      selector(guard);
      if (guard.has("text")) label(guard.path("text"), "текст признака категории");
      if (guard.has("absent")) check(guard.path("absent").isBoolean(), "absent — да или нет");
    }
    Set<String> seen = new HashSet<>();
    check(recipe.path("controls").isArray() && recipe.path("controls").size() <= 150, "controls");
    for (var control : recipe.path("controls")) {
      String id = text(control, "field"), action = text(control, "action");
      check(fields.containsKey(id) && seen.add(id), "поле browser: " + id);
      check(ACTIONS.containsKey(action), "действие browser");
      var allowed = new HashSet<>(CONTROL);
      allowed.addAll(ACTIONS.get(action));
      keys(control, "поле " + id, allowed);
      selector(control);
      for (String key : List.of("displaySelector", "optionsSelector", "triggerSelector"))
        if (control.has(key)) selectorValue(text(control, key));
      if (control.has("label")) label(control.path("label"), "подпись группы " + id);
      if (control.has("selectedClass")) selectedClass(control.path("selectedClass"));
      if (control.has("uiLabels")) {
        var labels = control.path("uiLabels");
        check(labels.isObject() && labels.size() <= 100, "uiLabels " + id);
        for (var text : labels) label(text, "uiLabels " + id);
      }
      if (control.has("autocomplete")) {
        var config = control.path("autocomplete");
        keys(config, "autocomplete " + id, AUTOCOMPLETE);
        check(Set.of("settlement", "street").contains(text(config, "kind")), "тип autocomplete");
        check(text(config, "confirm").equals("value-and-closed"), "подтверждение autocomplete");
        for (String key : List.of("scopeSelector", "optionSelector"))
          selectorValue(text(config, key));
        for (String key : List.of("labelSelector", "busySelector", "contextSelector"))
          if (config.has(key)) selectorValue(text(config, key));
        if (config.has("contextParts")) {
          check(
              config.path("contextParts").isArray() && config.path("contextParts").size() <= 2,
              "контекст autocomplete");
          for (var part : config.path("contextParts"))
            check(
                Set.of("region", "district").contains(part.asText()),
                "часть контекста autocomplete");
          if (!config.path("contextParts").isEmpty())
            selectorValue(text(config, "contextSelector"));
        }
      }
      if (control.has("addressPart"))
        check(
            Set.of("label", "settlement", "street", "house", "block")
                .contains(text(control, "addressPart")),
            "часть адреса browser");
      if (control.has("after"))
        check(
            fields.containsKey(text(control, "after")) && !id.equals(text(control, "after")),
            "зависимость browser");
    }
    for (String phase : List.of("setup", "next", "submit")) {
      check(recipe.path(phase).isArray() && recipe.path(phase).size() <= 10, "шаги browser");
      for (var step : recipe.path(phase)) {
        keys(step, "шаг " + phase, phase.equals("submit") ? SUBMIT : STEP);
        selector(step);
        check(
            text(step, "action").equals("click") && !text(step, "text").isBlank(),
            "переход browser");
        if (step.has("stepSelector")) selectorValue(text(step, "stepSelector"));
        if (step.has("matchText"))
          check(step.path("matchText").isBoolean(), "matchText — да или нет");
        if (step.has("selectedClass")) selectedClass(step.path("selectedClass"));
      }
    }
  }

  private void selector(JsonNode row) {
    selectorValue(text(row, "selector"));
    check(
        !row.has("index")
            || row.path("index").isInt()
                && row.path("index").asInt() >= 0
                && row.path("index").asInt() < 20,
        "index browser");
  }

  private void selectorValue(String value) {
    check(!value.isBlank() && value.length() <= 400, "селектор browser");
  }

  private void label(JsonNode value, String what) {
    check(
        value.isTextual() && !value.asText().isBlank() && value.asText().length() <= 200, what);
  }

  /** The same class fragment rule as the extension (rental-core.js). */
  private void selectedClass(JsonNode value) {
    check(value.isTextual() && value.asText().matches("[a-zA-Z0-9_-]{1,80}"), "selectedClass");
  }

  private void keys(JsonNode value, String where, Set<String> allowed) {
    check(value.isObject(), where + " должно быть объектом");
    for (var key = value.fieldNames(); key.hasNext(); ) {
      String name = key.next();
      check(allowed.contains(name), where + ": неизвестный ключ " + name);
    }
  }

  private void check(boolean valid, String message) {
    if (!valid) throw new ApiException(409, "Некорректные правила браузера: " + message);
  }
}
