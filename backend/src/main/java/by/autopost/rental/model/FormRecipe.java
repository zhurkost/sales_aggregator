package by.autopost.rental.model;

import com.fasterxml.jackson.annotation.JsonInclude;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * How the extension fills one platform's form ({@code runtime/browser_<id>.json}): its address,
 * the signs that the right category is open, the controls of the native fields and the steps.
 * Data only: no code and no arbitrary navigation. Absent keys stay absent when the recipe goes to
 * the extension.
 */
@JsonInclude(JsonInclude.Include.NON_NULL)
public record FormRecipe(
    Integer format,
    String platform,
    String startUrl,
    List<ReadyGuard> ready,
    List<FormControl> controls,
    List<Step> setup,
    List<Step> next,
    List<Step> submit) {
  public FormRecipe {
    ready = copy(ready);
    controls = copy(controls);
    setup = copy(setup);
    next = copy(next);
    submit = copy(submit);
  }

  private static <T> List<T> copy(List<T> list) {
    return list == null ? null : List.copyOf(list);
  }

  /** The controls, an empty list when the recipe has none. */
  public List<FormControl> controlList() {
    return controls == null ? List.of() : controls;
  }

  /** A sign that the form of the right category is open: an element, its text or its absence. */
  @JsonInclude(JsonInclude.Include.NON_NULL)
  public record ReadyGuard(String selector, String text, Boolean absent) {}

  /**
   * One native field on the form. Which of the optional keys an action reads is checked by the
   * catalog: {@code addressPart} — text and autocomplete; {@code label}, {@code selectedClass},
   * {@code displaySelector}, {@code uiLabels} — choices and dropdown; {@code optionsSelector},
   * {@code triggerSelector} — dropdown.
   */
  @JsonInclude(JsonInclude.Include.NON_NULL)
  public record FormControl(
      String field,
      String action,
      String selector,
      Integer index,
      String after,
      String addressPart,
      Autocomplete autocomplete,
      String label,
      String selectedClass,
      String displaySelector,
      Map<String, String> uiLabels,
      String optionsSelector,
      String triggerSelector) {
    public FormControl {
      field = field == null ? "" : field;
      action = action == null ? "" : action;
      uiLabels = uiLabels == null ? null : Collections.unmodifiableMap(new LinkedHashMap<>(uiLabels));
    }
  }

  /** Address suggestions of a form: where they appear, how one is confirmed. */
  @JsonInclude(JsonInclude.Include.NON_NULL)
  public record Autocomplete(
      String kind,
      String scopeSelector,
      String optionSelector,
      String labelSelector,
      String busySelector,
      String contextSelector,
      List<String> contextParts,
      String confirm) {
    public Autocomplete {
      contextParts = contextParts == null ? null : List.copyOf(contextParts);
    }
  }

  /** A click of a setup, next or submit step. */
  @JsonInclude(JsonInclude.Include.NON_NULL)
  public record Step(
      String action,
      String selector,
      String text,
      Integer index,
      String stepSelector,
      Boolean matchText,
      String selectedClass) {}
}
