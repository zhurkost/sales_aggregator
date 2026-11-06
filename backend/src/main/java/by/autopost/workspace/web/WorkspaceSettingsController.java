package by.autopost.workspace.web;

import by.autopost.Access;
import by.autopost.workspace.application.WorkspaceService;
import com.fasterxml.jackson.databind.node.ObjectNode;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/workspace")
class WorkspaceSettingsController {
  private final WorkspaceService workspace;
  private final Access access;

  WorkspaceSettingsController(WorkspaceService workspace, Access access) {
    this.workspace = workspace;
    this.access = access;
  }

  @GetMapping("/settings")
  ObjectNode settings(HttpServletRequest req) {
    return workspace.settings(access.require(req).workspace());
  }
}
