package by.autopost.rental.web;

import by.autopost.Access;
import by.autopost.rental.ai.RentalAiService;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.web.bind.annotation.*;

@RestController
class RentalAiController {
  private final Access access;
  private final RentalAiService ai;

  RentalAiController(Access access, RentalAiService ai) {
    this.access = access;
    this.ai = ai;
  }

  @PostMapping("/api/workspace/rental/analyze")
  ObjectNode analyze(HttpServletRequest request, @RequestBody JsonNode input) {
    return ai.analyze(access.require(request).id(), input);
  }
}
