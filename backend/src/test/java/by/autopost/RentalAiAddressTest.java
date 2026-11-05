package by.autopost;

import static by.autopost.shared.Json.*;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

import by.autopost.ai.AiGateway;
import by.autopost.rental.address.*;
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

  /** Replaces the DaData transport. */
  class Upstream implements AddressProvider {
    List<String> queries = new ArrayList<>();
    JsonNode response = array(List.of(raw()));
    JsonNode confirmation;
    ApiException failure;

    @Override
    public List<DadataSuggestion> suggest(String query, int count) {
      queries.add(query);
      if (failure != null) throw failure;
      List<DadataSuggestion> result = new ArrayList<>();
      for (var item : count == 1 && confirmation != null ? confirmation : response)
        result.add(DadataSuggestion.parse(item));
      return result;
    }
  }

  class Provider extends AddressService {
    final Upstream upstream;
    List<String> workspaces = new ArrayList<>();

    Provider() {
      this(new Upstream());
    }

    Provider(Upstream upstream) {
      super(upstream, 10_000);
      this.upstream = upstream;
    }

    @Override
    public ObjectNode suggest(String workspace, String query) {
      workspaces.add(workspace);
      return super.suggest(workspace, query);
    }

    @Override
    public ObjectNode select(String workspace, String id) {
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
        "person", "workspace", object("text", source, "cardVersion", catalog.cardVersion()));
  }

  @Test
  void normalizesLiteralAddressAndFeedsStructuredValuesToExtension() {
    var provider = new Provider();
    var result = analyze(provider, LABEL);
    var address = result.path("address");
    assertEquals("matched", text(address, "resolution"));
    assertEquals("г Минск, ул Брикета, д 18", text(address, "label"));
    assertEquals("г Минск", text(address, "settlement"));
    assertEquals("ул Брикета", text(address, "street"));
    assertEquals("18", text(address, "house"));
    assertEquals("27.4150416", text(address, "longitude"));
    assertTrue(address.path("confirmed").asBoolean());
    assertEquals(List.of("workspace", "workspace"), provider.workspaces);
    assertEquals(List.of(LABEL, "г Минск, ул Брикета, д 18"), provider.upstream.queries);
    assertEquals(1, result.path("suggestions").size());
    var draft =
        object(
            "cardVersion",
            catalog.cardVersion(),
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
    var controls =
        list(RentalJson.browser(catalog, draft, 0).path("jobs").get(0).path("controls"));
    for (var pair :
        Map.of(
                "realt.settlement",
                "г Минск",
                "realt.street",
                "ул Брикета",
                "realt.house_number",
                "18")
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
      provider.upstream.response = array();
      if (status != 0) provider.upstream.failure = new ApiException(status, "unavailable");
      var result = analyze(provider, LABEL);
      var address = result.path("address");
      assertEquals(status == 0 ? "not_found" : "unavailable", text(address, "resolution"));
      assertEquals("manual", text(address, "provider"));
      assertEquals("город Минск", text(address, "settlement"));
      assertEquals("ул. Брикета", text(address, "street"));
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
      ((ObjectNode) provider.upstream.response.get(0).path("data"))
          .put(pair.getKey(), pair.getValue());
      var result = analyze(provider, LABEL);
      assertFalse(result.path("address").path("confirmed").asBoolean(), pair.getKey());
      assertEquals(1, provider.upstream.queries.size());
    }
  }

  @Test
  void ambiguousOrIncompleteEvidenceNeverSelectsFirstSuggestion() {
    var provider = new Provider();
    provider.upstream.response = array(List.of(raw(), raw()));
    assertEquals("ambiguous", text(analyze(provider, LABEL).path("address"), "resolution"));
    assertEquals(1, provider.upstream.queries.size());
    provider = new Provider();
    assertFalse(
        analyze(provider, "город Минск, ул. Брикета")
            .path("address")
            .path("confirmed")
            .asBoolean());
    assertEquals(1, provider.upstream.queries.size());
  }

  @Test
  void confirmationChangeCannotSilentlyAddACorpus() {
    var provider = new Provider();
    var changed = raw();
    ((ObjectNode) changed.path("data")).put("block", "2");
    provider.upstream.confirmation = array(List.of(changed));
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
            by.autopost.rental.ai.AiCard.of(catalog.reference()),
            "Сдам квартиру",
            object("address", object("label", LABEL, "quote", LABEL)));
    new RentalAiAddressResolver(provider).resolve("workspace", result);
    assertTrue(provider.upstream.queries.isEmpty());
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
              LiteralAddress.parse(label, object()), DadataSuggestion.parse(raw()).address()),
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
    assertTrue(LiteralAddress.matches(parsed, DadataSuggestion.parse(raw()).address()));
    assertEquals("", text(parsed, "district"));
    assertEquals("", text(parsed, "block"));
    assertFalse(parsed.has("sourceId"));
  }
}
