package by.autopost;

import static by.autopost.shared.Json.*;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

import by.autopost.ai.AiGateway;
import by.autopost.rental.ai.*;
import by.autopost.rental.application.RentalCatalog;
import by.autopost.rental.catalog.CategoryRegistry;
import by.autopost.shared.ApiException;
import java.util.List;
import org.junit.jupiter.api.Test;

class RentalAiCopyTest {
  private final RentalCatalog catalog = new RentalCatalog(new CategoryRegistry("../data/rental")
      .require("houses_long_term_rent").references());
  private final String source = "Сдам дом целиком на длительный срок. Цена 650 USD. Собственник.";

  @Test
  void fillsMissingCopyWithoutAllowingRetryToReplaceVerifiedPrice() {
    var ai = mock(AiGateway.class);
    when(ai.serverJson(anyString(), anyString(), eq(source))).thenReturn(
        object("suggestions", List.of(object("field", "rental.monthly_price", "value", "650", "quote", "650 USD"))),
        object("suggestions", List.of(
            object("field", "listing.title", "value", "Дом целиком на длительный срок", "quote", "Сдам дом целиком на длительный срок"),
            object("field", "rental.monthly_price", "value", "700", "quote", "650 USD"))));
    var service = new RentalAiService(ai, mock(RentalAiAddressResolver.class));
    var result = service.analyze(catalog, "house_rental", "qa", "qa",
        object("text", source, "schemaVersion", catalog.version()));
    assertEquals(List.of("rental.monthly_price", "listing.title"), result.path("suggestions").findValuesAsText("field"));
    assertEquals("650", text(result.path("suggestions").get(0), "value"));
    verify(ai, times(2)).serverJson(anyString(), anyString(), eq(source));
  }

  @Test
  void copyFailureKeepsFactsAndExplainsMissingTitle() {
    var ai = mock(AiGateway.class);
    when(ai.serverJson(anyString(), anyString(), eq(source))).thenReturn(
        object("suggestions", List.of(object("field", "rental.monthly_price", "value", "650", "quote", "650 USD"))))
        .thenThrow(new ApiException(502, "Provider unavailable"));
    var result = new RentalAiService(ai, mock(RentalAiAddressResolver.class)).analyze(catalog,
        "house_rental", "qa", "qa", object("text", source, "schemaVersion", catalog.version()));
    assertEquals("650", text(result.path("suggestions").get(0), "value"));
    assertTrue(result.path("questions").toString().contains("заголовок"));
  }

  @Test
  void rejectedListingDoesNotTriggerCopyGeneration() {
    var ai = mock(AiGateway.class);
    when(ai.serverJson(anyString(), anyString(), anyString())).thenReturn(object("suggestions", List.of()));
    new RentalAiService(ai, mock(RentalAiAddressResolver.class)).analyze(catalog,
        "house_rental", "qa", "qa", object("text", source, "schemaVersion", catalog.version()));
    verify(ai).serverJson(anyString(), anyString(), eq(source));
  }
}
