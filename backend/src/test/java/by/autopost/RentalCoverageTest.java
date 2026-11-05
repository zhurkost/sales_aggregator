package by.autopost;

import static by.autopost.shared.Json.*;
import static org.junit.jupiter.api.Assertions.*;

import by.autopost.rental.application.FieldStates;
import by.autopost.rental.application.RentalCatalog;
import by.autopost.rental.catalog.*;
import by.autopost.rental.engine.*;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.*;
import java.nio.file.*;
import java.util.*;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

/** Coverage of a plan by its form recipe, computed when the bundle is loaded. */
class RentalCoverageTest {
  static final String COMMITTED = "../data/rental/apartments_long_term_rent";
  @TempDir Path dir;

  @Test
  void everyPlanFieldGetsOneStatusFromItsRecipe() throws Exception {
    fixture();
    var schema = read("example.schema.json");
    for (String id : List.of("kind", "region", "street"))
      ((ArrayNode) schema.get(0).path("options")).add(field(id));
    write("example.schema.json", schema);
    var plan = (ObjectNode) read("example.plan.json");
    plan.set("constants", object("kind", "flat"));
    plan.set("deferred_fields", object("region", "Площадка выводит регион из адреса."));
    plan.set(
        "addresses",
        array(
            List.of(
                object(
                    "platform_option_id", "street", "part", "street", "scalar_verified", false))));
    write("example.plan.json", plan);
    var recipe = (ObjectNode) read("example.browser.json");
    ((ArrayNode) recipe.path("controls"))
        .add(
            object(
                "field",
                "street",
                "action",
                "text",
                "selector",
                "#street",
                "addressPart",
                "street"));
    write("example.browser.json", recipe);

    var coverage = load().snapshot().coverage("example");
    assertEquals(
        List.of("rent", "currency", "street", "kind", "region"),
        coverage.rows().stream().map(CoverageRow::field).toList());
    var rent = coverage.row("rent").orElseThrow();
    assertEquals(List.of("rental.price"), rent.sources());
    assertEquals("text input[name=rent]", rent.element());
    assertEquals(Transfer.TRANSFERRED, rent.transfer());
    var street = coverage.row("street").orElseThrow();
    assertEquals(List.of("address.street"), street.sources());
    assertEquals("street", street.addressPart());
    assertEquals(Transfer.TRANSFERRED, street.transfer());
    var kind = coverage.row("kind").orElseThrow();
    assertEquals(Transfer.CONSTANT, kind.transfer());
    assertEquals("\"flat\"", kind.reason());
    var region = coverage.row("region").orElseThrow();
    assertEquals(Transfer.DEFERRED, region.transfer());
    assertEquals("Площадка выводит регион из адреса.", region.reason());
    assertEquals("", region.element());
    assertEquals(3, coverage.count(Transfer.TRANSFERRED));
  }

  @Test
  void aRowWithoutAControlIsManualOnlyWithAReason() throws Exception {
    fixture();
    withoutControl("currency");
    // Prepared, but neither filled nor marked: the bundle does not load, the plan is to fix.
    var error = assertThrows(ReferenceBundleException.class, this::load);
    assertTrue(
        error.getMessage().startsWith(dir.resolve("example.plan.json") + ": "), error.getMessage());
    assertTrue(error.getMessage().contains("не попадают в форму: currency"), error.getMessage());
    assertTrue(error.getMessage().contains("transfer: manual"), error.getMessage());
    var plan = (ObjectNode) read("example.plan.json");
    var currency = (ObjectNode) plan.path("fields").get(1);
    currency.put("transfer", "manual").put("manual_reason", "Валюту выбирают на площадке.");
    write("example.plan.json", plan);
    var row = load().snapshot().coverage("example").row("currency").orElseThrow();
    assertEquals(Transfer.MANUAL, row.transfer());
    assertEquals("Валюту выбирают на площадке.", row.reason());
    assertEquals(List.of("rental.currency"), row.sources());
  }

  @Test
  void manualMarkNeedsItsReasonAndNoControl() throws Exception {
    fixture();
    var original = (ObjectNode) read("example.plan.json");
    List<Map.Entry<String, java.util.function.Consumer<ObjectNode>>> broken =
        List.of(
            Map.entry(
                "transfer может быть только manual",
                row -> row.put("transfer", "form").put("manual_reason", "x")),
            Map.entry("требует причину manual_reason", row -> row.put("transfer", "manual")),
            Map.entry(
                "требует причину manual_reason",
                row -> row.put("transfer", "manual").put("manual_reason", " ")),
            Map.entry(
                "transfer может быть только manual",
                row -> row.put("manual_reason", "Нет элемента формы.")));
    for (var edit : broken) {
      var plan = original.deepCopy();
      edit.getValue().accept((ObjectNode) plan.path("fields").get(1));
      write("example.plan.json", plan);
      var error = assertThrows(ReferenceBundleException.class, this::load);
      assertTrue(error.getMessage().contains(edit.getKey()), error.getMessage());
    }
    // A manual field the recipe fills is a contradiction; the plan is the file to fix.
    var plan = original.deepCopy();
    ((ObjectNode) plan.path("fields").get(1))
        .put("transfer", "manual")
        .put("manual_reason", "Валюту выбирают на площадке.");
    write("example.plan.json", plan);
    var error = assertThrows(ReferenceBundleException.class, this::load);
    assertTrue(
        error.getMessage().startsWith(dir.resolve("example.plan.json") + ": "), error.getMessage());
    assertTrue(
        error.getMessage().contains("currency помечено transfer: manual, но его заполняет рецепт"),
        error.getMessage());
  }

  @Test
  void aFilledFieldNeedsWhatItDependsOn() throws Exception {
    fixture();
    withoutControl("currency");
    var plan = (ObjectNode) read("example.plan.json");
    ((ObjectNode) plan.path("fields").get(0).path("conversion"))
        .set("requires", array().add("currency"));
    ((ObjectNode) plan.path("fields").get(1))
        .put("transfer", "manual")
        .put("manual_reason", "Валюту выбирают на площадке.");
    write("example.plan.json", plan);
    var coverage = load().snapshot().coverage("example");
    assertTrue(coverage.needed().contains("rent"));
    // Entered by hand, but the rent the form receives is prepared with it.
    assertTrue(coverage.needed().contains("currency"));
    ((ObjectNode) plan.path("fields").get(0).path("conversion")).remove("requires");
    write("example.plan.json", plan);
    assertFalse(load().snapshot().coverage("example").needed().contains("currency"));
  }

  @Test
  void committedBundleHasOneStatusForEveryPlanField() throws Exception {
    var snapshot = new FileReferenceRepository(COMMITTED).snapshot();
    for (String platform : snapshot.platforms()) {
      var plan = snapshot.plan(platform);
      Set<String> planned = new LinkedHashSet<>();
      for (var row : plan.fields()) planned.add(row.platformOptionId());
      for (var row : plan.addresses()) planned.add(row.platformOptionId());
      for (var row : plan.coordinates()) planned.add(row.platformOptionId());
      planned.addAll(plan.constants().keySet());
      planned.addAll(plan.deferredFields().keySet());
      var coverage = snapshot.coverage(platform);
      assertEquals(
          planned,
          new LinkedHashSet<>(coverage.rows().stream().map(CoverageRow::field).toList()),
          platform);
      assertEquals(planned.size(), coverage.rows().size(), platform);
      for (var row : coverage.rows()) {
        assertNotNull(row.transfer(), row.field());
        assertFalse(row.name().isBlank(), row.field());
        assertEquals(row.inForm(), !row.element().isEmpty(), row.field());
      }
    }
  }

  @Test
  void committedBundlePromisesNothingItDoesNotTransfer() {
    var snapshot = new FileReferenceRepository(COMMITTED).snapshot();
    for (String platform : snapshot.platforms()) {
      var coverage = snapshot.coverage(platform);
      assertEquals(
          List.of(),
          coverage.rows().stream()
              .filter(row -> row.transfer() == Transfer.PREPARED_ONLY)
              .map(CoverageRow::field)
              .toList(),
          platform);
      for (var row : coverage.rows())
        if (row.transfer() == Transfer.MANUAL || row.transfer() == Transfer.DEFERRED)
          assertFalse(row.reason().isBlank(), row.field());
    }
  }

  @Test
  void theServerTellsForEachChosenPlatformWhetherItsFormNeedsACardField() {
    var catalog = new RentalCatalog(new FileReferenceRepository(COMMITTED));
    Map<String, Map<String, Boolean>> uses = new HashMap<>();
    for (String platform : catalog.reference().platforms())
      for (var state : fields(catalog, platform).fields())
        if (catalog.reference().plan(platform).fields().stream()
            .anyMatch(rule -> rule.sources().contains(state.id())))
          uses.computeIfAbsent(state.id(), id -> new TreeMap<>())
              .put(platform, state.transferred());
    assertEquals(Map.of("kufar", true, "realt", true), uses.get("listing.title"));
    assertEquals(
        Map.of("kufar", true, "realt", false, "domovita", true), uses.get("rental.kitchen_area"));
    // Metro reaches no form: Kufar and Realt choose stations from the address themselves.
    assertEquals(Map.of("kufar", false, "realt", false), uses.get("location.metro_1_station"));
    // The editor gets no rule of a platform: no mapping rows, conditions, codes or constants.
    String editor = RentalJson.editor(catalog).toString();
    for (String rule :
        List.of("uses", "rules", "conditions", "uiWhen", "bindings", "constants", "fill_rule"))
      assertFalse(editor.contains("\"" + rule + "\""), rule);
  }

  static FieldStates fields(RentalCatalog catalog, String platform) {
    return catalog.fields(
        RentalJson.card(object("modelVersion", 2, "values", object(), "platforms", List.of(platform))));
  }

  @Test
  void aFieldNeededByAFilledOneIsTransferredInTheEditor() throws Exception {
    fixture();
    withoutControl("currency");
    var plan = (ObjectNode) read("example.plan.json");
    ((ObjectNode) plan.path("fields").get(1))
        .put("transfer", "manual")
        .put("manual_reason", "Валюту выбирают на площадке.");
    write("example.plan.json", plan);
    assertFalse(currencyUse().path("transferred").asBoolean());
    ((ObjectNode) plan.path("fields").get(0).path("conversion"))
        .set("requires", array().add("currency"));
    write("example.plan.json", plan);
    // The rent the form receives is prepared with the currency of the card.
    assertTrue(currencyUse().path("transferred").asBoolean());
  }

  @Test
  void aFilledManualFieldTurnsOffTheAutomaticSubmission() throws Exception {
    fixture();
    withoutControl("currency");
    var schema = read("example.schema.json");
    ((ObjectNode) schema.get(0).path("options").get(1).path("fill_rule")).put("required", false);
    write("example.schema.json", schema);
    var plan = (ObjectNode) read("example.plan.json");
    ((ObjectNode) plan.path("fields").get(1))
        .put("transfer", "manual")
        .put("manual_reason", "Валюту выбирают на площадке.");
    write("example.plan.json", plan);
    var catalog = new RentalCatalog(load());
    java.util.function.Function<ObjectNode, ObjectNode> card =
        values ->
            object(
                "cardVersion",
                catalog.cardVersion(),
                "modelVersion",
                2,
                "values",
                values,
                "platforms",
                List.of("example"));
    // The manual field is empty: nothing would be lost, the checks pass.
    var empty = card.apply(object("rental.price", "1500"));
    var passed = RentalJson.prepare(catalog, empty, 0).path("platforms").get(0);
    assertTrue(passed.path("issues").isEmpty(), passed.toString());
    assertTrue(passed.path("checksPassed").asBoolean());
    assertTrue(
        RentalJson.browser(catalog, empty, 0).path("jobs").get(0).path("checksPassed").asBoolean());
    // A filled manual field would be missing from an automatically submitted ad.
    var filled = card.apply(object("rental.price", "1500", "rental.currency", "BYN"));
    var blocked = RentalJson.prepare(catalog, filled, 0).path("platforms").get(0);
    assertFalse(blocked.path("checksPassed").asBoolean());
    assertEquals(1, blocked.path("issues").size(), blocked.toString());
    var issue = blocked.path("issues").get(0);
    assertEquals("manual_fields", text(issue, "code"));
    assertEquals(
        "Часть заполненных полей нужно ввести на площадке вручную — автоматическая подача"
            + " выключена.",
        text(issue, "message"));
    assertEquals(1, blocked.path("manual").size());
    // The extension sees only checksPassed; the assisted launch still fills the form.
    var job = RentalJson.browser(catalog, filled, 0).path("jobs").get(0);
    assertFalse(job.path("checksPassed").asBoolean());
    assertEquals("rent", text(job.path("controls").get(0), "field"));
  }

  JsonNode currencyUse() {
    for (var state : fields(new RentalCatalog(load()), "example").fields())
      if (state.id().equals("rental.currency")) return RentalJson.tree(state);
    throw new AssertionError("rental.currency");
  }

  @Test
  void domovitaExtraPhonesAreEnteredByHand() {
    var snapshot = new FileReferenceRepository(COMMITTED).snapshot();
    // phones.1 and phones.2 appear only after «Добавить другой номер» (live check: 0 matches).
    for (String field : List.of("domovita.additional_phone_1", "domovita.additional_phone_2")) {
      var row = snapshot.coverage("domovita").row(field).orElseThrow();
      assertEquals(Transfer.MANUAL, row.transfer(), field);
      assertTrue(row.reason().contains("«Добавить другой номер»"), row.reason());
      assertTrue(
          snapshot.form("domovita").controlList().stream()
              .noneMatch(c -> c.field().equals(field)),
          field);
    }
  }

  /** Selectors and input methods taken from the research reports of the platforms. */
  @Test
  void evidencedFieldsAreBoundToTheirFormElements() {
    var snapshot = new FileReferenceRepository(COMMITTED).snapshot();
    Map<String, String> expected =
        Map.of(
            "kufar.contact_method", "choices input[type=\"radio\"][name=\"phone_hidden\"]",
            "realt.furniture", "choices [id=\"additional\"] «Мебель»",
            "realt.telephone_lines", "choices [id=\"additional\"] «Количество телефонов»",
            "realt.stove", "choices [id=\"additional\"] «Плита»",
            "realt.separate_rooms", "text [id=\"apartment.separateRooms\"]");
    for (var entry : expected.entrySet()) {
      var row =
          snapshot
              .coverage(entry.getKey().substring(0, entry.getKey().indexOf('.')))
              .row(entry.getKey())
              .orElseThrow();
      assertEquals(Transfer.TRANSFERRED, row.transfer(), entry.getKey());
      assertEquals(entry.getValue(), row.element(), entry.getKey());
    }
  }

  @Test
  void coverageCommandPrintsTheTotalsAndEveryRowAsMarkdown() throws Exception {
    fixture();
    withoutControl("currency");
    var plan = (ObjectNode) read("example.plan.json");
    ((ObjectNode) plan.path("fields").get(1))
        .put("transfer", "manual")
        .put("manual_reason", "Валюта | на площадке\nвыбирается отдельно.");
    write("example.plan.json", plan);
    String report = command("--rental-coverage=" + dir);
    assertTrue(report.startsWith("# Покрытие форм: apartments_long_term_rent\n"), report);
    assertTrue(
        report.contains(
            "| Площадка | transferred | manual | deferred | constant | prepared_only |"),
        report);
    assertTrue(report.contains("| Example (example) | 1 | 1 | 0 | 0 | 0 |"), report);
    assertTrue(
        report.contains(
            "| rental.price | rent — rent | `text input[name=rent]` | transferred |  |"),
        report);
    // A pipe or a line break in a reason does not break the table.
    assertTrue(
        report.contains(
            "| rental.currency | currency — currency |  | manual |"
                + " Валюта \\| на площадке выбирается отдельно. |"),
        report);
  }

  @Test
  void coverageCommandShowsEveryPlatformOfTheCommittedBundle() throws Exception {
    var snapshot = new FileReferenceRepository(COMMITTED).snapshot();
    String report = command("--rental-coverage=" + COMMITTED);
    long rows =
        report
            .lines()
            .filter(line -> !line.startsWith("| Площадка "))
            .filter(
                line ->
                    line.matches(
                        "\\| .* \\| (transferred|manual|deferred|constant|prepared_only) \\| .*"))
            .count();
    long expected = 0;
    for (String platform : snapshot.platforms()) {
      expected += snapshot.coverage(platform).rows().size();
      assertTrue(report.contains("\n## "), report);
      assertTrue(report.contains("(" + platform + ")"), platform);
    }
    assertEquals(expected, rows);
  }

  static String command(String argument) throws Exception {
    var out = new java.io.ByteArrayOutputStream();
    var previous = System.out;
    System.setOut(new java.io.PrintStream(out, true, java.nio.charset.StandardCharsets.UTF_8));
    try {
      AutopostApplication.main(new String[] {argument});
    } finally {
      System.setOut(previous);
    }
    return out.toString(java.nio.charset.StandardCharsets.UTF_8);
  }

  ObjectNode field(String id) {
    return object(
        "id",
        id,
        "name",
        id,
        "description",
        "Synthetic",
        "type",
        "text",
        "options",
        List.of(),
        "fill_rule",
        object());
  }

  void withoutControl(String field) throws Exception {
    var recipe = (ObjectNode) read("example.browser.json");
    var controls = (ArrayNode) recipe.path("controls");
    for (int i = controls.size() - 1; i >= 0; i--)
      if (text(controls.get(i), "field").equals(field)) controls.remove(i);
    write("example.browser.json", recipe);
  }

  void fixture() throws Exception {
    try (var paths = Files.list(Path.of("src/test/resources/reference-example"))) {
      for (Path p : paths.toList())
        Files.copy(p, dir.resolve(p.getFileName()), StandardCopyOption.REPLACE_EXISTING);
    }
  }

  FileReferenceRepository load() {
    return new FileReferenceRepository(dir.toString());
  }

  JsonNode read(String file) throws Exception {
    return MAPPER.readTree(dir.resolve(file).toFile());
  }

  void write(String file, JsonNode data) throws Exception {
    Files.writeString(dir.resolve(file), data.toString());
  }
}
