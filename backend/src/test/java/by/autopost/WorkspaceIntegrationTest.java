package by.autopost;

import static by.autopost.shared.Json.*;
import static org.junit.jupiter.api.Assertions.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;

import by.autopost.rental.card.*;
import by.autopost.rental.catalog.*;
import by.autopost.rental.model.*;
import by.autopost.rental.preparation.*;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.*;
import java.nio.file.*;
import java.util.*;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.web.servlet.*;

@SpringBootTest(
    properties = "autopost.rental-reference-dir=../data/rental/apartments_long_term_rent")
@AutoConfigureMockMvc
class WorkspaceIntegrationTest {
  @Test
  void rentalDraftsArePrivateAndUseOptimisticRevision() throws Exception {
    var owner = register();
    var other = register();
    String id = UUID.randomUUID().toString();
    var draft =
        object(
            "modelVersion",
            2,
            "cardVersion",
            "example",
            "values",
            object("listing.title", "My apartment"),
            "platforms",
            List.of("kufar"),
            "extras",
            object());
    postJson("rental/drafts/" + id, owner.cookie(), object("revision", 0, "draft", draft), 200);
    assertEquals(1, getJson("rental/drafts", owner.cookie(), 200).path("drafts").size());
    assertTrue(getJson("rental/drafts", other.cookie(), 200).path("drafts").isEmpty());
    getJson("rental/drafts/" + id, other.cookie(), 404);
    postJson("rental/drafts/" + id, owner.cookie(), object("revision", 0, "draft", draft), 409);
    assertEquals(
        "My apartment",
        getJson("rental/drafts/" + id, owner.cookie(), 200)
            .path("draft")
            .path("values")
            .path("listing.title")
            .asText());
    postJson("rental/drafts/" + id, owner.cookie(), object("revision", 1, "draft", draft), 200);
    assertEquals(2, getJson("rental/drafts/" + id, owner.cookie(), 200).path("revision").asInt());
  }

  @Test
  void rentalEndpointsRequireAuthenticationAndNeverExposeProviderKey() throws Exception {
    getJson("rental/editor", "", 401);
    getJson("rental/drafts", "", 401);
    postJson("rental/address/suggest", "", object("query", "Минск"), 401);
    postJson("rental/prepare", "", object(), 401);
    postJson("rental/extension-config", "", object(), 401);
    postJson("rental/analyze", "", object("text", "Сдам квартиру"), 401);
    var account = register();
    assertFalse(
        getJson("rental/editor", account.cookie(), 200).toString().contains("DADATA_API_KEY"));
    postJson("rental/address/suggest", account.cookie(), object("query", "М"), 400);
    postJson("rental/analyze", account.cookie(), object("text", "М"), 400);
  }

  @Test
  void everyRentalCardEndpointHasTheSameSizeLimit() throws Exception {
    var account = register();
    String id = UUID.randomUUID().toString();
    var oversized =
        object(
            "cardVersion",
            "example",
            "values",
            object("listing.description", "x".repeat(250_001)),
            "platforms",
            List.of("kufar"));
    var requests = new LinkedHashMap<String, JsonNode>();
    requests.put("rental/drafts/" + id, object("revision", 0, "draft", oversized));
    requests.put("rental/normalize", oversized);
    requests.put("rental/prepare", object("id", id, "draft", oversized));
    requests.put("rental/extension-config", object("id", id, "draft", oversized));
    for (var request : requests.entrySet()) {
      var response = postJson(request.getKey(), account.cookie(), request.getValue(), 413);
      assertEquals(
          "Карточка слишком большая.",
          text(parse(response.getResponse().getContentAsString()), "error"),
          request.getKey());
    }
    // A card just under the limit passes the size check.
    var fits = object("values", object("listing.description", "x".repeat(249_000)));
    postJson("rental/drafts/" + id, account.cookie(), object("revision", 0, "draft", fits), 200);
  }

  @Test
  void deletesOnlyTheConfirmedRentalRevisionInTheCurrentWorkspace() throws Exception {
    var owner = register();
    var other = register();
    String id = UUID.randomUUID().toString(), keep = UUID.randomUUID().toString();
    var draft = object("modelVersion", 2, "values", object("listing.title", "Delete test"));
    String path = "rental/drafts/" + id;
    postJson(path, owner.cookie(), object("revision", 0, "draft", draft), 200);
    postJson("rental/drafts/" + keep, owner.cookie(), object("revision", 0, "draft", draft), 200);
    postJson(path + "/delete", "", object("revision", 1), 401);
    postJson(path + "/delete", other.cookie(), object("revision", 1), 404);
    postJson(path + "/delete", owner.cookie(), object(), 400);
    var cross =
        mvc.perform(
                post("/api/workspace/" + path + "/delete")
                    .header("Origin", "https://evil.example")
                    .header("Cookie", owner.cookie())
                    .contentType("application/json")
                    .content("{\"revision\":1}"))
            .andReturn();
    assertEquals(403, cross.getResponse().getStatus());
    postJson(path, owner.cookie(), object("revision", 1, "draft", draft), 200);
    postJson(path + "/delete", owner.cookie(), object("revision", 1), 409);
    assertEquals(2, getJson(path, owner.cookie(), 200).path("revision").asInt());
    // An identical ID in another cabinet must remain untouched.
    postJson(path, other.cookie(), object("revision", 0, "draft", draft), 200);
    postJson(path + "/delete", owner.cookie(), object("revision", 2), 200);
    getJson(path, owner.cookie(), 404);
    getJson(path, other.cookie(), 200);
    getJson("rental/drafts/" + keep, owner.cookie(), 200);
    assertEquals(1, getJson("rental/drafts", owner.cookie(), 200).path("drafts").size());
    // A late autosave from a previously opened card cannot bring it back.
    postJson(path, owner.cookie(), object("revision", 2, "draft", draft), 409);
    getJson(path, owner.cookie(), 404);
  }

  @Test
  void rentalPhotosAreServedOnlyToTheirCabinetAndReviseTheCard() throws Exception {
    var owner = register();
    var other = register();
    String id = UUID.randomUUID().toString(), path = "rental/drafts/" + id;
    var draft = object("modelVersion", 2, "values", object("listing.title", "Photos"));
    postJson(path, owner.cookie(), object("revision", 0, "draft", draft), 200);
    assertEquals(12, getJson("rental/editor", owner.cookie(), 200).path("photoLimit").asInt());
    byte[] jpeg = {(byte) 0xFF, (byte) 0xD8, (byte) 0xFF, (byte) 0xE0, 1, 2};
    var photo =
        object(
            "name",
            "kitchen.jpg",
            "dataUrl",
            "data:image/jpeg;base64," + Base64.getEncoder().encodeToString(jpeg));
    var upload = object("revision", 1, "photos", List.of(photo, photo));
    postJson(path + "/photos", other.cookie(), upload, 404);
    var added =
        parse(
            postJson(path + "/photos", owner.cookie(), upload, 200)
                .getResponse()
                .getContentAsString());
    assertEquals(2, added.path("revision").asInt());
    var first = text(added.path("photos").get(0), "id");
    assertEquals("kitchen.jpg", text(added.path("photos").get(0), "name"));
    assertEquals("image/jpeg", text(added.path("photos").get(0), "type"));
    assertEquals(2, getJson(path, owner.cookie(), 200).path("photos").size());
    String url = "/api/workspace/" + path + "/photos/" + first;
    var image = mvc.perform(get(url).header("Cookie", owner.cookie())).andReturn().getResponse();
    assertEquals(200, image.getStatus());
    assertEquals("image/jpeg", image.getContentType());
    assertArrayEquals(jpeg, image.getContentAsByteArray());
    assertEquals(
        404,
        mvc.perform(get(url).header("Cookie", other.cookie())).andReturn().getResponse().getStatus());
    var second = text(added.path("photos").get(1), "id");
    var order = object("revision", 2, "order", List.of(second, first));
    postJson(path + "/photos/order", owner.cookie(), order, 200);
    postJson(path + "/photos/delete", owner.cookie(), object("revision", 3, "photo", first), 200);
    postJson(path + "/photos/delete", owner.cookie(), object("revision", 3, "photo", second), 409);
    postJson(path + "/photos", owner.cookie(), object("revision", "x"), 400);
    var saved = getJson(path, owner.cookie(), 200);
    assertEquals(4, saved.path("revision").asInt());
    assertEquals(second, text(saved.path("photos").get(0), "id"));
    // The check counts the photos of this card in this cabinet only.
    var card =
        object(
            "modelVersion",
            2,
            "cardVersion",
            text(getJson("rental/editor", owner.cookie(), 200), "cardVersion"),
            "values",
            object(),
            "platforms",
            List.of("onliner"));
    var check = object("id", id, "draft", card);
    var own = postJson("rental/prepare", owner.cookie(), check, 200).getResponse();
    var foreign = postJson("rental/prepare", other.cookie(), check, 200).getResponse();
    assertFalse(own.getContentAsString().contains("photos_required"));
    assertTrue(foreign.getContentAsString().contains("photos_required"));
  }

  @Test
  void rentalPublicationsAreReportedAndLinkedOnlyInTheirCabinet() throws Exception {
    var owner = register();
    var other = register();
    String id = UUID.randomUUID().toString();
    var draft =
        object(
            "modelVersion",
            2,
            "cardVersion",
            text(getJson("rental/editor", owner.cookie(), 200), "cardVersion"),
            "values",
            object(),
            "platforms",
            List.of("kufar"));
    postJson("rental/drafts/" + id, owner.cookie(), object("revision", 0, "draft", draft), 200);
    var request = object("id", id, "draft", draft);
    var launch =
        parse(
            postJson("rental/extension-config", owner.cookie(), request, 200)
                .getResponse()
                .getContentAsString());
    String publication = text(launch.path("jobs").get(0), "publication");
    var again =
        parse(
            postJson("rental/extension-config", owner.cookie(), request, 200)
                .getResponse()
                .getContentAsString());
    assertEquals(publication, text(again.path("jobs").get(0), "publication"));
    String path = "rental/publications/" + publication;
    var filled = object("status", "filled", "message", "Заполнено");
    postJson(path, other.cookie(), filled, 404);
    postJson(path, "", filled, 401);
    var reported =
        parse(postJson(path, owner.cookie(), filled, 200).getResponse().getContentAsString());
    assertEquals("filled", text(reported, "status"));
    assertEquals("kufar", text(reported, "platform"));
    postJson(path, owner.cookie(), object("status", "published"), 400);
    postJson(path, owner.cookie(), object("status", "submitted"), 200);
    postJson(path, owner.cookie(), object("status", "submitted"), 409);
    var link = object("url", "https://re.kufar.by/vi/123");
    postJson(path + "/link", other.cookie(), link, 404);
    postJson(path + "/link", owner.cookie(), object("url", "https://evil.example/vi/1"), 400);
    var linked =
        parse(
            postJson(path + "/link", owner.cookie(), link, 200).getResponse().getContentAsString());
    assertEquals("https://re.kufar.by/vi/123", text(linked, "url"));
    assertEquals("submitted", text(linked, "status"));
  }

  static final Path DATA;

  static {
    try {
      DATA = Files.createTempDirectory("autopost-java-tests-");
    } catch (Exception e) {
      throw new ExceptionInInitializerError(e);
    }
  }

  @DynamicPropertySource
  static void properties(DynamicPropertyRegistry registry) {
    registry.add("autopost.data-dir", () -> DATA.toString());
    registry.add("spring.datasource.url", () -> "jdbc:sqlite:" + DATA.resolve("workspace.sqlite"));
    registry.add("autopost.origin", () -> "http://localhost:4200");
    registry.add("autopost.proxy-secret", () -> "");
  }

  @Autowired MockMvc mvc;
  @Autowired Database db;
  @Autowired Domain domain;

  record Account(String id, String login, String cookie) {}

  Account register() throws Exception {
    String login = "test-" + UUID.randomUUID().toString().substring(0, 8);
    var response =
        postJson(
            "register",
            "",
            object("login", login, "password", "correct-password", "name", login),
            200);
    JsonNode profile = parse(response.getResponse().getContentAsString()).path("profile");
    return new Account(
        text(profile, "id"),
        login,
        response.getResponse().getHeader("Set-Cookie").split(";", 2)[0]);
  }

  MvcResult postJson(String path, String cookie, JsonNode data, int status) throws Exception {
    var result =
        mvc.perform(
                post("/api/workspace/" + path)
                    .header("Origin", "http://localhost:4200")
                    .header("Cookie", cookie)
                    .contentType("application/json")
                    .content(data.toString()))
            .andReturn();
    assertEquals(
        status, result.getResponse().getStatus(), result.getResponse().getContentAsString());
    return result;
  }

  JsonNode getJson(String path, String cookie, int status) throws Exception {
    var result = mvc.perform(get("/api/workspace/" + path).header("Cookie", cookie)).andReturn();
    assertEquals(
        status, result.getResponse().getStatus(), result.getResponse().getContentAsString());
    return parse(result.getResponse().getContentAsString());
  }

  ObjectNode record(String id) {
    ObjectNode listing =
        domain.listing(
            object(
                "category",
                "cars",
                "taxonomyId",
                "auto.cars",
                "brand",
                "Volkswagen",
                "model",
                "Passat",
                "year",
                "2018",
                "title",
                "Car",
                "description",
                "Original description",
                "price",
                "100",
                "currency",
                "BYN",
                "city",
                "Минск",
                "phone",
                "+375291234567"));
    return object(
        "id",
        id,
        "revision",
        0,
        "text",
        "Original description",
        "listing",
        listing,
        "photos",
        array(),
        "selected",
        array(List.of("kufar")),
        "prepared",
        true,
        "categoryConfirmed",
        true,
        "categoryOverrides",
        object(),
        "attributes",
        object(),
        "platformText",
        object(),
        "jobs",
        array());
  }

  ObjectNode save(Account user, JsonNode record) throws Exception {
    return (ObjectNode)
        parse(postJson("ads", user.cookie, record, 200).getResponse().getContentAsString())
            .path("ad");
  }

  @Test
  void protectsOriginRequiresSessionAndKeepsAccountsIsolated() throws Exception {
    Account owner = register(), other = register();
    ObjectNode saved = save(owner, record("isolation"));
    getJson("ads/isolation", other.cookie, 404);
    getJson("ads", "", 401);
    var cross =
        mvc.perform(
                post("/api/workspace/ads")
                    .header("Origin", "https://evil.example")
                    .header("Cookie", owner.cookie)
                    .contentType("application/json")
                    .content(saved.toString()))
            .andReturn();
    assertEquals(403, cross.getResponse().getStatus());
    var changed =
        mvc.perform(
                get("/api/workspace/ads")
                    .header("Cookie", owner.cookie)
                    .header("X-Autopost-Workspace", other.id))
            .andReturn();
    assertEquals(409, changed.getResponse().getStatus());
    postJson("logout", owner.cookie, object(), 200);
    getJson("ads", owner.cookie, 401);
  }

  @Test
  void preservesLegacyScryptHashesAndExistingSessionTokens() throws Exception {
    // A profile/session written using exactly the original Node scrypt parameters.
    String id = UUID.randomUUID().toString(),
        token = "a".repeat(64),
        salt = "d81362ffce1186bb71cc5d12a1baebde";
    String hash =
        "2fc1c162939c32461d866ca6a72d219dd217a2347f954bddeece027c4877a840c5bc4359510faa2f9ec602a4b4406a0ca4477bb046f1a391dd87403d0f5c22db";
    assertEquals(hash, Access.derive("legacy-password", salt), "Node scrypt compatibility");
    db.run(
        "INSERT INTO profiles VALUES(?,?,?,?,?)",
        id,
        "legacy-" + id.substring(0, 8),
        "Legacy",
        salt,
        hash);
    db.run(
        "INSERT INTO sessions(token,profile_id,expires) VALUES(?,?,?)",
        Access.hash(token),
        id,
        System.currentTimeMillis() + 60000);
    assertEquals(
        id, text(getJson("session", "autopost_session=" + token, 200).path("profile"), "id"));
    postJson(
        "login",
        "",
        object("login", "legacy-" + id.substring(0, 8), "password", "legacy-password"),
        200);
    postJson(
        "login",
        "",
        object("login", "legacy-" + id.substring(0, 8), "password", "wrong-password"),
        401);
  }

  @Test
  void detectsRevisionConflictsAndRestoresHistoryWithoutLosingPhotos() throws Exception {
    Account user = register();
    ObjectNode first = save(user, record("history"));
    ObjectNode changed = first.deepCopy();
    ((ObjectNode) changed.path("listing")).put("description", "Updated description");
    changed.set(
        "photos",
        array(
            List.of(
                object(
                    "id",
                    "photo-1",
                    "name",
                    "photo.jpg",
                    "dataUrl",
                    "data:image/jpeg;base64,AAAA"))));
    ObjectNode second = save(user, changed);
    postJson("ads", user.cookie, first, 409);
    assertEquals(2, second.path("revision").asInt());
    JsonNode versions = getJson("ads/history/versions", user.cookie, 200).path("versions");
    assertEquals(1, versions.size());
    ObjectNode restored =
        (ObjectNode)
            parse(
                    postJson(
                            "ads/history/versions",
                            user.cookie,
                            object("version", 1, "revision", second.path("revision")),
                            200)
                        .getResponse()
                        .getContentAsString())
                .path("ad");
    assertEquals("Original description", text(restored.path("listing"), "description"));
    assertEquals(1, restored.path("photos").size());
  }

  @Test
  void rollsBackWholeBatchOnConflictAndSupportsIdempotentImport() throws Exception {
    Account user = register();
    ObjectNode a = save(user, record("batch-a")), b = save(user, record("batch-b"));
    ObjectNode edit =
        object(
            "priceMode", "fixed", "priceValue", "200", "city", "", "phone", "", "availability", "");
    postJson(
        "batch-edit",
        user.cookie,
        object(
            "items",
            array(
                List.of(
                    object("id", "batch-a", "revision", 1),
                    object("id", "batch-b", "revision", 99))),
            "edit",
            edit),
        409);
    assertEquals(
        "100", text(getJson("ads/batch-a", user.cookie, 200).path("ad").path("listing"), "price"));
    postJson(
        "batch-edit",
        user.cookie,
        object(
            "items",
            array(
                List.of(
                    object("id", "batch-a", "revision", 1),
                    object("id", "batch-b", "revision", 1))),
            "edit",
            edit),
        200);
    assertEquals(
        "200", text(getJson("ads/batch-a", user.cookie, 200).path("ad").path("listing"), "price"));
    ObjectNode payload =
        object(
            "sourceId",
            "catalog",
            "record",
            record("incoming"),
            "fields",
            array(List.of("title", "price")));
    JsonNode first =
        parse(postJson("import", user.cookie, payload, 200).getResponse().getContentAsString());
    JsonNode second =
        parse(postJson("import", user.cookie, payload, 200).getResponse().getContentAsString());
    assertEquals("created", text(first, "action"));
    assertEquals("unchanged", text(second, "action"));
    assertEquals(first.path("ad").path("id"), second.path("ad").path("id"));
  }

  @Test
  void supportsSharedWorkspacesAndRevokesMembershipImmediately() throws Exception {
    Account owner = register(), member = register();
    save(owner, record("team-ad"));
    postJson("team", owner.cookie, object("action", "add", "login", member.login), 200);
    postJson("team", member.cookie, object("action", "switch", "workspaceId", owner.id), 200);
    getJson("ads/team-ad", member.cookie, 200);
    postJson("team", member.cookie, object("action", "add", "login", owner.login), 403);
    postJson("team", owner.cookie, object("action", "remove", "memberId", member.id), 200);
    getJson("ads/team-ad", member.cookie, 404);
  }

  @Test
  void reservesLaunchOnlyOnceAndRejectsChangedContent() throws Exception {
    Account user = register();
    ObjectNode ad = record("launch");
    ad.put("batchId", "batch-1");
    ad.set(
        "jobs",
        array(
            List.of(
                object(
                    "platformId",
                    "kufar",
                    "batchId",
                    "batch-1",
                    "status",
                    "opening",
                    "message",
                    "Opening"))));
    ad = save(user, ad);
    ObjectNode listing = ad.path("listing").deepCopy();
    listing.put("title", domain.title(listing));
    listing.put(
        "description",
        domain.description(listing, ad.path("attributes"), ad.path("categoryOverrides")));
    ObjectNode item =
        object(
            "recordId",
            "launch",
            "batchId",
            "batch-1",
            "listing",
            listing,
            "photoIds",
            array(),
            "platforms",
            array(List.of(object("id", "kufar"))),
            "platformText",
            ad.path("platformText"),
            "attributes",
            ad.path("attributes"),
            "categoryOverrides",
            ad.path("categoryOverrides"));
    ObjectNode reserve =
        object("items", array(List.of(item)), "reserve", true, "profileId", user.id);
    postJson("extension-config", user.cookie, reserve, 200);
    postJson("extension-config", user.cookie, reserve, 400);
    reserve.remove("reserve");
    reserve.put("verify", true);
    postJson("extension-config", user.cookie, reserve, 200);
    ((ObjectNode) item.path("listing")).put("price", "999");
    postJson(
        "extension-config",
        user.cookie,
        object("items", array(List.of(item)), "verify", true),
        400);
  }
}
