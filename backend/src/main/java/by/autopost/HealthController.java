package by.autopost;

import static by.autopost.shared.Json.object;

import com.fasterxml.jackson.databind.node.ObjectNode;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

/** Позволяет скрипту развёртывания проверить, что HTTP-сервис запустился. */
@RestController
class HealthController {
  @GetMapping("/healthz")
  ObjectNode health() {
    return object("ok", true);
  }
}
