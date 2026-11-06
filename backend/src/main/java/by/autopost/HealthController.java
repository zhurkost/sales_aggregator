package by.autopost;

import static by.autopost.shared.Json.object;

import com.fasterxml.jackson.databind.node.ObjectNode;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
class HealthController {
  @GetMapping("/healthz")
  ObjectNode health() {
    return object("ok", true);
  }
}
