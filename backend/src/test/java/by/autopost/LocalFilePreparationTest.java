package by.autopost;

import static by.autopost.shared.Json.*;
import static org.junit.jupiter.api.Assertions.*;

import by.autopost.rental.application.RentalCatalog;
import by.autopost.rental.catalog.FileReferenceRepository;
import by.autopost.shared.ApiException;
import java.util.List;
import org.junit.jupiter.api.Test;

class LocalFilePreparationTest {
  @Test
  void rentalAndSaleValidateSelectedLocalPhotosWithoutClaimingPublication() {
    for (String category : List.of("apartments_long_term_rent", "apartments_sale")) {
      var catalog = new RentalCatalog(new FileReferenceRepository("../data/rental/" + category));
      var card = object("schemaVersion", catalog.version(), "modelVersion", 2,
          "values", object(), "extras", object(), "platforms", List.of("onliner", "realt"));
      var before = catalog.prepare(card);
      assertTrue(list(before.path("platforms")).stream().anyMatch(p ->
          list(p.path("issues")).stream().anyMatch(i -> text(i,"source").equals("media.images")
              && text(i,"code").equals("required"))), category);
      card.set("localFileCounts", object("media.images", 1));
      var after = catalog.prepare(card);
      for (var platform : after.path("platforms")) {
        assertTrue(list(platform.path("issues")).stream().noneMatch(i ->
            text(i,"source").equals("media.images") && text(i,"code").equals("required")), category);
        assertTrue(list(platform.path("issues")).stream().anyMatch(i ->
            text(i,"source").equals("media.images") && text(i,"code").equals("file_acceptance")), category);
        assertFalse(platform.path("publicationReady").asBoolean());
      }
      card.set("localFileCounts", object());
      assertEquals(before, catalog.prepare(card), "Removing local files restores the original validation");
      card.set("localFileCounts", object("media.images", "1"));
      assertThrows(ApiException.class, () -> catalog.prepare(card));
      card.set("localFileCounts", object("listing.description", 1));
      assertThrows(ApiException.class, () -> catalog.prepare(card));
    }
  }
}
