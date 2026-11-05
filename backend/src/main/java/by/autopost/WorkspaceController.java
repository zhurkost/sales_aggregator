package by.autopost;

import static by.autopost.shared.Json.*;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.*;
import jakarta.servlet.http.*;
import java.util.*;
import org.springframework.web.bind.annotation.*;

@RestController
class WorkspaceController {
  final Database db;
  final Access access;
  WorkspaceController(Database db, Access access) {
    this.db = db;
    this.access = access;
  }

  @GetMapping("/healthz")
  ObjectNode health() {
    return object("ok", true);
  }

  @GetMapping("/api/workspace/session")
  ObjectNode session(HttpServletRequest req) {
    var actor = access.user(req);
    return object(
        "profile",
        actor == null ? null : actor.profile(),
        "profiles",
        db.rows("SELECT id,login,name FROM profiles ORDER BY login"));
  }

  @PostMapping("/api/workspace/{action:login|register}")
  ObjectNode login(
      @PathVariable String action, @RequestBody JsonNode input, HttpServletResponse response) {
    return access.login(input, action.equals("register"), response);
  }

  @PostMapping("/api/workspace/logout")
  ObjectNode logout(HttpServletRequest req, HttpServletResponse res) {
    db.run("DELETE FROM sessions WHERE token=?", Access.hash(Access.token(req)));
    res.setHeader("Set-Cookie", access.cookie("", 0));
    return object("ok", true);
  }

  @GetMapping("/api/workspace/settings")
  ObjectNode settings(HttpServletRequest req) {
    String workspace = access.require(req).workspace();
    var row = db.one("SELECT data FROM settings WHERE profile_id=?", workspace);
    var saved = row == null ? object() : parse(row.get("data").toString());
    var defaults = object();
    for (String key : List.of("company", "contactPerson", "phone"))
      defaults.put(key, clean(saved, key, key.equals("company") ? 150 : key.equals("phone") ? 40 : 100));
    return object("settings", defaults);
  }
}
