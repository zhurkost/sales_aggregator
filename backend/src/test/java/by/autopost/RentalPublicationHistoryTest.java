package by.autopost;

import static by.autopost.shared.Json.*;
import static org.junit.jupiter.api.Assertions.*;

import by.autopost.rental.application.PublicationStatus;
import by.autopost.rental.application.RentalCatalog;
import by.autopost.rental.application.RentalPublicationService;
import by.autopost.rental.catalog.FileReferenceRepository;
import by.autopost.shared.ApiException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.nio.file.Path;
import java.util.List;
import java.util.Map;
import java.util.stream.Collectors;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.function.Executable;
import org.junit.jupiter.api.io.TempDir;

class RentalPublicationHistoryTest {
  @TempDir Path dir;
  final RentalCatalog catalog =
      new RentalCatalog(new FileReferenceRepository("../data/rental/apartments_long_term_rent"));
  RentalStorage storage;
  RentalPublicationService service;
  ObjectNode draft;

  @BeforeEach
  void setUp() {
    storage = RentalStorage.at(dir.resolve("workspace.sqlite"));
    service = storage.publicationService(catalog);
    draft = new RentalPublicationTest().partial();
    draft.set("platforms", array().add("kufar").add("realt"));
    storage.draftService().save("owner", "flat", object("revision", 0, "draft", draft));
  }

  ObjectNode launch(String workspace) {
    return service.configuration(workspace, object("id", "flat", "draft", draft.deepCopy()));
  }

  static Map<String, String> publications(JsonNode launch) {
    return list(launch.path("jobs")).stream()
        .collect(Collectors.toMap(j -> text(j, "platform"), j -> text(j, "publication")));
  }

  int rows() {
    return storage.jdbc.queryForObject("SELECT count(*) FROM rental_publications", Integer.class);
  }

  PublicationStatus status(String id) {
    return storage.publications.find("owner", id).orElseThrow().status();
  }

  static ApiException refused(Executable call) {
    return assertThrows(ApiException.class, call);
  }

  @Test
  void aLaunchOpensOnePublicationPerPlatformAndARepeatedLaunchNoDuplicate() {
    var first = publications(launch("owner"));
    assertEquals(2, first.size());
    for (String id : first.values()) {
      var publication = storage.publications.find("owner", id).orElseThrow();
      assertEquals(PublicationStatus.OPENED, publication.status());
      assertEquals(1, publication.revision());
      assertEquals(catalog.integrationVersion(), publication.integrationVersion());
      assertEquals("flat", publication.draftId());
    }
    // A retried click, a timed-out response, a second tab: the same revision under the same rules.
    service.report("owner", first.get("kufar"), "filled", "Заполнено");
    assertEquals(first, publications(launch("owner")));
    assertEquals(2, rows());
    assertEquals(PublicationStatus.FILLED, status(first.get("kufar")));
    // A new revision is a new launch; the earlier one stays in the history.
    storage.draftService().save("owner", "flat", object("revision", 1, "draft", draft));
    var second = publications(launch("owner"));
    assertNotEquals(first.get("kufar"), second.get("kufar"));
    assertEquals(4, rows());
    assertEquals(PublicationStatus.FILLED, status(first.get("kufar")));
  }

  @Test
  void statusesFollowTheLifeOfAPublication() {
    String id = publications(launch("owner")).get("kufar");
    service.report("owner", id, "filled", "Заполненные данные перенесены.");
    service.report("owner", id, "needs_action", "Пройдите вход.");
    service.report("owner", id, "stopped", "Остановлено в Автопосте");
    // A stopped publication only opens again, when the extension resumes it.
    for (String next : List.of("filled", "needs_action", "submitted"))
      assertEquals(409, refused(() -> service.report("owner", id, next, "")).status, next);
    service.report("owner", id, "opened", "Возобновляем заполнение");
    var submitted = service.report("owner", id, "submitted", "Выполнена попытка подачи.");
    assertEquals(PublicationStatus.SUBMITTED, submitted.status());
    assertEquals("Выполнена попытка подачи.", submitted.message());
    // A submission happens once and is never undone.
    for (String next : List.of("submitted", "opened", "filled", "needs_action", "stopped")) {
      var error = refused(() -> service.report("owner", id, next, ""));
      assertEquals(409, error.status, next);
      assertEquals("Подача на эту площадку уже выполнена.", error.getMessage());
    }
    assertEquals(400, refused(() -> service.report("owner", id, "published", "")).status);
    assertEquals(400, refused(() -> service.report("owner", id, null, "")).status);
    String other = publications(launch("owner")).get("realt");
    var longMessage = service.report("owner", other, "needs_action", " " + "я".repeat(600) + " ");
    assertEquals(500, longMessage.message().length());
  }

  @Test
  void theSubmissionIsAllowedOnlyForTheLaunchedRevisionAndRules() {
    String id = publications(launch("owner")).get("kufar");
    storage.draftService().save("owner", "flat", object("revision", 1, "draft", draft));
    var changed = refused(() -> service.report("owner", id, "submitted", ""));
    assertEquals(409, changed.status);
    assertEquals(
        "Карточка изменена. Остановите старый запуск и передайте новую версию.",
        changed.getMessage());
    assertEquals(PublicationStatus.OPENED, status(id));
    // A launch compiled under rules a later release replaced.
    var earlier =
        storage.publications.open("owner", "flat", 2, "rules-of-an-earlier-release", "kufar", "t");
    var rules = refused(() -> service.report("owner", earlier.id(), "submitted", ""));
    assertEquals(
        "Правила площадок обновились. Остановите старый запуск и передайте карточку заново.",
        rules.getMessage());
    String current = publications(launch("owner")).get("kufar");
    assertEquals(
        PublicationStatus.SUBMITTED, service.report("owner", current, "submitted", "").status());
  }

  @Test
  void publicationsOfAnotherCabinetDoNotExistForThisOne() {
    String id = publications(launch("owner")).get("kufar");
    assertEquals(404, refused(() -> launch("other")).status);
    assertEquals(404, refused(() -> service.report("other", id, "filled", "")).status);
    assertEquals(
        404, refused(() -> service.link("other", id, "https://www.kufar.by/item/1")).status);
    assertEquals(PublicationStatus.OPENED, status(id));
    assertEquals("", storage.publications.find("owner", id).orElseThrow().url());
  }

  @Test
  void theLinkLeadsToThePlatformsSite() {
    var launched = publications(launch("owner"));
    String kufar = launched.get("kufar"), realt = launched.get("realt");
    assertEquals(
        "https://re.kufar.by/vi/123456",
        service.link("owner", kufar, " https://re.kufar.by/vi/123456#gallery ").url());
    assertEquals(
        "https://realt.by/rent-flat-for-long/object/42/",
        service.link("owner", realt, "https://realt.by/rent-flat-for-long/object/42/").url());
    for (String wrong :
        List.of(
            "http://re.kufar.by/vi/1",
            "https://kufar.by.example.com/vi/1",
            "https://realt.by/vi/1",
            "https://user@kufar.by/vi/1",
            "https://kufar.by:8443/vi/1",
            "javascript:alert(1)",
            "https://kufar.by/" + "x".repeat(1500)))
      assertEquals(400, refused(() -> service.link("owner", kufar, wrong)).status, wrong);
    assertEquals(
        "https://re.kufar.by/vi/123456",
        storage.publications.find("owner", kufar).orElseThrow().url());
    assertEquals("", service.link("owner", kufar, "").url());
  }

  @Test
  void deletingACardDeletesItsPublications() {
    launch("owner");
    storage.draftService().save("other", "flat", object("revision", 0, "draft", draft));
    launch("other");
    storage.draftService().delete("owner", "flat", object("revision", 1));
    assertEquals(
        2,
        storage.jdbc.queryForObject(
            "SELECT count(*) FROM rental_publications WHERE workspace_id='other'", Integer.class));
    assertEquals(2, rows());
  }
}
