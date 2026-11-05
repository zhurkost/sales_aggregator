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

@SpringBootTest(properties = "autopost.rental-reference-dir=")
@AutoConfigureMockMvc
class WorkspaceIntegrationTest {

  @Test
  void rentalEndpointsRequireAuthenticationAndNeverExposeProviderKey() throws Exception {
    getJson("rental/editor", "", 401);
    postJson("rental/address/suggest", "", object("query", "Минск"), 401);
    postJson("rental/prepare", "", object(), 401);
    postJson("rental/applicability", "", object(), 401);
    postJson("rental/extension-config", "", object(), 401);
    postJson("rental/analyze", "", object("text", "Сдам квартиру"), 401);
    var account = register();
    assertFalse(
        getJson("rental/editor", account.cookie(), 503).toString().contains("DADATA_API_KEY"));
    postJson("rental/address/suggest", account.cookie(), object("query", "М"), 400);
    postJson("rental/analyze", account.cookie(), object("text", "М"), 400);
  }


  @Test
  void removedCardStorageRoutesReturnNotFound() throws Exception {
    var account = register();
    for (String path : List.of("rental/drafts", "rental/drafts/example", "rental/drafts/example/delete")) {
      getJson(path, account.cookie(), 404);
      postJson(path, account.cookie(), object(), 404);
    }
    assertEquals(0, db.count("SELECT count(*) FROM sqlite_master WHERE type='table' AND name='rental_drafts'"));
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
  @Autowired by.autopost.workspace.application.WorkspaceService workspaceService;

  @Test
  void registrationRollsBackWhenIssuingTheSessionFails() {
    String login = "rollback-" + UUID.randomUUID().toString().substring(0, 8);
    long sessions = db.count("SELECT count(*) FROM sessions");
    db.run(
        "CREATE TRIGGER fail_session BEFORE INSERT ON sessions BEGIN SELECT RAISE(ABORT, 'test"
            + " failure'); END");
    try {
      assertThrows(
          org.springframework.dao.DataAccessException.class,
          () ->
              workspaceService.login(object("login", login, "password", "correct-password"), true));
      assertEquals(0, db.count("SELECT count(*) FROM profiles WHERE login=?", login));
      assertEquals(sessions, db.count("SELECT count(*) FROM sessions"));
    } finally {
      db.run("DROP TRIGGER fail_session");
    }
  }

  @Test
  void existingSharedSessionsLoseWorkspaceAccessWhenMembershipIsRemoved() throws Exception {
    var owner = register();
    var member = register();
    String hash = by.autopost.shared.Hashing.sha256(member.cookie().split("=", 2)[1]);
    db.run("INSERT INTO members VALUES(?,?)", owner.id(), member.id());
    db.run("UPDATE sessions SET workspace_id=? WHERE token=?", owner.id(), hash);
    var profile = getJson("session", member.cookie(), 200).path("profile");
    assertEquals(owner.id(), text(profile, "id"));
    assertEquals(member.id(), text(profile, "accountId"));
    db.run("DELETE FROM members WHERE owner_id=? AND member_id=?", owner.id(), member.id());
    assertEquals(member.id(), text(getJson("session", member.cookie(), 200).path("profile"), "id"));
    db.run("UPDATE sessions SET expires=0 WHERE token=?", hash);
    assertTrue(getJson("session", member.cookie(), 200).path("profile").isNull());
  }

  @Test
  void retiredWorkspaceEndpointsAreNotAvailable() throws Exception {
    var account = register();
    for (String path : List.of("ads", "ads/old", "notifications", "team"))
      getJson(path, account.cookie(), 404);
    for (String path :
        List.of("ads", "batch-edit", "import", "feed", "team", "extension-config", "notifications"))
      postJson(path, account.cookie(), object(), 404);
    postJson("settings", account.cookie(), object(), 405);
    assertEquals(404, mvc.perform(get("/api/ai-settings")).andReturn().getResponse().getStatus());
    assertEquals(
        404,
        mvc.perform(
                post("/api/analyze")
                    .header("Origin", "http://localhost:4200")
                    .header("Cookie", account.cookie())
                    .contentType("application/json")
                    .content("{}"))
            .andReturn()
            .getResponse()
            .getStatus());
  }

  @Test
  void contactDefaultsStayPrivateAndDoNotExposeRetiredSettings() throws Exception {
    var owner = register();
    var other = register();
    db.run(
        "INSERT INTO settings VALUES(?,?)",
        owner.id(),
        object(
                "phone",
                "+375291234567",
                "contactPerson",
                "Owner",
                "company",
                "Company",
                "templates",
                List.of("old"),
                "integrations",
                object("kufar", object("notes", "private")))
            .toString());
    var defaults = getJson("settings", owner.cookie(), 200).path("settings");
    assertEquals("+375291234567", text(defaults, "phone"));
    assertEquals(3, defaults.size());
    assertEquals("", text(getJson("settings", other.cookie(), 200).path("settings"), "phone"));
    getJson("settings", "", 401);
    assertTrue(
        db.one("SELECT data FROM settings WHERE profile_id=?", owner.id())
            .get("data")
            .toString()
            .contains("integrations"),
        "Persisted data is not deleted during cleanup");
  }

  @Test
  void logoutAndOriginProtectionStillApplyToRental() throws Exception {
    var account = register();
    var other = register();
    assertEquals(
        403,
        mvc.perform(
                post("/api/workspace/rental/prepare")
                    .header("Origin", "https://evil.example")
                    .header("Cookie", account.cookie())
                    .contentType("application/json")
                    .content("{}"))
            .andReturn()
            .getResponse()
            .getStatus());
    assertEquals(
        409,
        mvc.perform(
                get("/api/workspace/settings")
                    .header("Cookie", account.cookie())
                    .header("X-Autopost-Workspace", other.id()))
            .andReturn()
            .getResponse()
            .getStatus());
    postJson("logout", account.cookie(), object(), 200);
    getJson("rental/editor", account.cookie(), 401);
  }

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

  @Test
  void preservesLegacyScryptHashesAndExistingSessionTokens() throws Exception {
    // A profile/session written using exactly the original Node scrypt parameters.
    String id = UUID.randomUUID().toString(),
        token = "a".repeat(64),
        salt = "d81362ffce1186bb71cc5d12a1baebde";
    String hash =
        "2fc1c162939c32461d866ca6a72d219dd217a2347f954bddeece027c4877a840c5bc4359510faa2f9ec602a4b4406a0ca4477bb046f1a391dd87403d0f5c22db";
    assertEquals(
        hash,
        by.autopost.workspace.application.Passwords.derive("legacy-password", salt),
        "Node scrypt compatibility");
    db.run(
        "INSERT INTO profiles VALUES(?,?,?,?,?)",
        id,
        "legacy-" + id.substring(0, 8),
        "Legacy",
        salt,
        hash);
    db.run(
        "INSERT INTO sessions(token,profile_id,expires) VALUES(?,?,?)",
        by.autopost.shared.Hashing.sha256(token),
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
}
