package by.autopost;

import static by.autopost.Json.*;
import static org.junit.jupiter.api.Assertions.*;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.*;
import java.util.*;
import org.junit.jupiter.api.Test;

class AddressServiceTest {
  JsonNode item(String country, String id, String house) {
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

  class Fake extends AddressService {
    int calls = 0;
    JsonNode response = array(List.of(item("BY", "way:example", "1")));

    Fake() {
      super("not-a-real-key", "", "");
    }

    @Override
    JsonNode fetch(String query, int count) {
      calls++;
      return response;
    }
  }

  @Test
  void cachesQueriesAndScopesSelectionToWorkspace() {
    var service = new Fake();
    var result = service.suggest("a", "Минск Примерная");
    service.suggest("a", "Минск Примерная");
    assertEquals(1, service.calls);
    String id = result.path("suggestions").get(0).path("id").asText();
    assertThrows(ApiException.class, () -> service.select("b", id));
    assertTrue(service.select("a", id).path("address").path("confirmed").asBoolean());
    assertEquals(2, service.calls);
  }

  @Test
  void foreignFiasMinusOneStillRepresentsBelarusHouse() {
    var value = AddressService.normalize(item("BY", "way:example", "1"));
    assertEquals("house", value.path("level").asText());
    assertEquals("1", value.path("house").asText());
    assertEquals("way:example", value.path("sourceId").asText());
  }

  @Test
  void filtersForeignResultsAndRejectsChangedSelection() {
    var service = new Fake();
    service.response = array(List.of(item("RU", "foreign", "1")));
    assertTrue(service.suggest("a", "Минск дом").path("suggestions").isEmpty());
    service.response = array(List.of(item("BY", "original", "1")));
    String id = service.suggest("a", "Минск улица").path("suggestions").get(0).path("id").asText();
    service.response = array(List.of(item("BY", "different", "2")));
    assertThrows(ApiException.class, () -> service.select("a", id));
  }

  @Test
  void validatesQueryAndHasPerSecondBudget() {
    var service = new Fake();
    assertThrows(ApiException.class, () -> service.suggest("a", "М"));
    for (int i = 0; i < 10; i++) service.budget("a");
    assertThrows(ApiException.class, () -> service.budget("a"));
  }

  @Test
  void unchangedBuildingIdDoesNotPermitAChangedHouseNumber() {
    var service = new Fake();
    String id = service.suggest("a", "Минск улица").path("suggestions").get(0).path("id").asText();
    service.response = array(List.of(item("BY", "way:example", "2")));
    assertThrows(ApiException.class, () -> service.select("a", id));
  }

  @Test
  void relayUsesItsOwnCredentialAndWorksWithoutProviderKey() {
    String token = "relay-test-token-".repeat(3);
    var service = new AddressService("", "https://relay.example/suggest", token);
    assertTrue(service.configured());
    var request = service.buildRequest("Минск Примерная 1", 8);
    assertEquals("https://relay.example/suggest", request.uri().toString());
    assertEquals("Bearer " + token, request.headers().firstValue("Authorization").orElseThrow());
    var withKey = new AddressService("provider-secret", "https://relay.example/suggest", token);
    assertFalse(withKey.buildRequest("Минск", 1).headers().toString().contains("provider-secret"));
    var direct = new AddressService("provider-secret", "", "");
    assertEquals("Token provider-secret", direct.buildRequest("Минск", 1).headers().firstValue("Authorization").orElseThrow());
  }

  @Test
  void invalidRelayConfigurationFailsClosed() {
    for (String url : List.of("http://relay.example/suggest", "https://user:pass@relay.example/suggest", "https://relay.example/suggest?key=value", "https://relay.example/suggest#key"))
      assertThrows(IllegalArgumentException.class, () -> new AddressService("key", url, "x".repeat(48)));
    assertThrows(IllegalArgumentException.class, () -> new AddressService("key", "https://relay.example/suggest", "short"));
    assertFalse(new AddressService("", "", "").configured());
  }
}
