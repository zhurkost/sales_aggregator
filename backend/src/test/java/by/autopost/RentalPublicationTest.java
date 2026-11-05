package by.autopost;

import static by.autopost.shared.Json.*;
import static org.junit.jupiter.api.Assertions.*;

import by.autopost.rental.application.*;
import by.autopost.rental.catalog.*;
import by.autopost.rental.engine.Transfer;
import by.autopost.rental.model.FormRecipe;
import by.autopost.shared.ApiException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.nio.file.Path;
import java.util.*;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

class RentalPublicationTest {
  @TempDir Path dir;

  final RentalCatalog catalog =
      new RentalCatalog(new FileReferenceRepository("../data/rental/apartments_long_term_rent"));

  ObjectNode partial() {
    return object(
        "cardVersion",
        catalog.cardVersion(),
        "modelVersion",
        2,
        "values",
        object(
            "listing.description",
            "Сдам квартиру на длительный срок",
            "rental.monthly_rent",
            "0",
            "rental.currency",
            "BYN"),
        "extras",
        object(),
        "platforms",
        List.of("kufar", "onliner", "realt", "domovita"),
        "address",
        object(
            "label",
            "Минск, Ленина, 10",
            "settlement",
            "Минск",
            "street",
            "Ленина",
            "house",
            "10",
            "confirmed",
            true));
  }

  @Test
  void missingRequiredFieldsDoNotBlockAnySelectedPlatformAndAddressesAreQueriesNotCodes() {
    var draft = partial();
    var check = RentalJson.prepare(catalog, draft, 0);
    assertTrue(
        list(check.path("platforms")).stream().anyMatch(p -> !p.path("checksPassed").asBoolean()));
    var launch = RentalJson.browser(catalog, draft, 0);
    assertEquals(4, launch.path("jobs").size());
    for (var job : launch.path("jobs")) {
      var prepared =
          list(check.path("platforms")).stream()
              .filter(p -> text(p, "platform").equals(text(job, "platform")))
              .findFirst()
              .orElseThrow();
      assertEquals(prepared.path("checksPassed"), job.path("checksPassed"), text(job, "platform"));
      assertTrue(text(job, "startUrl").startsWith("https://"));
      var controls = list(job.path("controls"));
      assertTrue(controls.stream().anyMatch(c -> text(c, "action").equals("files")));
      assertTrue(
          controls.stream()
              .anyMatch(c -> c.has("addressPart") && text(c, "value").contains("Минск")));
      assertFalse(
          controls.stream()
              .anyMatch(c -> text(c, "name").equals("Телефон") && text(c, "value").isBlank()));
    }
  }

  @Test
  void browserAddressKeepsTypesAndRegionalContextForUnambiguousSuggestions() {
    var draft = partial();
    ((ObjectNode) draft.path("address"))
        .put("settlement", "г Минск")
        .put("street", "ул Ольшевского")
        .put("region", "Минская обл")
        .put("district", "Минский р-н");
    var job =
        list(RentalJson.browser(catalog, draft, 0).path("jobs")).stream()
            .filter(j -> text(j, "platform").equals("realt"))
            .findFirst()
            .orElseThrow();
    var city =
        list(job.path("controls")).stream()
            .filter(c -> text(c, "field").equals("realt.settlement"))
            .findFirst()
            .orElseThrow();
    assertEquals("г Минск", text(city, "value"));
    assertEquals("Минская обл", city.path("matchContext").get(0).asText());
    assertEquals("Минский р-н", city.path("matchContext").get(1).asText());
    assertEquals("value-and-closed", text(city.path("autocomplete"), "confirm"));
  }

  @Test
  void cityRegionFromDadataDoesNotRejectTheCitySuggestion() {
    for (String region : List.of("г Минск", "г. Минск", "город Минск")) {
      var draft = partial();
      draft.set(
          "address",
          object(
              "provider",
              "dadata",
              "sourceId",
              "way:25439815",
              "label",
              "г Минск, ул Брикета, д 18",
              "countryIso",
              "BY",
              "region",
              region,
              "district",
              "",
              "settlement",
              "г Минск",
              "street",
              "ул Брикета",
              "house",
              "18",
              "block",
              "",
              "blockType",
              "",
              "precision",
              "0",
              "confirmed",
              false,
              "level",
              "house",
              "longitude",
              "27.4150416",
              "latitude",
              "53.908548"));
      var addressBefore = draft.path("address").deepCopy();
      var job =
          list(RentalJson.browser(catalog, draft, 0).path("jobs")).stream()
              .filter(j -> text(j, "platform").equals("realt"))
              .findFirst()
              .orElseThrow();
      var controls = list(job.path("controls"));
      var city =
          controls.stream()
              .filter(c -> text(c, "field").equals("realt.settlement"))
              .findFirst()
              .orElseThrow();
      assertFalse(city.has("matchContext"), "City-region is already checked against primary label");
      assertEquals("г Минск", text(city, "value"));
      assertTrue(
          controls.stream()
              .anyMatch(
                  c ->
                      text(c, "field").equals("realt.street")
                          && text(c, "value").equals("ул Брикета")));
      assertTrue(
          controls.stream()
              .anyMatch(
                  c ->
                      text(c, "field").equals("realt.house_number")
                          && text(c, "value").equals("18")));
      assertEquals(addressBefore, draft.path("address"));
    }
  }

  @Test
  void onlySavedSnapshotInOwnWorkspaceCanBeLaunched() {
    var storage = RentalStorage.at(dir.resolve("drafts.sqlite"));
    var service = storage.publicationService(catalog);
    var draft = partial();
    String id = UUID.randomUUID().toString();
    for (int revision = 0; revision < 3; revision++)
      storage.draftService().save("owner", id, revision, RentalJson.document(draft));
    var request = object("id", id, "draft", draft.deepCopy());
    assertEquals(3, launch(service, "owner", request).path("revision").asInt());
    assertEquals(
        404,
        assertThrows(ApiException.class, () -> launch(service, "other", request)).status);
    ((ObjectNode) request.path("draft").path("values"))
        .put("listing.description", "Изменено после сохранения");
    assertEquals(
        409,
        assertThrows(ApiException.class, () -> launch(service, "owner", request)).status);
  }

  @Test
  void theLaunchCarriesThePhotosStoredWithTheCardInTheirOrder() {
    var storage = RentalStorage.at(dir.resolve("drafts.sqlite"));
    var draft = partial();
    String id = UUID.randomUUID().toString();
    storage.draftService().save("owner", id, 0, RentalJson.document(draft));
    var request = object("id", id, "draft", draft);
    var service = storage.publicationService(catalog);
    assertTrue(launch(service, "owner", request).path("photos").isEmpty());
    var added =
        storage
            .photoService()
            .add(
                "owner",
                id,
                1,
                List.of(RentalPhotoTest.jpeg("room.jpg"), RentalPhotoTest.jpeg("kitchen.jpg")));
    var ids = added.photos().stream().map(p -> p.id()).toList();
    storage.photoService().reorder("owner", id, 2, List.of(ids.get(1), ids.get(0)));
    var launch = launch(service, "owner", request);
    // Photo changes are revisions of the card: the launch is of the revision that has them.
    assertEquals(3, launch.path("revision").asInt());
    var photos = list(launch.path("photos"));
    assertEquals(
        List.of(ids.get(1), ids.get(0)), photos.stream().map(p -> text(p, "id")).toList());
    assertEquals(
        List.of("kitchen.jpg", "room.jpg"), photos.stream().map(p -> text(p, "name")).toList());
    assertEquals(
        "data:image/jpeg;base64," + Base64.getEncoder().encodeToString(RentalPhotoTest.JPEG),
        text(photos.get(0), "dataUrl"));
  }

  /** A launch as the extension receives it. */
  static JsonNode launch(RentalPublicationService service, String workspace, JsonNode request) {
    return RentalJson.tree(
        service.configuration(
            workspace, text(request, "id"), RentalJson.card(request.path("draft"))));
  }

  /** A committed form recipe as written, for an edit the loader would have to reject. */
  static ObjectNode recipe(String platform) {
    try {
      return (ObjectNode)
          MAPPER.readTree(
              Path.of("../data/rental/apartments_long_term_rent/runtime/browser_" + platform + ".json")
                  .toFile());
    } catch (java.io.IOException e) {
      throw new java.io.UncheckedIOException(e);
    }
  }

  /** A recipe as the loader checks it: parsed into records, then against its schema. */
  static void validate(ReferenceSnapshot snapshot, String platform, JsonNode recipe) {
    new BrowserRecipeValidator()
        .validate(platform, snapshot.schema(platform), ReferenceJson.parse(recipe, FormRecipe.class));
  }

  static JsonNode platform(JsonNode prepared, String id) {
    return list(prepared.path("platforms")).stream()
        .filter(p -> text(p, "platform").equals(id))
        .findFirst()
        .orElseThrow();
  }

  static List<String> codes(JsonNode platform, String field) {
    return list(platform.path("issues")).stream()
        .filter(i -> text(i, "field").equals(field))
        .map(i -> text(i, "code"))
        .toList();
  }

  @Test
  void aPlatformThatRequiresPhotosGetsARemarkWhenTheCardHasNone() {
    var draft = partial();
    // Links in the card never reach a file input: only stored photos count.
    ((ObjectNode) draft.path("values"))
        .set("media.images", array().add("https://example.com/room.jpg"));
    // The source schemas of Onliner, Realt and Domovita require photos; Kufar's says null.
    Map<String, String> photoField =
        Map.of(
            "kufar", "kufar.photos",
            "onliner", "onliner.images",
            "realt", "realt.photos",
            "domovita", "domovita.images");
    var none = RentalJson.prepare(catalog, draft, 0);
    for (var entry : photoField.entrySet()) {
      var result = platform(none, entry.getKey());
      var codes = codes(result, entry.getValue());
      assertFalse(codes.contains("required"), entry.getKey());
      assertEquals(
          !entry.getKey().equals("kufar"), codes.contains("photos_required"), entry.getKey());
      assertTrue(
          list(result.path("form")).stream()
              .noneMatch(v -> text(v, "field").equals(entry.getValue())),
          entry.getKey());
    }
    var remark =
        list(platform(none, "realt").path("issues")).stream()
            .filter(i -> text(i, "code").equals("photos_required"))
            .findFirst()
            .orElseThrow();
    assertEquals("photos", text(remark, "source"));
    assertEquals(
        "Добавьте фотографии квартиры: площадка не публикует объявление без фото.",
        text(remark, "message"));
    assertFalse(platform(none, "realt").path("checksPassed").asBoolean());
    for (var job : RentalJson.browser(catalog, draft, 0).path("jobs"))
      if (!text(job, "platform").equals("kufar"))
        assertFalse(job.path("checksPassed").asBoolean(), text(job, "platform"));
    var three = RentalJson.prepare(catalog, draft, 3);
    for (var entry : photoField.entrySet()) {
      var result = platform(three, entry.getKey());
      assertFalse(codes(result, entry.getValue()).contains("photos_required"), entry.getKey());
      var photos =
          list(result.path("form")).stream()
              .filter(v -> text(v, "field").equals(entry.getValue()))
              .toList();
      assertEquals(1, photos.size(), entry.getKey());
      assertEquals("3 фото", text(photos.get(0), "text"));
    }
  }

  @Test
  void aCardWithStoredPhotosPassesThePhotoCheckOfTheLaunch() {
    var storage = RentalStorage.at(dir.resolve("drafts.sqlite"));
    var draft = partial();
    draft.set("platforms", array().add("onliner"));
    String id = UUID.randomUUID().toString();
    storage.draftService().save("owner", id, 0, RentalJson.document(draft));
    var service = storage.publicationService(catalog);
    var request = object("id", id, "draft", draft);
    var before = launch(service, "owner", request).path("jobs").get(0);
    assertFalse(before.path("checksPassed").asBoolean());
    storage.photoService().add("owner", id, 1, List.of(RentalPhotoTest.jpeg("room.jpg")));
    var check = RentalJson.prepare(catalog, draft, 1).path("platforms").get(0);
    var after = launch(service, "owner", request).path("jobs").get(0);
    assertEquals(check.path("checksPassed"), after.path("checksPassed"));
    assertTrue(codes(check, "onliner.images").isEmpty(), check.toString());
  }

  @Test
  void savedCardOfAnOldModelIsNeverPublished() {
    var storage = RentalStorage.at(dir.resolve("drafts.sqlite"));
    var drafts = storage.draftService();
    var old = partial();
    old.remove("modelVersion");
    String id = UUID.randomUUID().toString();
    drafts.save("owner", id, 0, RentalJson.document(old));
    var service = storage.publicationService(catalog);
    var error =
        assertThrows(
            ApiException.class,
            () -> launch(service, "owner", object("id", id, "draft", old)));
    assertEquals(409, error.status);
    assertEquals("Карточку нужно перенести командой миграции.", error.getMessage());
    assertThrows(ApiException.class, () -> RentalJson.browser(catalog, old, 0));
  }

  @Test
  void browserRecipeRejectsKeysAndTypesTheExtensionDoesNotRead() {
    var snapshot =
        new FileReferenceRepository("../data/rental/apartments_long_term_rent").snapshot();
    Map<String, java.util.function.Consumer<ObjectNode>> unknown =
        Map.of(
            "selectedClas",
            r -> control(r, "kufar.rooms").put("selectedClas", "chip__filled-green"),
            "observedAt",
            r -> r.put("observedAt", "2026-11-02"),
            "optionsSelector",
            r -> control(r, "kufar.title").put("optionsSelector", "[role=option]"),
            "matchText",
            r -> ((ObjectNode) r.path("submit").get(0)).put("matchText", false),
            "script",
            r -> ((ObjectNode) r.path("ready").get(0)).put("script", "alert(1)"));
    for (var edit : unknown.entrySet()) {
      var recipe = recipe("kufar");
      edit.getValue().accept(recipe);
      var error =
          assertThrows(
              ApiException.class,
              () ->
                  validate(snapshot, "kufar", recipe),
              edit.getKey());
      assertTrue(
          error.getMessage().contains("неизвестный ключ " + edit.getKey()), error.getMessage());
    }
    List<java.util.function.Consumer<ObjectNode>> mistyped =
        List.of(
            r -> ((ObjectNode) r.path("ready").get(0)).put("absent", "yes"),
            r -> control(r, "kufar.rooms").put("selectedClass", "chip filled"),
            r -> control(r, "kufar.rooms").put("label", ""),
            r -> control(r, "kufar.floor").set("uiLabels", object("BYR", 1)),
            r -> control(r, "kufar.floor").put("displaySelector", ""),
            r -> ((ObjectNode) r.path("setup").get(0)).put("matchText", "false"));
    for (var edit : mistyped) {
      var recipe = recipe("kufar");
      edit.accept(recipe);
      assertThrows(
          ApiException.class,
          () -> validate(snapshot, "kufar", recipe));
    }
  }

  @Test
  void checkSaysWhatGoesToTheFormAndWhatIsEnteredByHand() {
    var draft = partial();
    ((ObjectNode) draft.path("values"))
        .put("listing.title", "Двухкомнатная у метро")
        .put("rental.kitchen_area", "9")
        .put("location.metro_1_station", "Немига");
    draft.set("platforms", array().add("realt"));
    var realt = RentalJson.prepare(catalog, draft, 0).path("platforms").get(0);
    var form = list(realt.path("form"));
    var title =
        form.stream().filter(v -> text(v, "field").equals("realt.title")).findFirst().orElseThrow();
    assertEquals("Заголовок", text(title, "name"));
    assertEquals("Двухкомнатная у метро", text(title, "text"));
    // The address goes to the form through its own controls, from the confirmed address.
    var settlement =
        form.stream()
            .filter(v -> text(v, "field").equals("realt.settlement"))
            .findFirst()
            .orElseThrow();
    assertEquals("Минск", text(settlement, "text"));
    // Constants chosen by the setup steps are not values of the card.
    assertTrue(form.stream().noneMatch(v -> text(v, "field").equals("realt.deal_type")));
    var manual = list(realt.path("manual"));
    assertEquals(
        List.of("realt.kitchen_area"),
        manual.stream().map(v -> text(v, "field")).filter(f -> f.contains("kitchen")).toList());
    var kitchen =
        manual.stream()
            .filter(v -> text(v, "field").equals("realt.kitchen_area"))
            .findFirst()
            .orElseThrow();
    assertEquals("Площадь кухни, м²", text(kitchen, "name"));
    assertEquals("9", kitchen.path("text").asText());
    assertTrue(text(kitchen, "reason").contains("«Все параметры»"), kitchen.toString());
    assertTrue(form.stream().noneMatch(v -> text(v, "field").equals("realt.kitchen_area")));
    // The extension lists exactly the manual fields as not transferred.
    var job = RentalJson.browser(catalog, draft, 0).path("jobs").get(0);
    assertEquals(
        manual.stream().map(v -> text(v, "name")).toList(),
        list(job.path("unbound")).stream().map(JsonNode::asText).toList());
  }

  @Test
  void realtTitleAndDescriptionGoToTheirFormElements() {
    var draft = partial();
    ((ObjectNode) draft.path("values"))
        .put("listing.title", "Двухкомнатная у метро")
        .put("listing.description", "Светлая квартира & балкон.\nВторая строка");
    draft.set("platforms", array().add("realt"));
    var controls = list(RentalJson.browser(catalog, draft, 0).path("jobs").get(0).path("controls"));
    var title = controls.stream().filter(c -> text(c, "field").equals("realt.title")).findFirst();
    assertEquals("[id=\"description.title\"]", text(title.orElseThrow(), "selector"));
    assertEquals("text", text(title.orElseThrow(), "action"));
    assertEquals("Двухкомнатная у метро", text(title.orElseThrow(), "value"));
    var description =
        controls.stream().filter(c -> text(c, "field").equals("realt.description")).findFirst();
    assertEquals("iframe_richtext", text(description.orElseThrow(), "action"));
    assertEquals(
        "[id=\"description.description_ifr\"]", text(description.orElseThrow(), "selector"));
    assertEquals(
        "<p>Светлая квартира &amp; балкон.<br>Вторая строка</p>",
        text(description.orElseThrow(), "value"));
    var coverage =
        new FileReferenceRepository("../data/rental/apartments_long_term_rent")
            .snapshot()
            .coverage("realt");
    for (String field : List.of("realt.title", "realt.description"))
      assertEquals(Transfer.TRANSFERRED, coverage.row(field).orElseThrow().transfer(), field);
  }

  @Test
  void richTextInAnIframeIsAKnownActionWithoutExtraKeys() {
    var snapshot =
        new FileReferenceRepository("../data/rental/apartments_long_term_rent").snapshot();
    var recipe = recipe("realt");
    var description =
        object(
            "field",
            "realt.description",
            "action",
            "iframe_richtext",
            "selector",
            "[id=\"description.description_ifr\"]");
    var controls = (com.fasterxml.jackson.databind.node.ArrayNode) recipe.path("controls");
    for (int i = controls.size() - 1; i >= 0; i--)
      if (text(controls.get(i), "field").equals("realt.description")) controls.remove(i);
    controls.add(description);
    assertDoesNotThrow(
        () -> validate(snapshot, "realt", recipe));
    description.put("frameSelector", "body#tinymce");
    var error =
        assertThrows(
            ApiException.class,
            () -> validate(snapshot, "realt", recipe));
    assertTrue(error.getMessage().contains("неизвестный ключ frameSelector"), error.getMessage());
  }

  static ObjectNode control(ObjectNode recipe, String field) {
    return (ObjectNode)
        list(recipe.path("controls")).stream()
            .filter(control -> text(control, "field").equals(field))
            .findFirst()
            .orElseThrow();
  }

  @Test
  void browserContractRejectsUnknownFieldsAndExecutableActions() {
    var snapshot =
        new FileReferenceRepository("../data/rental/apartments_long_term_rent").snapshot();
    var recipe = recipe("kufar");
    ((ObjectNode) recipe.path("controls").get(0)).put("action", "eval");
    assertThrows(
        ApiException.class,
        () -> validate(snapshot, "kufar", recipe));
    var other = recipe("kufar");
    ((ObjectNode) other.path("controls").get(0)).put("field", "unknown");
    assertThrows(
        ApiException.class,
        () -> validate(snapshot, "kufar", other));
    var invalidAddress = recipe("realt");
    ((ObjectNode) invalidAddress.path("controls").get(0).path("autocomplete"))
        .put("optionSelector", "");
    assertThrows(
        ApiException.class,
        () ->
            validate(snapshot, "realt", invalidAddress));
  }
}
