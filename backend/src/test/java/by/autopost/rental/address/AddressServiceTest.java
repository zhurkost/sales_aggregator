package by.autopost.rental.address;

import static by.autopost.shared.Json.*;
import static org.junit.jupiter.api.Assertions.*;

import by.autopost.shared.ApiException;
import com.fasterxml.jackson.databind.JsonNode;
import java.util.*;
import org.junit.jupiter.api.Test;

class AddressServiceTest {
  static JsonNode item(String country, String id, String house) {
    return object(
        "value",
        "г Минск, улица Примерная, д " + house,
        "unrestricted_value",
        "Беларусь, Минск, Примерная " + house,
        "data",
        object(
            "country_iso_code",
            country,
            "city",
            "Минск",
            "street",
            "Примерная",
            "street_with_type",
            "ул Примерная",
            "house",
            house,
            "fias_id",
            id,
            "fias_level",
            "-1",
            "geo_lat",
            "53.9",
            "geo_lon",
            "27.5",
            "qc_geo",
            "0"));
  }

  /** Replaces the HTTP transport; every call is counted. */
  static class Fake implements AddressProvider {
    int calls = 0;
    JsonNode response = array(List.of(item("BY", "way:example", "1")));

    @Override
    public synchronized List<DadataSuggestion> suggest(String query, int count) {
      calls++;
      List<DadataSuggestion> result = new ArrayList<>();
      for (var item : response) result.add(DadataSuggestion.parse(item));
      return result;
    }
  }

  long now = 1_800_000_000_000L;

  AddressService service(Fake fake) {
    return new AddressService(fake, () -> now);
  }

  @Test
  void cachesQueriesAndScopesSelectionToWorkspace() {
    var fake = new Fake();
    var service = service(fake);
    var result = service.suggest("a", "Минск Примерная");
    service.suggest("a", "Минск Примерная");
    assertEquals(1, fake.calls);
    String id = result.path("suggestions").get(0).path("id").asText();
    assertThrows(ApiException.class, () -> service.select("b", id));
    assertTrue(service.select("a", id).path("address").path("confirmed").asBoolean());
    assertEquals(2, fake.calls);
  }

  @Test
  void foreignFiasMinusOneStillRepresentsBelarusHouse() {
    var value = DadataSuggestion.parse(item("BY", "way:example", "1")).address();
    assertEquals("house", value.path("level").asText());
    assertEquals("1", value.path("house").asText());
    assertEquals("way:example", value.path("sourceId").asText());
  }

  @Test
  void filtersForeignResultsAndRejectsChangedSelection() {
    var fake = new Fake();
    var service = service(fake);
    fake.response = array(List.of(item("RU", "foreign", "1")));
    assertTrue(service.suggest("a", "Минск дом").path("suggestions").isEmpty());
    fake.response = array(List.of(item("BY", "original", "1")));
    String id = service.suggest("a", "Минск улица").path("suggestions").get(0).path("id").asText();
    fake.response = array(List.of(item("BY", "different", "2")));
    assertThrows(ApiException.class, () -> service.select("a", id));
  }

  @Test
  void validatesQueryAndHasPerSecondBudget() {
    var service = service(new Fake());
    assertThrows(ApiException.class, () -> service.suggest("a", "М"));
    for (int i = 0; i < 10; i++) service.suggest("w" + i, "Минск запрос " + i);
    var limited =
        assertThrows(ApiException.class, () -> service.suggest("w10", "Минск запрос 10"));
    assertEquals(429, limited.status);
  }

  @Test
  void unchangedBuildingIdDoesNotPermitAChangedHouseNumber() {
    var fake = new Fake();
    var service = service(fake);
    String id = service.suggest("a", "Минск улица").path("suggestions").get(0).path("id").asText();
    fake.response = array(List.of(item("BY", "way:example", "2")));
    assertThrows(ApiException.class, () -> service.select("a", id));
  }

  @Test
  void relayUsesItsOwnCredentialAndWorksWithoutProviderKey() {
    String token = "relay-test-token-".repeat(3);
    var client = new DadataClient("", "https://relay.example/suggest", token);
    assertTrue(client.configured());
    var request = client.buildRequest("Минск Примерная 1", 8);
    assertEquals("https://relay.example/suggest", request.uri().toString());
    assertEquals("Bearer " + token, request.headers().firstValue("Authorization").orElseThrow());
    var withKey = new DadataClient("provider-secret", "https://relay.example/suggest", token);
    assertFalse(withKey.buildRequest("Минск", 1).headers().toString().contains("provider-secret"));
    var direct = new DadataClient("provider-secret", "", "");
    assertEquals(
        "Token provider-secret",
        direct.buildRequest("Минск", 1).headers().firstValue("Authorization").orElseThrow());
  }

  @Test
  void invalidRelayConfigurationFailsClosed() {
    for (String url :
        List.of(
            "http://relay.example/suggest",
            "https://user:pass@relay.example/suggest",
            "https://relay.example/suggest?key=value",
            "https://relay.example/suggest#key"))
      assertThrows(
          IllegalArgumentException.class, () -> new DadataClient("key", url, "x".repeat(48)));
    assertThrows(
        IllegalArgumentException.class,
        () -> new DadataClient("key", "https://relay.example/suggest", "short"));
    assertFalse(new DadataClient("", "", "").configured());
    assertFalse(new AddressService(new DadataClient("", "", "")).configured());
  }
}
