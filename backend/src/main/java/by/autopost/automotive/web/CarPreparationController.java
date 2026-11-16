package by.autopost.automotive.web;
import by.autopost.Access;
import by.autopost.automotive.application.CarPreparationService;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.web.bind.annotation.*;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
/** Produces mapped site values and declarative extension jobs; never publishes ads. */
@RestController
@RequestMapping("/api/workspace/categories/cars_used_sale")
class CarPreparationController {
  private final Access access;private final CarPreparationService service;
  CarPreparationController(Access access,CarPreparationService service){this.access=access;this.service=service;}
  @PostMapping("/prepare") ObjectNode prepare(HttpServletRequest r,@RequestBody JsonNode input){access.require(r);return service.prepare(input);}
  @PostMapping("/extension-config") ObjectNode config(HttpServletRequest r,@RequestBody JsonNode input){access.require(r);return service.configuration(input);}
}
