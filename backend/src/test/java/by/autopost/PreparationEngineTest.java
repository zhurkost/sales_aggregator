package by.autopost;

import static by.autopost.Json.*;
import static org.junit.jupiter.api.Assertions.*;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.*;
import java.math.BigDecimal;
import java.util.*;
import org.junit.jupiter.api.Test;

class PreparationEngineTest {
  @Test void suppliedButUnmappableRequiredValueDoesNotAskForTheSameFactAgain() {
    var schema = schema(option("currency", "enum", object("required", true), choice("USD")));
    var result = run(schema, plan(row("rental.currency", "currency", object("kind", "lookup", "values", List.of(object("from", "USD", "to", "USD"))))), object("rental.currency", "BYN"), object());
    assertEquals(1, result.path("issues").size());
    assertEquals("conversion", result.path("issues").get(0).path("code").asText());
  }
  @Test void invalidNumberInInactiveBranchDoesNotBlockPreparation() {
    var schema = schema(option("rooms", "integer", object()), option("separate", "integer", object("when", object("option_id", "rooms", "operator", "gt", "value", 1))));
    var result = run(schema, plan(), object(), object("rooms", 1, "separate", "1.5"));
    assertTrue(result.path("issues").isEmpty());
    assertFalse(result.path("values").has("separate"));
  }
  @Test void explicitNoInCheckboxMappingMeansOmitTheCodeAndNeverNull() {
    var schema = schema(option("items", "multi_enum", object(), choice("a")));
    var plan = plan(row("", "items", object("kind", "multi_lookup", "members", List.of(object("common_option_id", "amenity.test", "values", List.of(object("from", true, "to", "a"), object("from", false, "to", null)))))));
    var result = run(schema, plan, object("amenity.test", false), object());
    assertTrue(result.path("values").path("items").isArray());
    assertTrue(result.path("values").path("items").isEmpty());
    assertTrue(result.path("issues").isEmpty());
  }

  @Test
  void changingANativePlanInvalidatesPreviouslyPreparedDrafts() {
    ObjectNode nativePlan = object("schema_hash", "original", "fields", List.of());
    RentalCatalog catalog =
        new RentalCatalog("") {
          @Override
          JsonNode common() {
            return array();
          }

          @Override
          JsonNode plan(String platform) {
            return nativePlan;
          }
        };
    String previous = catalog.version();
    nativePlan.put("schema_hash", "changed-codes");
    assertThrows(
        ApiException.class,
        () -> catalog.prepare(object("schemaVersion", previous, "platforms", List.of("kufar"))));
  }

  JsonNode option(String id, String type, JsonNode rule, JsonNode... choices) {
    return object(
        "id", id, "name", id, "type", type, "fill_rule", rule, "options", List.of(choices));
  }

  JsonNode choice(Object code) {
    return object("type", "choice", "fill_rule", object("value", code));
  }

  ArrayNode schema(JsonNode... fields) {
    return array(List.of(object("options", List.of(fields))));
  }

  ObjectNode plan(JsonNode... fields) {
    return object("runtime_version", "1.0", "platform", "example", "fields", List.of(fields));
  }

  JsonNode row(String common, String target, JsonNode conversion) {
    return object(
        "common_option_id", common, "platform_option_id", target, "conversion", conversion);
  }

  ObjectNode run(JsonNode schema, JsonNode plan, ObjectNode values, ObjectNode extras) {
    return new PreparationEngine().prepare(schema, plan, values, extras, object());
  }

  @Test
  void decimalsAreExactAndNeverRound() {
    assertEquals(
        new BigDecimal("1234.56"),
        PreparationEngine.decimal(TextNode.valueOf("1\u00a0234,56"), false));
    assertEquals(new BigDecimal("0"), PreparationEngine.decimal(TextNode.valueOf("0"), true));
    assertThrows(
        IllegalArgumentException.class,
        () -> PreparationEngine.decimal(TextNode.valueOf("1234.56"), true));
    for (String invalid : List.of("1,234.5", "1e3", "45 м²", "5+", "12 34", "NaN"))
      assertThrows(
          IllegalArgumentException.class,
          () -> PreparationEngine.decimal(TextNode.valueOf(invalid), false));
  }

  @Test
  void telephoneIsAStringAndPreservesNationalDigits() {
    assertEquals(
        "291234567",
        PreparationEngine.phone(TextNode.valueOf("+375 (29) 123-45-67"), "BY_NATIONAL"));
    assertEquals("+375291234567", PreparationEngine.phone(TextNode.valueOf("29 1234567"), "E164"));
    assertThrows(
        IllegalArgumentException.class,
        () -> PreparationEngine.phone(TextNode.valueOf("+48123456789"), "BY_NATIONAL"));
    assertThrows(
        IllegalArgumentException.class,
        () -> PreparationEngine.phone(TextNode.valueOf("+375291234567 доб 01"), "E164"));
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
    var result = run(schema, plan, object("who", "agency", "room", "studio"), object());
    assertTrue(result.path("dataReady").asBoolean());
    assertTrue(result.path("values").get("role").isBoolean());
    assertEquals(0, result.path("values").path("room").asInt());
  }

  @Test
  void unknownDoesNotTurnTrueThroughNegation() {
    JsonNode condition =
        object("not", object("option_id", "role", "operator", "equals", "value", false));
    assertEquals(PreparationEngine.Truth.UNKNOWN, PreparationEngine.when(condition, object()));
    assertEquals(
        PreparationEngine.Truth.NO, PreparationEngine.when(condition, object("role", false)));
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
    assertTrue(run(schema, plan(), object(), object("role", false)).path("dataReady").asBoolean());
    assertFalse(run(schema, plan(), object(), object("role", true)).path("dataReady").asBoolean());
    assertFalse(run(schema, plan(), object(), object()).path("dataReady").asBoolean());
  }

  @Test
  void listCombinesFeaturesAndRetainsExplicitExtras() {
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
    var result =
        run(schema, plan, object("a", "yes", "b", "yes"), object("features", List.of("custom")));
    assertEquals(
        parse("[\"custom\",\"fridge\",\"washer\"]"), result.path("values").path("features"));
    assertTrue(result.path("issues").isEmpty());
    result = run(schema, plan, object("a", "forbidden"), object());
    assertFalse(result.path("dataReady").asBoolean());
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
    var result = run(schema, plan, object("price", "1200,5", "currency", "BYN"), object());
    assertFalse(result.path("values").has("amount"));
    result = run(schema, plan, object("price", "1200", "currency", "unknown"), object());
    assertFalse(result.path("values").has("amount"));
    result = run(schema, plan, object("price", "1200", "currency", "BYN"), object());
    assertEquals(1200, result.path("values").path("amount").asInt());
  }

  @Test
  void explicitOverridesCannotSilentlyWinAConflict() {
    var result =
        run(
            schema(option("name", "text", object())),
            plan(row("name", "name", object("kind", "identity"))),
            object("name", "A"),
            object("name", "B"));
    assertFalse(result.path("dataReady").asBoolean());
    assertEquals("B", result.path("values").path("name").asText());
  }

  @Test
  void htmlTextIsEscapedAndLineBreaksPreserved() {
    var result =
        run(
            schema(option("description", "text", object())),
            plan(row("description", "description", object("kind", "plain_text_html"))),
            object("description", "<script>x</script>\nSecond"),
            object());
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
            object("images", urls),
            object());
    assertEquals(array(urls), result.path("values").path("photos"));
    assertFalse(result.path("dataReady").asBoolean());
    assertFalse(result.path("publicationReady").asBoolean());
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
        new PreparationEngine()
            .prepare(
                schema(option("town", "enum", object(), choice(77))),
                plan,
                object(),
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
    var engine = new PreparationEngine();
    assertEquals(
        new BigDecimal("53.9"),
        engine
            .prepare(schema, plan, input, object(), address)
            .path("values")
            .path("lat")
            .decimalValue());
    address.put("precision", "3");
    assertFalse(engine.prepare(schema, plan, input, object(), address).path("values").has("lat"));
  }

  @Test
  void nativeNumericTextAlsoUsesExactDecimalConversion() {
    var result =
        run(
            schema(option("area", "number", object())),
            plan(),
            object(),
            object("area", "1,123456789012345678"));
    assertEquals(
        new BigDecimal("1.123456789012345678"), result.path("values").path("area").decimalValue());
  }

  @Test
  void readonlyNumericWhenDoesNotCompareTextLexically() {
    assertEquals(
        PreparationEngine.Truth.UNKNOWN,
        PreparationEngine.when(
            object("option_id", "floor", "operator", "gt", "value", 3), object("floor", "10")));
  }

  @Test
  void portableEmailPatternKeepsSourceMeaning() {
    var field =
        option(
            "email",
            "text",
            object("validation", object("pattern", "^[\\w-\\.]+@([\\w-]+\\.)+[\\w-]{2,4}$")));
    assertDoesNotThrow(
        () -> PreparationEngine.validateValue(field, TextNode.valueOf("a.b-c@example.test")));
    assertThrows(
        IllegalArgumentException.class,
        () -> PreparationEngine.validateValue(field, TextNode.valueOf("a@example.invalid")));
  }

  @Test
  void fieldsFromUntrustedPlansCannotUseUnsupportedVersions() {
    var p = plan();
    p.put("runtime_version", "999");
    assertThrows(ApiException.class, () -> run(schema(), p, object(), object()));
  }

  @Test
  void aHouseChoiceCannotSurviveChangingItsStreet() {
    var selected = choice("house-1");
    ((ObjectNode) selected.path("fill_rule"))
        .set("when", object("option_id", "street", "operator", "equals", "value", "street-a"));
    var schema =
        schema(option("street", "text", object()), option("house", "enum", object(), selected));
    assertFalse(
        run(schema, plan(), object(), object("street", "street-b", "house", "house-1"))
            .path("dataReady")
            .asBoolean());
    assertFalse(
        run(schema, plan(), object(), object("house", "house-1")).path("dataReady").asBoolean());
    assertTrue(
        run(schema, plan(), object(), object("street", "street-a", "house", "house-1"))
            .path("dataReady")
            .asBoolean());
  }

  @Test
  void editorRetainsParentConditionsWithoutChangingSource() {
    var field = option("name", "text", object());
    var group =
        option(
            "company",
            "group",
            object("when", object("option_id", "owner", "operator", "equals", "value", false)),
            field);
    var fields = RentalCatalog.editorFields(schema(group));
    assertEquals("owner", fields.get("name").path("uiWhen").path("option_id").asText());
    assertFalse(field.has("uiWhen"));
  }
}
