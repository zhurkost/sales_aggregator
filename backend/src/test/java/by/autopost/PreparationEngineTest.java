package by.autopost;

import static by.autopost.shared.Json.*;
import static org.junit.jupiter.api.Assertions.*;

import by.autopost.rental.application.RentalCatalog;
import by.autopost.rental.catalog.*;
import by.autopost.rental.engine.*;
import by.autopost.rental.model.*;
import by.autopost.shared.ApiException;
import by.autopost.shared.Json;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.*;
import java.math.BigDecimal;
import java.util.*;
import org.junit.jupiter.api.Test;

class PreparationEngineTest {
  @Test
  void suppliedButUnmappableRequiredValueDoesNotAskForTheSameFactAgain() {
    var schema = schema(option("currency", "enum", object("required", true), choice("USD")));
    var result =
        run(
            schema,
            plan(
                row(
                    "rental.currency",
                    "currency",
                    object(
                        "kind", "lookup", "values", List.of(object("from", "USD", "to", "USD"))))),
            object("rental.currency", "BYN"));
    assertEquals(1, result.path("issues").size());
    assertEquals("conversion", result.path("issues").get(0).path("code").asText());
  }

  @Test
  void invalidNumberInInactiveBranchDoesNotBlockPreparation() {
    var schema =
        schema(
            option("rooms", "integer", object()),
            option(
                "separate",
                "integer",
                object("when", object("option_id", "rooms", "operator", "gt", "value", 1))));
    var result =
        run(
            schema,
            plan(
                row("rooms", "rooms", object("kind", "identity")),
                row("separate", "separate", object("kind", "identity"))),
            object("rooms", 1, "separate", "1.5"));
    assertTrue(result.path("issues").isEmpty());
    assertFalse(result.path("values").has("separate"));
  }

  @Test
  void explicitNoInCheckboxMappingMeansOmitTheCodeAndNeverNull() {
    var schema = schema(option("items", "multi_enum", object(), choice("a")));
    var plan =
        plan(
            row(
                "",
                "items",
                object(
                    "kind",
                    "multi_lookup",
                    "members",
                    List.of(
                        object(
                            "common_option_id",
                            "amenity.test",
                            "values",
                            List.of(
                                object("from", true, "to", "a"),
                                object("from", false, "to", null)))))));
    var result = run(schema, plan, object("amenity.test", false));
    assertTrue(result.path("values").path("items").isArray());
    assertTrue(result.path("values").path("items").isEmpty());
    assertTrue(result.path("issues").isEmpty());
  }

  @Test
  void onlyTheCardVersionDecidesWhetherACardIsPrepared() {
    var plan = parse(object("runtime_version", "1.0", "platform", "kufar", "fields", List.of()), Mapping.class);
    var form = parse(object("controls", array()), FormRecipe.class);
    java.util.function.Function<String, RentalCatalog> release =
        integration ->
            new RentalCatalog(
                () ->
                    new ReferenceSnapshot(
                        "apartments_long_term_rent",
                        new Schema(List.of()),
                        parse(object(), CardModel.class),
                        Map.of(
                            "kufar",
                            // Every platform has a browser recipe.
                            new ReferenceSnapshot.Platform(
                                "kufar",
                                schema(),
                                plan,
                                form,
                                new PlatformCoverage("kufar", List.of(), Set.of()))),
                        "card-model",
                        integration));
    var card =
        object(
            "cardVersion",
            "card-model",
            "modelVersion",
            2,
            "values",
            object(),
            "platforms",
            List.of("kufar"));
    // New plans or recipes under the same card model: the open card is still prepared.
    for (String integration : List.of("selectors-before", "selectors-after"))
      assertEquals(
          1,
          RentalJson.prepare(release.apply(integration), card, 0).path("platforms").size(),
          integration);
    card.put("cardVersion", "previous-card-model");
    var error =
        assertThrows(
            ApiException.class,
            () -> release.apply("selectors-after").prepare(RentalJson.card(card), 0));
    assertEquals(409, error.status);
  }

  static <T> T parse(JsonNode json, Class<T> type) {
    return ReferenceJson.parse(json, type);
  }

  JsonNode option(String id, String type, JsonNode rule, JsonNode... choices) {
    return object(
        "id", id, "name", id, "type", type, "fill_rule", rule, "options", List.of(choices));
  }

  JsonNode choice(Object code) {
    return object("type", "choice", "fill_rule", object("value", code));
  }

  Schema schema(JsonNode... fields) {
    return parse(array(List.of(object("options", List.of(fields)))), Schema.class);
  }

  ObjectNode plan(JsonNode... fields) {
    return object("runtime_version", "1.0", "platform", "example", "fields", List.of(fields));
  }

  JsonNode row(String common, String target, JsonNode conversion) {
    return object(
        "common_option_id", common, "platform_option_id", target, "conversion", conversion);
  }

  /** The card values as the editor stores them. */
  static Map<String, Value> values(ObjectNode values) {
    return RentalJson.card(object("values", values)).values();
  }

  JsonNode run(Schema schema, JsonNode plan, ObjectNode values) {
    return run(schema, plan, values, object());
  }

  JsonNode run(Schema schema, JsonNode plan, ObjectNode values, ObjectNode address) {
    var prepared =
        new PreparationEngine()
            .prepare(
                schema,
                parse(plan, Mapping.class),
                values(values),
                Json.typed(address, Address.class));
    return object(
        "values",
        RentalJson.tree(prepared.values()),
        "issues",
        RentalJson.tree(prepared.issues()),
        "checksPassed",
        prepared.checksPassed());
  }

  @Test
  void decimalsAreExactAndNeverRound() {
    assertEquals(new BigDecimal("1234.56"), Numbers.decimal("1 234,56", false));
    assertEquals(new BigDecimal("0"), Numbers.decimal("0", true));
    assertThrows(IllegalArgumentException.class, () -> Numbers.decimal("1234.56", true));
    for (String invalid : List.of("1,234.5", "1e3", "45 м²", "5+", "12 34", "NaN"))
      assertThrows(IllegalArgumentException.class, () -> Numbers.decimal(invalid, false));
    assertThrows(
        IllegalArgumentException.class,
        () -> Numbers.decimal(Value.integer(java.math.BigInteger.TEN), false));
  }

  @Test
  void telephoneIsAStringAndPreservesNationalDigits() {
    assertEquals("291234567", Numbers.phone(Value.text("+375 (29) 123-45-67"), "BY_NATIONAL"));
    assertEquals("+375291234567", Numbers.phone(Value.text("29 1234567"), "E164"));
    assertThrows(
        IllegalArgumentException.class,
        () -> Numbers.phone(Value.text("+48123456789"), "BY_NATIONAL"));
    assertThrows(
        IllegalArgumentException.class,
        () -> Numbers.phone(Value.text("+375291234567 доб 01"), "E164"));
  }

  @Test
  void typedCodesRetainFalseAndZero() {
    var schema =
        schema(
            option("role", "enum", object(), choice(true), choice(false)),
            option("room", "enum", object(), choice(0)));
    var plan =
        plan(
            row(
                "who",
                "role",
                object("kind", "lookup", "values", List.of(object("from", "agency", "to", false)))),
            row(
                "room",
                "room",
                object("kind", "lookup", "values", List.of(object("from", "studio", "to", 0)))));
    var result = run(schema, plan, object("who", "agency", "room", "studio"));
    assertTrue(result.path("checksPassed").asBoolean());
    assertTrue(result.path("values").get("role").isBoolean());
    assertEquals(0, result.path("values").path("room").asInt());
  }

  @Test
  void unknownDoesNotTurnTrueThroughNegation() {
    var condition =
        parse(
            object("not", object("option_id", "role", "operator", "equals", "value", false)),
            Condition.class);
    assertEquals(Condition.Truth.UNKNOWN, condition.test(values(object())));
    assertEquals(Condition.Truth.NO, condition.test(values(object("role", false))));
  }

  @Test
  void groupConditionControlsRequiredChildren() {
    var group =
        option(
            "company",
            "group",
            object("when", object("option_id", "role", "operator", "equals", "value", true)),
            option("registration", "text", object("required", true)));
    var schema = schema(option("role", "boolean", object()), group);
    var plan = plan(row("role", "role", object("kind", "identity")));
    assertTrue(run(schema, plan, object("role", false)).path("checksPassed").asBoolean());
    assertFalse(run(schema, plan, object("role", true)).path("checksPassed").asBoolean());
    assertFalse(run(schema, plan, object()).path("checksPassed").asBoolean());
  }

  @Test
  void fieldsOfAConditionalGroupApplyOnlyWhereTheGroupDoes() {
    var group =
        option(
            "company",
            "group",
            object("when", object("option_id", "owner", "operator", "equals", "value", false)),
            option("name", "text", object()));
    var schema = schema(option("owner", "boolean", object()), group);
    var plan = plan(row("owner", "owner", object("kind", "identity")));
    Map<Object, Condition.Truth> applies = new HashMap<>();
    for (Object owner : Arrays.asList(true, false, null)) {
      var values = owner == null ? object() : object("owner", owner);
      applies.put(
          String.valueOf(owner),
          new PreparationEngine()
              .prepare(schema, parse(plan, Mapping.class), values(values), Address.NONE)
              .applies()
              .get("name"));
    }
    assertEquals(
        Map.of(
            "true", Condition.Truth.NO,
            "false", Condition.Truth.YES,
            "null", Condition.Truth.UNKNOWN),
        applies);
  }

  @Test
  void listCombinesFeaturesAndRetainsAPlannedValue() {
    var schema =
        schema(
            option(
                "features",
                "multi_enum",
                object(),
                choice("fridge"),
                choice("washer"),
                choice("custom")));
    var cv =
        object(
            "kind",
            "multi_lookup",
            "members",
            List.of(
                object(
                    "common_option_id",
                    "a",
                    "values",
                    List.of(object("from", "yes", "to", "fridge"))),
                object(
                    "common_option_id",
                    "b",
                    "values",
                    List.of(object("from", "yes", "to", "washer")))));
    var plan = plan(object("platform_option_id", "features", "conversion", cv));
    // The plan's own value of the list stays and the card's options join it.
    plan.set("constants", object("features", List.of("custom")));
    var result = run(schema, plan, object("a", "yes", "b", "yes"));
    assertEquals(
        Json.parse("[\"custom\",\"fridge\",\"washer\"]"), result.path("values").path("features"));
    assertTrue(result.path("issues").isEmpty());
    result = run(schema, plan, object("a", "forbidden"));
    assertFalse(result.path("checksPassed").asBoolean());
  }

  @Test
  void priceRequiresSupportedCurrencyAndIntegerPrecision() {
    var schema =
        schema(
            option("currency", "enum", object(), choice("LOCAL")),
            option("amount", "integer", object("validation", object("min", 1))));
    var plan =
        plan(
            row(
                "price",
                "amount",
                object("kind", "decimal", "target", "integer", "requires", List.of("currency"))),
            row(
                "currency",
                "currency",
                object("kind", "lookup", "values", List.of(object("from", "BYN", "to", "LOCAL")))));
    var result = run(schema, plan, object("price", "1200,5", "currency", "BYN"));
    assertFalse(result.path("values").has("amount"));
    result = run(schema, plan, object("price", "1200", "currency", "unknown"));
    assertFalse(result.path("values").has("amount"));
    result = run(schema, plan, object("price", "1200", "currency", "BYN"));
    assertEquals(1200, result.path("values").path("amount").asInt());
  }

  @Test
  void aPlannedValueCannotSilentlyWinAConflict() {
    var plan = plan(row("name", "name", object("kind", "identity")));
    plan.set("constants", object("name", "B"));
    var result = run(schema(option("name", "text", object())), plan, object("name", "A"));
    assertFalse(result.path("checksPassed").asBoolean());
    assertEquals("conflict", result.path("issues").get(0).path("code").asText());
    assertEquals("B", result.path("values").path("name").asText());
  }

  @Test
  void htmlTextIsEscapedAndLineBreaksPreserved() {
    var result =
        run(
            schema(option("description", "text", object())),
            plan(row("description", "description", object("kind", "plain_text_html"))),
            object("description", "<script>x</script>\nSecond"));
    assertEquals(
        "<p>&lt;script&gt;x&lt;/script&gt;<br>Second</p>",
        result.path("values").path("description").asText());
  }

  @Test
  void filesAreNotCroppedDroppedOrReordered() {
    var urls = List.of("https://example.test/b.jpg", "https://example.test/a.jpg");
    var result =
        run(
            schema(option("photos", "files", object("validation", object("max_items", 1)))),
            plan(row("images", "photos", object("kind", "files"))),
            object("images", urls));
    assertEquals(array(urls), result.path("values").path("photos"));
    assertFalse(result.path("checksPassed").asBoolean());
  }

  @Test
  void addressProviderIdsAreNeverMarketplaceIds() {
    var plan = plan();
    plan.set(
        "addresses",
        array(
            List.of(
                object(
                    "platform_option_id",
                    "town",
                    "part",
                    "settlement",
                    "scalar_verified",
                    false))));
    var result =
        run(
            schema(option("town", "enum", object(), choice(77))),
            plan,
            object(),
            object("confirmed", true, "settlement", "Минск", "sourceId", "way:123"));
    assertFalse(result.path("values").has("town"));
    assertFalse(result.path("issues").isEmpty());
  }

  @Test
  void exactCoordinatesNeedTheCurrentConfirmedPoint() {
    var schema = schema(option("lat", "number", object()));
    var plan = plan();
    plan.set(
        "coordinates", array(List.of(object("platform_option_id", "lat", "axis", "latitude"))));
    var input = object("location.latitude", "53.9", "location.longitude", "27.5");
    var address =
        object("confirmed", true, "precision", "0", "latitude", "53.9", "longitude", "27.5");
    assertEquals(
        new BigDecimal("53.9"),
        run(schema, plan, input, address).path("values").path("lat").decimalValue());
    address.put("precision", "3");
    assertFalse(run(schema, plan, input, address).path("values").has("lat"));
  }

  @Test
  void numericTextUsesExactDecimalConversion() {
    var result =
        run(
            schema(option("area", "number", object())),
            plan(row("rental.area", "area", object("kind", "decimal", "target", "number"))),
            object("rental.area", "1,123456789012345678"));
    assertEquals(
        new BigDecimal("1.123456789012345678"), result.path("values").path("area").decimalValue());
  }

  @Test
  void readonlyNumericWhenDoesNotCompareTextLexically() {
    var condition =
        parse(object("option_id", "floor", "operator", "gt", "value", 3), Condition.class);
    assertEquals(Condition.Truth.UNKNOWN, condition.test(values(object("floor", "10"))));
  }

  @Test
  void portableEmailPatternKeepsSourceMeaning() {
    var field =
        parse(
            option(
                "email",
                "text",
                object("validation", object("pattern", "^[\\w-\\.]+@([\\w-]+\\.)+[\\w-]{2,4}$"))),
            FieldDef.class);
    assertDoesNotThrow(() -> FieldValidation.validateValue(field, Value.text("a.b-c@example.test")));
    assertThrows(
        IllegalArgumentException.class,
        () -> FieldValidation.validateValue(field, Value.text("a@example.invalid")));
  }

  @Test
  void fieldsFromUntrustedPlansCannotUseUnsupportedVersions() {
    var p = plan();
    p.put("runtime_version", "999");
    assertThrows(ApiException.class, () -> run(schema(), p, object()));
  }

  @Test
  void aHouseChoiceCannotSurviveChangingItsStreet() {
    var selected = choice("house-1");
    ((ObjectNode) selected.path("fill_rule"))
        .set("when", object("option_id", "street", "operator", "equals", "value", "street-a"));
    var schema =
        schema(option("street", "text", object()), option("house", "enum", object(), selected));
    var plan =
        plan(
            row("street", "street", object("kind", "identity")),
            row("house", "house", object("kind", "identity")));
    assertFalse(
        run(schema, plan, object("street", "street-b", "house", "house-1"))
            .path("checksPassed")
            .asBoolean());
    assertFalse(run(schema, plan, object("house", "house-1")).path("checksPassed").asBoolean());
    assertTrue(
        run(schema, plan, object("street", "street-a", "house", "house-1"))
            .path("checksPassed")
            .asBoolean());
  }

  @Test
  void referenceRecordsAreImmutable() {
    var schema = schema(option("name", "text", object()));
    assertThrows(
        UnsupportedOperationException.class, () -> schema.fields().remove("name"));
    assertThrows(
        UnsupportedOperationException.class,
        () -> schema.categories().get(0).options().clear());
  }
}
