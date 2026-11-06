package by.autopost;

import by.autopost.address.application.AddressText;

import static by.autopost.shared.Json.*;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

import by.autopost.address.infrastructure.DadataAddressGateway;
import by.autopost.ai.AiGateway;
import by.autopost.rental.ai.*;
import by.autopost.rental.application.RentalCatalog;
import by.autopost.rental.catalog.FileReferenceRepository;
import by.autopost.shared.ApiException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.util.*;
import org.junit.jupiter.api.Test;

class RentalAiAddressTest {
  static final String LABEL = "город Минск, ул. Брикета, дом 18";
  final RentalCatalog catalog =
      new RentalCatalog(new FileReferenceRepository("../data/rental/apartments_long_term_rent"));

  ObjectNode raw() {
    return object(
        "value",
        "г Минск, ул Брикета, д 18",
        "data",
        object(
            "country_iso_code",
            "BY",
            "fias_id",
            "way:25439815",
            "city",
            "Минск",
            "city_with_type",
            "г Минск",
            "region_with_type",
            "г Минск",
            "street",
            "Брикета",
            "street_with_type",
            "ул Брикета",
            "house",
            "18",
            "block",
            "",
            "geo_lat",
            "53.908548",
            "geo_lon",
            "27.4150416",
            "qc_geo",
            "0"));
  }

  class Provider extends AddressService {
    List<String> queries = new ArrayList<>();
    List<String> workspaces = new ArrayList<>();
    JsonNode response = array(List.of(raw()));
    JsonNode confirmation;
    ApiException failure;

    Provider() {
      super(new DadataAddressGateway("test", "", ""));
    }

    @Override
    JsonNode fetch(String query, int count) {
      queries.add(query);
      if (failure != null) throw failure;
      return count == 1 && confirmation != null ? confirmation : response;
    }

    @Override
    public synchronized ObjectNode suggest(String workspace, String query) {
      workspaces.add(workspace);
      return super.suggest(workspace, query);
    }

    @Override
    public synchronized ObjectNode select(String workspace, String id) {
      workspaces.add(workspace);
      return super.select(workspace, id);
    }
  }

  ObjectNode analyze(Provider provider, String label) {
    var ai = mock(AiGateway.class);
    String source = "Сдам квартиру: " + label + ". Цена 1300 BYN. Контакт: Тест.";
    var parsed =
        object(
            "address",
            object("label", label, "quote", label),
            "suggestions",
            List.of(object("field", "rental.monthly_price", "value", "1300", "quote", "1300 BYN")));
    when(ai.serverJson(eq("person"), anyString(), eq(source))).thenReturn(parsed);
    var service = new RentalAiService(catalog, ai, new RentalAiAddressResolver(provider));
    return service.analyze(
        "person", "workspace", object("text", source, "schemaVersion", catalog.version()));
  }

  @Test
  void normalizesLiteralAddressAndFeedsStructuredValuesToExtension() {
    var provider = new Provider();
    var result = analyze(provider, LABEL);
    var address = result.path("address");
    assertEquals("matched", text(address, "resolution"));
    assertEquals("г Минск, ул Брикета, д 18", text(address, "label"));
    assertEquals("Минск", text(address, "settlement"));
    assertEquals("Брикета", text(address, "street"));
    assertEquals("18", text(address, "house"));
    assertEquals("27.4150416", text(address, "longitude"));
    assertTrue(address.path("confirmed").asBoolean());
    assertEquals(List.of("workspace", "workspace"), provider.workspaces);
    assertEquals(List.of("город Минск ул. Брикета 18", "г Минск, ул Брикета, д 18"), provider.queries);
    assertEquals(1, result.path("suggestions").size());
    var draft =
        object(
            "schemaVersion",
            catalog.version(),
            "modelVersion",
            2,
            "values",
            object(),
            "extras",
            object(),
            "platforms",
            List.of("realt"),
            "address",
            address);
    var controls = list(catalog.browser(draft).path("jobs").get(0).path("controls"));
    for (var pair :
        Map.of("realt.settlement", "Минск", "realt.street", "Брикета", "realt.house_number", "18")
            .entrySet())
      assertTrue(
          controls.stream()
              .anyMatch(
                  c ->
                      text(c, "field").equals(pair.getKey())
                          && text(c, "value").equals(pair.getValue())),
          pair.getKey());
  }

  @Test
  void noMatchAndProviderFailuresKeepLiteralPartsAndOtherFacts() {
    for (int status : List.of(0, 429, 503, 502)) {
      var provider = new Provider();
      provider.response = array();
      if (status != 0) provider.failure = new ApiException(status, "unavailable");
      var result = analyze(provider, LABEL);
      var address = result.path("address");
      assertEquals(status == 0 ? "not_found" : "unavailable", text(address, "resolution"));
      assertEquals("manual", text(address, "provider"));
      assertEquals("Минск", text(address, "settlement"));
      assertEquals("Брикета", text(address, "street"));
      assertEquals("18", text(address, "house"));
      assertFalse(address.path("confirmed").asBoolean());
      assertFalse(address.has("sourceId"));
      assertEquals(1, result.path("suggestions").size());
    }
  }

  @Test
  void neverChoosesWrongCityHouseStreetTypeOrUnmentionedCorpus() {
    for (var pair :
        Map.of(
                "city_with_type",
                "г Брест",
                "street_with_type",
                "пер Брикета",
                "house",
                "19",
                "block",
                "1",
                "country_iso_code",
                "RU")
            .entrySet()) {
      var provider = new Provider();
      ((ObjectNode) provider.response.get(0).path("data")).put(pair.getKey(), pair.getValue());
      var result = analyze(provider, LABEL);
      assertFalse(result.path("address").path("confirmed").asBoolean(), pair.getKey());
      assertEquals(1, provider.queries.size());
    }
  }

  @Test
  void resolvesInflectedEvidenceAgainstTheTypedStreetInsteadOfItsNamesake() {
    var provider = new Provider();
    var right = raw();
    ((ObjectNode)right.path("data")).put("street_with_type", "пр-кт Независимости");
    var wrong = right.deepCopy();
    ((ObjectNode)wrong.path("data")).put("street_with_type", "ул Независимости");
    provider.response = array(List.of(wrong, right));
    provider.confirmation = array(List.of(right));
    String label = "в Минске на проспекте Независимости, дом 18";
    var result = RentalAiPolicy.sanitize(catalog.analysisSchema(), label,
        object("address", object("quote", label, "label", label, "street", "проспекте Независимости",
            "streetNominative", "Независимости", "settlement", "Минске", "settlementNominative", "Минск")));
    new RentalAiAddressResolver(provider).resolve("workspace", result);
    var address = (ObjectNode)result.path("address");
    assertTrue(address.path("confirmed").asBoolean());
    assertEquals("Минск проспект Независимости 18", provider.queries.get(0));
    AddressText.cleanComponents(address);
    assertEquals("Независимости", text(address, "street"));
    assertEquals("пр", text(address, "streetType"));
    assertFalse(address.has("streetWithType"));
    var adjective = LiteralAddress.parse("на Садовой улице", object("street", "Садовой улице", "streetNominative", "Садовая"));
    AddressText.cleanComponents(adjective);
    assertEquals("Садовая", text(adjective, "street"));
    assertEquals("ул", text(adjective, "streetType"));
    assertNotEquals("Московская", text(LiteralAddress.parse("на Садовой улице",
        object("street", "Садовой улице", "streetNominative", "Московская")), "street"));
  }

  @Test
  void ambiguousOrIncompleteEvidenceNeverSelectsFirstSuggestion() {
    var provider = new Provider();
    provider.response = array(List.of(raw(), raw()));
    assertEquals("ambiguous", text(analyze(provider, LABEL).path("address"), "resolution"));
    assertEquals(1, provider.queries.size());
    provider = new Provider();
    assertFalse(
        analyze(provider, "город Минск, ул. Брикета")
            .path("address")
            .path("confirmed")
            .asBoolean());
    assertEquals(1, provider.queries.size());
  }

  @Test
  void confirmationChangeCannotSilentlyAddACorpus() {
    var provider = new Provider();
    var changed = raw();
    ((ObjectNode) changed.path("data")).put("block", "2");
    provider.confirmation = array(List.of(changed));
    var result = analyze(provider, LABEL);
    assertEquals("ambiguous", text(result.path("address"), "resolution"));
    assertEquals("", text(result.path("address"), "block"));
    assertFalse(result.path("address").path("confirmed").asBoolean());
  }

  @Test
  void missingOrUngroundedAddressDoesNotCallProvider() {
    var provider = new Provider();
    var result =
        RentalAiPolicy.sanitize(
            catalog.analysisSchema(),
            "Сдам квартиру",
            object("address", object("label", LABEL, "quote", LABEL)));
    new RentalAiAddressResolver(provider).resolve("workspace", result);
    assertTrue(provider.queries.isEmpty());
    assertTrue(result.path("address").isNull());
  }

  @Test
  void literalPartsSupportAbbreviationsBareCityAndGroundedAiSplit() {
    for (String label :
        List.of(
            LABEL,
            "г. Минск, ул Брикета, д. 18",
            "Минск, улица Брикета, 18",
            "г Минск ул Брикета д. 18"))
      assertTrue(
          LiteralAddress.matches(
              LiteralAddress.parse(label, object()), AddressService.normalize(raw())),
          label);
    var parsed =
        LiteralAddress.parse(
            "Минск Брикета 18",
            object(
                "settlement",
                "Минск",
                "street",
                "Брикета",
                "house",
                "18",
                "district",
                "Придуманный",
                "block",
                "8",
                "sourceId",
                "fake"));
    assertTrue(LiteralAddress.matches(parsed, AddressService.normalize(raw())));
    assertEquals("", text(parsed, "district"));
    assertEquals("", text(parsed, "block"));
    assertFalse(parsed.has("sourceId"));
  }
}
