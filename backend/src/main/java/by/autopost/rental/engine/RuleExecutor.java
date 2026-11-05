package by.autopost.rental.engine;

import by.autopost.rental.model.Conversion;
import by.autopost.rental.model.FieldDef;
import by.autopost.rental.model.MappingRule;
import by.autopost.rental.model.Value;
import by.autopost.shared.ApiException;
import java.math.BigDecimal;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Set;

/** Runs the conversion of one plan row, after the rows it requires. */
final class RuleExecutor {
  private final Map<String, MappingRule> rules;
  private final Map<String, FieldDef> fields;
  private final Map<String, Value> card;
  private final Map<String, Value> values;
  private final Issues issues;
  private final Set<String> visiting = new java.util.HashSet<>(), done = new java.util.HashSet<>();

  RuleExecutor(
      Map<String, MappingRule> rules,
      Map<String, FieldDef> fields,
      Map<String, Value> card,
      Map<String, Value> values,
      Issues issues) {
    this.rules = rules;
    this.fields = fields;
    this.card = card;
    this.values = values;
    this.issues = issues;
  }

  static Value lookup(List<Conversion.ValuePair> pairs, Value input) {
    for (var pair : pairs) if (pair.from().same(input)) return pair.to();
    throw new IllegalArgumentException(
        "У площадки нет точного соответствия этому значению. Уточните его отдельно.");
  }

  void apply(String target) {
    if (done.contains(target)) return;
    if (!visiting.add(target))
      throw new ApiException(409, "Цикл зависимостей в правилах подготовки.");
    MappingRule row = rules.get(target);
    FieldDef field = fields.get(target);
    if (field == null) throw new ApiException(409, "Правила не соответствуют версии справочника.");
    var cv = row.conversion();
    for (String dependency : cv.requires()) if (rules.containsKey(dependency)) apply(dependency);
    boolean dependencies =
        cv.requires().stream().allMatch(d -> !Value.missing(values.get(d)) && !issues.has(d));
    Value input = card.get(row.commonOptionId());
    try {
      if (cv instanceof Conversion.MultiLookup list) {
        List<Value> merged = new ArrayList<>();
        Value prior = values.get(target);
        if (!Value.missing(prior) && !(prior instanceof Value.Items))
          throw new IllegalArgumentException("Выберите несколько значений из списка площадки.");
        if (prior instanceof Value.Items items) merged.addAll(items.items());
        boolean supplied = !Value.missing(prior);
        for (var member : list.members()) {
          Value v = card.get(member.commonOptionId());
          if (Value.missing(v)) continue;
          supplied = true;
          try {
            Value code = lookup(member.values(), v);
            if (code != Value.Null.NULL && merged.stream().noneMatch(code::same)) merged.add(code);
          } catch (IllegalArgumentException e) {
            issues.add(target, "list_value", e.getMessage());
          }
        }
        if (supplied) values.put(target, new Value.Items(merged));
      } else if (!Value.missing(input)) {
        if (!dependencies)
          throw new IllegalArgumentException(
              "Сначала уточните связанные поля, например валюту суммы.");
        Value output = convert(cv, input, target);
        if (values.containsKey(target) && !values.get(target).same(output))
          issues.add(
              target,
              "conflict",
              "Общее поле и уточнение площадки противоречат друг другу. Выберите верное значение.");
        else values.put(target, output);
      }
    } catch (IllegalArgumentException e) {
      issues.add(target, "conversion", field.name() + ": " + e.getMessage());
    }
    visiting.remove(target);
    done.add(target);
  }

  private Value convert(Conversion cv, Value input, String target) {
    if (cv instanceof Conversion.Identity) return input;
    if (cv instanceof Conversion.ListLookup list) {
      if (!(input instanceof Value.Items items))
        throw new IllegalArgumentException("Выберите варианты из списка.");
      List<Value> mapped = new ArrayList<>();
      for (var item : items.items()) mapped.add(lookup(list.values(), item));
      return new Value.Items(mapped);
    }
    if (cv instanceof Conversion.Lookup lookup) return lookup(lookup.values(), input);
    if (cv instanceof Conversion.Decimal decimal) {
      boolean integer = decimal.target() == Conversion.NumberTarget.INTEGER;
      BigDecimal n = Numbers.decimal(input, integer);
      Value currency = values.get(decimal.currencyField());
      if (currency != null
          && decimal.integerCurrencies().contains(currency.text())
          && n.scale() > 0)
        throw new IllegalArgumentException(
            "В выбранной валюте площадка изменяет дробную цену; укажите целую сумму.");
      return integer ? Value.integer(n.toBigIntegerExact()) : Value.decimal(n);
    }
    if (cv instanceof Conversion.Phone phone)
      return Value.text(Numbers.phone(input, phone.format().name()));
    if (cv instanceof Conversion.PlainTextHtml) {
      if (!(input instanceof Value.Text text))
        throw new IllegalArgumentException("Нужно текстовое описание.");
      String escaped =
          text.value()
              .replace("&", "&amp;")
              .replace("<", "&lt;")
              .replace(">", "&gt;")
              .replace("\"", "&quot;")
              .replace("'", "&#39;");
      return Value.text(
          "<p>"
              + escaped.replace("\r\n", "\n").replace("\r", "\n").replace("\n", "<br>")
              + "</p>");
    }
    if (cv instanceof Conversion.Files) {
      if (!(input instanceof Value.Items items))
        throw new IllegalArgumentException("Вложения должны быть списком ссылок на оригиналы.");
      for (var url : items.items())
        if (!(url instanceof Value.Text link) || !link.value().matches("https://[^\\s]+"))
          throw new IllegalArgumentException("Нужны ссылки HTTPS на исходные вложения.");
      issues.add(
          target,
          "file_acceptance",
          "Нужно проверить параметры оригиналов и принятие файлов площадкой; порядок и файлы"
              + " сохранены.");
      return input;
    }
    throw new IllegalArgumentException("Этот обработчик ещё не поддерживается.");
  }
}
