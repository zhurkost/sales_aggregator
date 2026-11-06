package by.autopost.rental.preparation;

import static by.autopost.rental.model.SchemaFields.*;
import static by.autopost.rental.model.Values.*;
import static by.autopost.rental.preparation.PreparationIssues.*;
import static by.autopost.shared.Json.*;

import by.autopost.shared.ApiException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.BigIntegerNode;
import com.fasterxml.jackson.databind.node.DecimalNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.fasterxml.jackson.databind.node.TextNode;
import java.math.BigDecimal;
import java.util.Map;
import java.util.Set;

public final class RuleExecutor {
  public static JsonNode lookup(JsonNode pairs, JsonNode input) {
    for (var p : pairs) if (equal(p.path("from"), input)) return p.path("to").deepCopy();
    throw new IllegalArgumentException(
        "У площадки нет точного соответствия этому значению. Уточните его отдельно.");
  }

  public void apply(
      String target,
      Map<String, JsonNode> rules,
      Map<String, JsonNode> fields,
      ObjectNode common,
      ObjectNode values,
      ArrayNode issues,
      Set<String> visiting,
      Set<String> done) {
    if (done.contains(target)) return;
    if (!visiting.add(target))
      throw new ApiException(409, "Цикл зависимостей в правилах подготовки.");
    JsonNode row = rules.get(target), field = fields.get(target);
    if (field == null) throw new ApiException(409, "Правила не соответствуют версии справочника.");
    var cv = row.path("conversion");
    for (var dep : cv.path("requires"))
      if (rules.containsKey(dep.asText()))
        apply(dep.asText(), rules, fields, common, values, issues, visiting, done);
    boolean dependencies =
        list(cv.path("requires")).stream()
            .allMatch(
                d ->
                    !missing(values.get(d.asText()))
                        && list(issues).stream()
                            .noneMatch(i -> text(i, "field").equals(d.asText())));
    String cid = text(row, "common_option_id");
    JsonNode input = common.path(cid);
    try {
      String kind = text(cv, "kind");
      if (kind.equals("multi_lookup")) {
        ArrayNode merged = array();
        JsonNode prior = values.path(target);
        if (!missing(prior) && !prior.isArray())
          throw new IllegalArgumentException("Выберите несколько значений из списка площадки.");
        if (prior.isArray()) prior.forEach(v -> merged.add(v.deepCopy()));
        boolean supplied = !missing(prior);
        for (var member : cv.path("members")) {
          JsonNode v = common.path(text(member, "common_option_id"));
          if (member.has("unless_supplied") && !missing(common.path(text(member, "unless_supplied")))) continue;
          if (missing(v)) continue;
          supplied = true;
          try {
            JsonNode code = lookup(member.path("values"), v);
            if (!code.isNull() && list(merged).stream().noneMatch(x -> equal(x, code)))
              merged.add(code);
          } catch (IllegalArgumentException e) {
            issue(issues, target, "list_value", e.getMessage());
          }
        }
        if (supplied) values.set(target, merged);
      } else if (!missing(input)) {
        if (!dependencies)
          throw new IllegalArgumentException(
              "Сначала уточните связанные поля, например валюту суммы.");
        JsonNode output;
        switch (kind) {
          case "identity" -> output = input.deepCopy();
          case "list_lookup" -> {
            if (!input.isArray())
              throw new IllegalArgumentException("Выберите варианты из списка.");
            ArrayNode mapped = array();
            for (var item : input) mapped.add(lookup(cv.path("values"), item));
            output = mapped;
          }
          case "lookup" -> output = lookup(cv.path("values"), input);
          case "decimal" -> {
            BigDecimal n = decimal(input, text(cv, "target").equals("integer"));
            String currency = values.path(text(cv, "currency_field")).asText();
            if (has(cv.path("integer_currencies"), currency) && n.scale() > 0)
              throw new IllegalArgumentException(
                  "В выбранной валюте площадка изменяет дробную цену; укажите целую сумму.");
            output =
                text(cv, "target").equals("integer")
                    ? BigIntegerNode.valueOf(n.toBigIntegerExact())
                    : DecimalNode.valueOf(n);
          }
          case "phone" -> output = TextNode.valueOf(phone(input, text(cv, "format")));
          case "plain_text_html" -> {
            if (!input.isTextual()) throw new IllegalArgumentException("Нужно текстовое описание.");
            String text =
                input
                    .asText()
                    .replace("&", "&amp;")
                    .replace("<", "&lt;")
                    .replace(">", "&gt;")
                    .replace("\"", "&quot;")
                    .replace("'", "&#39;");
            output =
                TextNode.valueOf(
                    "<p>"
                        + text.replace("\r\n", "\n").replace("\r", "\n").replace("\n", "<br>")
                        + "</p>");
          }
          case "files" -> {
            if (!input.isArray())
              throw new IllegalArgumentException(
                  "Вложения должны быть списком ссылок на оригиналы.");
            for (var url : input)
              if (!url.isTextual() || !url.asText().matches("https://[^\\s]+"))
                throw new IllegalArgumentException("Нужны ссылки HTTPS на исходные вложения.");
            output = input.deepCopy();
            issue(
                issues,
                target,
                "file_acceptance",
                "Нужно проверить параметры оригиналов и принятие файлов площадкой; порядок и файлы"
                    + " сохранены.");
          }
          default -> throw new IllegalArgumentException("Этот обработчик ещё не поддерживается.");
        }
        if (values.has(target) && !equal(values.get(target), output))
          issue(
              issues,
              target,
              "conflict",
              "Общее поле и уточнение площадки противоречат друг другу. Выберите верное значение.");
        else values.set(target, output);
      }
    } catch (IllegalArgumentException e) {
      issue(issues, target, "conversion", text(field, "name") + ": " + e.getMessage());
    }
    visiting.remove(target);
    done.add(target);
  }
}
