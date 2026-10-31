package by.autopost;

import static by.autopost.Json.*;
import static org.junit.jupiter.api.Assertions.*;

import org.junit.jupiter.api.Test;

class DomainContractTest {
  @Test
  void matchesOriginalTypeScriptRulesForEveryCategory() throws Exception {
    Domain domain = new Domain();
    var fixtures = MAPPER.readTree(getClass().getResourceAsStream("/domain-contracts.json"));
    assertTrue(fixtures.size() > 300);
    for (var fixture : fixtures) {
      var input = fixture.path("input");
      String category = text(input.path("listing"), "taxonomyId");
      assertEquals(fixture.path("recipe"), domain.recipe(input), "recipe: " + category);
      assertEquals(
          fixture.path("attributes"),
          domain.attributes(
              input.path("listing"), input.path("attributes"), input.path("categoryOverrides")),
          "attributes: " + category);
      assertEquals(
          fixture.path("description").asText(),
          domain.description(
              input.path("listing"), input.path("attributes"), input.path("categoryOverrides")),
          "description: " + category);
    }
  }

  @Test
  void rejectsUnsafePublicationUrlsAndPrivateFeedAddresses() throws Exception {
    Domain domain = new Domain();
    assertEquals("", domain.safeUrl("kufar", "https://kufar.by.evil.example/"));
    assertEquals("", domain.safeUrl("kufar", "https://user@kufar.by/"));
    assertEquals("", domain.safeUrl("kufar", "http://kufar.by/"));
    assertEquals(
        "https://www.kufar.by/item/123",
        domain.safeUrl("kufar", "https://www.kufar.by/item/123#x"));
    for (String ip :
        new String[] {
          "127.0.0.1", "10.0.0.1", "169.254.169.254", "192.168.0.1", "100.64.0.1", "::1"
        }) assertFalse(FeedService.publicAddress(java.net.InetAddress.getByName(ip)));
    assertTrue(FeedService.publicAddress(java.net.InetAddress.getByName("8.8.8.8")));
  }
}
