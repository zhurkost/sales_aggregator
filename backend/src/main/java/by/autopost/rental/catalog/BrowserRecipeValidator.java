package by.autopost.rental.catalog;

import static by.autopost.shared.Json.*;

import by.autopost.rental.model.SchemaFields;
import by.autopost.shared.ApiException;
import com.fasterxml.jackson.databind.JsonNode;
import java.util.*;

/** A data-only browser contract; code and arbitrary navigation are never part of a recipe. */
public final class BrowserRecipeValidator {
  public void validate(String platform, JsonNode schema, JsonNode recipe) {
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
    for (var guard : recipe.path("ready")) selector(guard);
    Set<String> seen = new HashSet<>();
    check(recipe.path("controls").isArray() && recipe.path("controls").size() <= 150, "controls");
    for (var control : recipe.path("controls")) {
      String id = text(control, "field");
      check(fields.containsKey(id) && seen.add(id), "поле browser: " + id);
      check(
          Set.of(
                  "text",
                  "richtext",
                  "check",
                  "choices",
                  "select",
                  "dropdown",
                  "autocomplete",
                  "files")
              .contains(text(control, "action")),
          "действие browser");
      selector(control);
      if (control.has("uploadedCountSelector")) {
        check(text(control, "action").equals("files"), "счётчик фотографий");
        selectorValue(text(control, "uploadedCountSelector"));
      }
      if (control.has("triggerEvent"))
        check(text(control, "action").equals("dropdown") &&
            text(control, "triggerEvent").equals("mousedown"), "событие dropdown");
      if (control.has("blockedSelector")) {
        selectorValue(text(control, "blockedSelector"));
        check(!text(control, "blockedMessage").isBlank() && text(control, "blockedMessage").length() <= 400,
            "сообщение блокировки browser");
      }
      if (control.has("autocomplete")) {
        var config = control.path("autocomplete");
        check(text(control, "action").equals("autocomplete") && config.isObject(), "autocomplete");
        check(Set.of("settlement", "street", "house", "address").contains(text(config, "kind")), "тип autocomplete");
        if (config.has("selection"))
          check(text(config, "selection").equals("type-then-first") ||
              (text(config, "kind").equals("address") && text(config, "selection").equals("single-or-exact")),
              "выбор подсказки autocomplete");
        if (config.has("queryEvent"))
          check(text(config, "queryEvent").equals("keyup"), "событие поиска autocomplete");
        check(Set.of("value-and-closed", "display-and-closed").contains(text(config, "confirm")), "подтверждение autocomplete");
        if (text(config, "confirm").equals("display-and-closed"))
          selectorValue(text(config, "selectedValueSelector"));
        if (config.has("labelFormat"))
          check(text(config, "kind").equals("settlement") &&
              text(config, "labelFormat").equals("settlement-region-district"), "формат autocomplete");
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
          if (!config.path("contextParts").isEmpty() && !config.has("labelFormat"))
            selectorValue(text(config, "contextSelector"));
        }
        check(!config.has("code") && !config.has("script"), "исполняемый код autocomplete");
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
        selector(step);
        check(
            text(step, "action").equals("click") && !text(step, "text").isBlank(),
            "переход browser");
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
    check(!row.has("code") && !row.has("script") && !row.has("url"), "исполняемый код browser");
  }

  private void selectorValue(String value) {
    check(!value.isBlank() && value.length() <= 400, "селектор browser");
  }

  private void check(boolean valid, String message) {
    if (!valid) throw new ApiException(409, "Некорректные правила браузера: " + message);
  }
}
