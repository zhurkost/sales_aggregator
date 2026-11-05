package by.autopost;

import static by.autopost.shared.Json.*;

import by.autopost.workspace.application.WorkspaceService;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.*;
import jakarta.servlet.http.*;
import org.springframework.web.bind.annotation.*;

@RestController
class WorkspaceController {
  private final WorkspaceService workspace;
  private final Access access;

  WorkspaceController(WorkspaceService workspace, Access access) {
    this.workspace = workspace;
    this.access = access;
  }

  @GetMapping("/healthz")
  ObjectNode health() {
    return object("ok", true);
  }

  @GetMapping("/api/workspace/session")
  ObjectNode session(HttpServletRequest req) {
    return workspace.session(Access.token(req));
  }

  @PostMapping("/api/workspace/{action:login|register}")
  ObjectNode login(
      @PathVariable String action, @RequestBody JsonNode input, HttpServletResponse response) {
    var login = workspace.login(input, action.equals("register"));
    response.setHeader(
        "Set-Cookie", access.cookie(login.token(), WorkspaceService.SESSION_SECONDS));
    return object("profile", login.actor().profile());
  }

  @PostMapping("/api/workspace/logout")
  ObjectNode logout(HttpServletRequest req, HttpServletResponse res) {
    workspace.logout(Access.token(req));
    res.setHeader("Set-Cookie", access.cookie("", 0));
    return object("ok", true);
  }

  @GetMapping("/api/workspace/settings")
  ObjectNode settings(HttpServletRequest req) {
    return workspace.settings(access.require(req).workspace());
  }
}
