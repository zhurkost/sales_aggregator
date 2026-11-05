package by.autopost.rental.engine;

import by.autopost.rental.model.Address;
import by.autopost.rental.model.Card;
import by.autopost.rental.model.CardFields;
import by.autopost.rental.model.CardModel;
import by.autopost.rental.model.Conversion;
import by.autopost.rental.model.Mapping;
import by.autopost.rental.model.MappingRule;
import by.autopost.rental.model.Value;
import java.util.ArrayList;
import java.util.Collections;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

/** What the card itself adds to the preparation of every platform. */
public final class CardChecks {
  private CardChecks() {}

  /**
   * The card values preparation reads: the stored values, with the values derived from the address
   * taken only from the address object, so stale projected values never reach preparation.
   */
  public static Map<String, Value> values(Card card, CardModel model) {
    Map<String, Value> values = new LinkedHashMap<>(card.values());
    model.addressProjection().keySet().forEach(values::remove);
    Address address = card.address();
    model
        .addressProjection()
        .forEach(
            (field, part) -> {
              if ((part.equals("latitude") || part.equals("longitude")) && !address.exactPoint())
                return;
              String value = address.part(part);
              if (!value.isBlank()) values.put(field, Value.text(value));
            });
    return Collections.unmodifiableMap(values);
  }

  /**
   * The remarks of one platform as the editor shows them: each names the part of the card to
   * correct ({@code source}), address and deferred fields explain themselves, and the card's own
   * checks (floor, earlier values) come on every platform.
   */
  public static List<Issue> annotate(List<Issue> prepared, Mapping plan, Card card) {
    Map<String, MappingRule> rules = new HashMap<>();
    for (var row : plan.fields()) rules.put(row.platformOptionId(), row);
    Set<String> address = new HashSet<>(plan.addressBoundFields());
    List<Issue> issues = new ArrayList<>();
    for (var issue : prepared) {
      String field = issue.field();
      var rule = rules.get(field);
      if (issue.source() == null)
        issue =
            issue.withSource(
                address.contains(field)
                    ? "address"
                    : rule == null ? "" : rule.sources().stream().findFirst().orElse(""));
      if (issue.code().equals("required")
          && rule != null
          && rule.conversion() instanceof Conversion.MultiLookup)
        issue =
            new Issue(
                field,
                rule.editorGroup(),
                "required_list",
                "Площадке нужен хотя бы один подходящий вариант в разделе «"
                    + rule.editorGroupName()
                    + "».");
      if (address.contains(field))
        issue =
            issue.withMessage(
                card.address().label().isBlank()
                    ? "Укажите адрес квартиры в едином блоке адреса."
                    : "Адрес сохранён один раз. Его сопоставление со справочником этой площадки"
                        + " пока требует проверки на площадке.");
      else if (plan.deferredFields().containsKey(field))
        issue = issue.withMessage(plan.deferredFields().get(field));
      issues.add(issue);
    }
    // Cross-field facts must be valid even if only one marketplace is selected.
    try {
      var floor = card.value(CardFields.FLOOR);
      var floors = card.value(CardFields.TOTAL_FLOORS);
      if (!Value.missing(floor)
          && !Value.missing(floors)
          && Numbers.decimal(floor, true).compareTo(Numbers.decimal(floors, true)) > 0)
        issues.add(
            new Issue(
                CardFields.FLOOR,
                CardFields.FLOOR,
                "floor",
                "Этаж квартиры не может быть выше этажности дома."));
    } catch (IllegalArgumentException ignored) {
      /* Each platform validates its own numeric/enum domain. */
    }
    for (var legacy : card.legacy())
      if (legacy.platform().isBlank() || legacy.platform().equals(plan.platform()))
        issues.add(
            new Issue(
                legacy.field(),
                "legacy",
                "legacy",
                "Сверьте сохранённые сведения из прежней карточки."));
    return issues;
  }
}
