package by.autopost.rental.preparation;

import static by.autopost.rental.model.SchemaFields.*;
import static by.autopost.rental.model.Values.*;
import static by.autopost.rental.preparation.PreparationIssues.*;
import static by.autopost.shared.Json.*;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.DecimalNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.fasterxml.jackson.databind.node.TextNode;
import java.math.BigDecimal;
import java.util.Map;

public final class AddressPreparation {
  public void apply(
      JsonNode plan,
      Map<String, JsonNode> fields,
      ObjectNode common,
      ObjectNode values,
      ArrayNode issues,
      JsonNode address) {
    for (var coordinate : plan.path("coordinates")) {
      String target = text(coordinate, "platform_option_id"), axis = text(coordinate, "axis");
      JsonNode lat = common.path("location.latitude"), lon = common.path("location.longitude");
      if (missing(lat) && missing(lon)) continue;
      try {
        BigDecimal latitude = decimal(lat, false), longitude = decimal(lon, false);
        if (!address.path("confirmed").asBoolean(false)
            || !text(address, "precision").equals("0")
            || latitude.compareTo(decimal(address.path("latitude"), false)) != 0
            || longitude.compareTo(decimal(address.path("longitude"), false)) != 0
            || latitude.abs().compareTo(new BigDecimal("90")) > 0
            || longitude.abs().compareTo(new BigDecimal("180")) > 0)
          throw new IllegalArgumentException(
              "Подтвердите точную точку дома; координаты должны соответствовать выбранному"
                  + " адресу.");
        JsonNode v =
            axis.equals("pair")
                ? TextNode.valueOf(latitude.toPlainString() + "," + longitude.toPlainString())
                : DecimalNode.valueOf(axis.equals("latitude") ? latitude : longitude);
        if (values.has(target) && !equal(values.get(target), v))
          issue(
              issues,
              target,
              "coordinate_conflict",
              "Координаты площадки и выбранного адреса различаются.");
        else values.set(target, v);
      } catch (IllegalArgumentException e) {
        issue(issues, target, "coordinate", e.getMessage());
      }
    }
    // Resolve only confirmed labels/codes from this form's dictionary. Never reuse a DaData/OSM ID
    // as a marketplace ID.
    for (var row : plan.path("addresses")) {
      String target = text(row, "platform_option_id"), part = text(row, "part");
      JsonNode field = fields.get(target);
      if (field == null) continue;
      if (!address.path("confirmed").asBoolean(false)) {
        if (!missing(values.get(target)) && !row.path("scalar_verified").asBoolean(false))
          issue(
              issues,
              target,
              "native_address_object",
              "Подтвердите адрес в форме площадки: одного вручную выбранного кода недостаточно.");
        continue;
      }
      if (missing(values.get(target))) {
        String label = text(address, part);
        var matches =
            list(field.path("options")).stream()
                .filter(c -> normalized(text(c, "name")).equals(normalized(label)))
                .toList();
        if (!label.isBlank() && matches.size() == 1 && row.path("scalar_verified").asBoolean(false))
          values.set(target, matches.get(0).path("fill_rule").path("value").deepCopy());
        else
          issue(
              issues,
              target,
              "marketplace_address",
              "Адрес выбран у нас; подтвердите соответствующий адрес в справочнике площадки. Её"
                  + " внутренние коды отличаются.");
      }
      if (!row.path("scalar_verified").asBoolean(false))
        issue(
            issues,
            target,
            "native_address_object",
            "Для этой площадки нужен подтверждённый адресный объект и точка карты; одного"
                + " идентификатора недостаточно.");
    }
  }
}
