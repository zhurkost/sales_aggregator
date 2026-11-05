package by.autopost.rental.engine;

import by.autopost.rental.model.Address;
import by.autopost.rental.model.CardFields;
import by.autopost.rental.model.FieldDef;
import by.autopost.rental.model.Mapping;
import by.autopost.rental.model.Value;
import java.math.BigDecimal;
import java.util.Map;

/** The point of the house and the native address fields a plan fills from the confirmed address. */
final class AddressPreparation {
  void apply(
      Mapping plan,
      Map<String, FieldDef> fields,
      Map<String, Value> card,
      Map<String, Value> values,
      Issues issues,
      Address address) {
    for (var coordinate : plan.coordinates()) {
      String target = coordinate.platformOptionId(), axis = coordinate.axis();
      Value lat = card.get(CardFields.LATITUDE), lon = card.get(CardFields.LONGITUDE);
      if (Value.missing(lat) && Value.missing(lon)) continue;
      try {
        BigDecimal latitude = Numbers.decimal(lat, false), longitude = Numbers.decimal(lon, false);
        if (!address.exactPoint()
            || latitude.compareTo(Numbers.decimal(address.latitude(), false)) != 0
            || longitude.compareTo(Numbers.decimal(address.longitude(), false)) != 0
            || latitude.abs().compareTo(new BigDecimal("90")) > 0
            || longitude.abs().compareTo(new BigDecimal("180")) > 0)
          throw new IllegalArgumentException(
              "Подтвердите точную точку дома; координаты должны соответствовать выбранному"
                  + " адресу.");
        Value v =
            axis.equals("pair")
                ? Value.text(latitude.toPlainString() + "," + longitude.toPlainString())
                : Value.decimal(axis.equals("latitude") ? latitude : longitude);
        if (values.containsKey(target) && !values.get(target).same(v))
          issues.add(
              target, "coordinate_conflict", "Координаты площадки и выбранного адреса различаются.");
        else values.put(target, v);
      } catch (IllegalArgumentException e) {
        issues.add(target, "coordinate", e.getMessage());
      }
    }
    // Resolve only confirmed labels/codes from this form's dictionary. Never reuse a DaData/OSM ID
    // as a marketplace ID.
    for (var row : plan.addresses()) {
      String target = row.platformOptionId(), part = row.part();
      FieldDef field = fields.get(target);
      if (field == null) continue;
      if (!address.isConfirmed()) {
        if (!Value.missing(values.get(target)) && !row.verified())
          issues.add(
              target,
              "native_address_object",
              "Подтвердите адрес в форме площадки: одного вручную выбранного кода недостаточно.");
        continue;
      }
      if (Value.missing(values.get(target))) {
        String label = address.part(part);
        var matches =
            field.choices().stream()
                .filter(c -> Numbers.normalized(c.name()).equals(Numbers.normalized(label)))
                .toList();
        if (!label.isBlank()
            && matches.size() == 1
            && row.verified()
            && matches.get(0).code() != null)
          values.put(target, matches.get(0).code());
        else
          issues.add(
              target,
              "marketplace_address",
              "Адрес выбран у нас; подтвердите соответствующий адрес в справочнике площадки. Её"
                  + " внутренние коды отличаются.");
      }
      if (!row.verified())
        issues.add(
            target,
            "native_address_object",
            "Для этой площадки нужен подтверждённый адресный объект и точка карты; одного"
                + " идентификатора недостаточно.");
    }
  }
}
