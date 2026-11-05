package by.autopost.rental.catalog;

import by.autopost.rental.model.FormRecipe;
import by.autopost.rental.model.FormRecipe.FormControl;
import by.autopost.rental.model.FormRecipe.Step;
import by.autopost.rental.model.Schema;
import by.autopost.shared.ApiException;
import java.util.*;

/**
 * A data-only browser contract; code and arbitrary navigation are never part of a recipe. The
 * records list the keys the extension reads, so a misspelt key fails when the recipe is parsed and
 * not on a live form; here each action and step is held to the keys it reads.
 */
public final class BrowserRecipeValidator {
  /** Optional keys of each action, as rental-form.js uses them. */
  private static final Map<String, Set<String>> ACTIONS =
      Map.of(
          "text", Set.of("addressPart"),
          "autocomplete", Set.of("addressPart", "autocomplete"),
          "richtext", Set.of(),
          // The selector finds a same-origin iframe; its body is the editor (TinyMCE).
          "iframe_richtext", Set.of(),
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

  public void validate(String platform, Schema schema, FormRecipe recipe) {
    check(
        recipe.format() != null && recipe.format() == 1 && platform.equals(recipe.platform()),
        "версия browser");
    java.net.URI uri;
    try {
      uri = java.net.URI.create(recipe.startUrl() == null ? "" : recipe.startUrl());
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
    var fields = schema.fields();
    check(
        recipe.ready() != null && !recipe.ready().isEmpty() && recipe.ready().size() <= 10,
        "признаки категории browser");
    for (var guard : recipe.ready()) {
      check(guard != null, "признак категории должно быть объектом");
      selector(guard.selector(), null);
      if (guard.text() != null) label(guard.text(), "текст признака категории");
    }
    Set<String> seen = new HashSet<>();
    check(recipe.controls() != null && recipe.controls().size() <= 150, "controls");
    for (var control : recipe.controls()) {
      check(control != null, "поле browser должно быть объектом");
      String id = control.field(), action = control.action();
      check(fields.containsKey(id) && seen.add(id), "поле browser: " + id);
      check(ACTIONS.containsKey(action), "действие browser");
      for (var key : optional(control).entrySet())
        check(
            key.getValue() == null || ACTIONS.get(action).contains(key.getKey()),
            "поле " + id + ": неизвестный ключ " + key.getKey());
      selector(control.selector(), control.index());
      for (String value :
          Arrays.asList(
              control.displaySelector(), control.optionsSelector(), control.triggerSelector()))
        if (value != null) selectorValue(value);
      if (control.label() != null) label(control.label(), "подпись группы " + id);
      if (control.selectedClass() != null) selectedClass(control.selectedClass());
      if (control.uiLabels() != null) {
        check(control.uiLabels().size() <= 100, "uiLabels " + id);
        for (var text : control.uiLabels().values()) label(text, "uiLabels " + id);
      }
      if (control.autocomplete() != null) {
        var config = control.autocomplete();
        check(
            Set.of("settlement", "street").contains(String.valueOf(config.kind())),
            "тип autocomplete");
        check("value-and-closed".equals(config.confirm()), "подтверждение autocomplete");
        selectorValue(config.scopeSelector());
        selectorValue(config.optionSelector());
        for (String value :
            Arrays.asList(config.labelSelector(), config.busySelector(), config.contextSelector()))
          if (value != null) selectorValue(value);
        if (config.contextParts() != null) {
          check(config.contextParts().size() <= 2, "контекст autocomplete");
          for (var part : config.contextParts())
            check(Set.of("region", "district").contains(part), "часть контекста autocomplete");
          if (!config.contextParts().isEmpty()) selectorValue(config.contextSelector());
        }
      }
      if (control.addressPart() != null)
        check(
            Set.of("label", "settlement", "street", "house", "block")
                .contains(control.addressPart()),
            "часть адреса browser");
      if (control.after() != null)
        check(
            fields.containsKey(control.after()) && !id.equals(control.after()),
            "зависимость browser");
    }
    steps("setup", recipe.setup());
    steps("next", recipe.next());
    steps("submit", recipe.submit());
  }

  /** The keys of a control that only some actions read, with their values. */
  private static Map<String, Object> optional(FormControl control) {
    Map<String, Object> keys = new LinkedHashMap<>();
    keys.put("addressPart", control.addressPart());
    keys.put("autocomplete", control.autocomplete());
    keys.put("label", control.label());
    keys.put("selectedClass", control.selectedClass());
    keys.put("displaySelector", control.displaySelector());
    keys.put("uiLabels", control.uiLabels());
    keys.put("optionsSelector", control.optionsSelector());
    keys.put("triggerSelector", control.triggerSelector());
    return keys;
  }

  /** Setup and next steps go through Form.clickStep; submit only through its selector and text. */
  private void steps(String phase, List<Step> steps) {
    check(steps != null && steps.size() <= 10, "шаги browser");
    for (var step : steps) {
      check(step != null, "шаг " + phase + " должно быть объектом");
      if (phase.equals("submit")) {
        check(step.stepSelector() == null, "шаг submit: неизвестный ключ stepSelector");
        check(step.matchText() == null, "шаг submit: неизвестный ключ matchText");
        check(step.selectedClass() == null, "шаг submit: неизвестный ключ selectedClass");
      }
      selector(step.selector(), step.index());
      check(
          "click".equals(step.action()) && step.text() != null && !step.text().isBlank(),
          "переход browser");
      if (step.stepSelector() != null) selectorValue(step.stepSelector());
      if (step.selectedClass() != null) selectedClass(step.selectedClass());
    }
  }

  private void selector(String selector, Integer index) {
    selectorValue(selector);
    check(index == null || index >= 0 && index < 20, "index browser");
  }

  private void selectorValue(String value) {
    check(value != null && !value.isBlank() && value.length() <= 400, "селектор browser");
  }

  private void label(String value, String what) {
    check(!value.isBlank() && value.length() <= 200, what);
  }

  /** The same class fragment rule as the extension (rental-core.js). */
  private void selectedClass(String value) {
    check(value.matches("[a-zA-Z0-9_-]{1,80}"), "selectedClass");
  }

  private void check(boolean valid, String message) {
    if (!valid) throw new ApiException(409, "Некорректные правила браузера: " + message);
  }
}
