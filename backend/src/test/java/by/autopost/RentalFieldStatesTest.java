package by.autopost;

import static by.autopost.shared.Json.*;
import static org.junit.jupiter.api.Assertions.*;

import by.autopost.rental.application.FieldStates;
import by.autopost.rental.application.RentalCatalog;
import by.autopost.rental.catalog.FileReferenceRepository;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.util.List;
import java.util.Map;
import java.util.stream.Collectors;
import org.junit.jupiter.api.Test;

/** The card fields the editor shows: the server decides with the preparation of the check. */
class RentalFieldStatesTest {
  final RentalCatalog catalog =
      new RentalCatalog(new FileReferenceRepository("../data/rental/apartments_long_term_rent"));

  Map<String, FieldStates.FieldState> fields(ObjectNode values, String... platforms) {
    return catalog
        .fields(
            RentalJson.card(
                object("modelVersion", 2, "values", values, "platforms", List.of(platforms))))
        .fields()
        .stream()
        .collect(Collectors.toMap(FieldStates.FieldState::id, state -> state));
  }

  @Test
  void aFieldThatDependsOnANumberIsShownWhereItsNativeFieldApplies() {
    // Realt asks for separate rooms when its room count (a number code) is 2 or more.
    assertTrue(fields(object("rental.room_configuration", "2"), "realt").containsKey("rental.separate_rooms"));
    assertFalse(fields(object("rental.room_configuration", "1"), "realt").containsKey("rental.separate_rooms"));
    // Not known yet: the field stays, as preparation waits for the room count.
    assertTrue(fields(object(), "realt").containsKey("rental.separate_rooms"));
  }

  @Test
  void fieldsOfPlatformsThatAreNotChosenAreNotShown() {
    var realt = fields(object(), "realt");
    var kufar = fields(object(), "kufar");
    assertTrue(realt.containsKey("rental.kitchen_area"));
    // Realt enters the kitchen area by hand; Kufar's form receives it.
    assertFalse(realt.get("rental.kitchen_area").transferred());
    assertTrue(kufar.get("rental.kitchen_area").transferred());
    var none = fields(object());
    for (var state : none.values())
      // Only fields no platform maps are left, and they are not marked.
      assertTrue(state.transferred(), state.id());
    assertFalse(none.containsKey("rental.kitchen_area"));
  }

  @Test
  void aFieldIsRequiredWhereAChosenPlatformRequiresItAndItsOptionsComeWithIt() {
    var kufar = fields(object(), "kufar");
    assertTrue(kufar.get("listing.title").required(), kufar.get("listing.title").toString());
    assertFalse(kufar.get("rental.currency").choices().isEmpty());
    assertTrue(kufar.get("listing.title").choices().isEmpty());
  }
}
