package by.autopost.workspace.web;

import static by.autopost.shared.Json.object;

import by.autopost.Access;
import by.autopost.workspace.application.WorkspaceService;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/** Управляет сессией кабинета. При входе и регистрации выдаёт cookie, при выходе завершает сессию и очищает cookie. */
@RestController
@RequestMapping("/api/workspace")
class SessionController {
  private final WorkspaceService workspace;
  private final Access access;

  SessionController(WorkspaceService workspace, Access access) {
    this.workspace = workspace;
    this.access = access;
  }

  @GetMapping("/session")
  ObjectNode session(HttpServletRequest req) {
    return workspace.session(Access.token(req));
  }

  @PostMapping("/{action:login|register}")
  ObjectNode login(
      @PathVariable String action, @RequestBody JsonNode input, HttpServletResponse response) {
    var login = workspace.login(input, action.equals("register"));
    response.setHeader(
        "Set-Cookie", access.cookie(login.token(), WorkspaceService.SESSION_SECONDS));
    return object("profile", login.actor().profile());
  }

  @PostMapping("/logout")
  ObjectNode logout(HttpServletRequest req, HttpServletResponse res) {
    workspace.logout(Access.token(req));
    res.setHeader("Set-Cookie", access.cookie("", 0));
    return object("ok", true);
  }
}
