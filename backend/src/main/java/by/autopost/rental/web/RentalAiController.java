package by.autopost.rental.web;

import by.autopost.Access;
import by.autopost.rental.application.CategoryCatalogs;
import by.autopost.shared.ApiException;
import by.autopost.rental.ai.RentalAiService;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.web.bind.annotation.*;

@RestController
class RentalAiController {
  private final Access access;
  private final CategoryCatalogs catalogs;
  private final RentalAiService ai;

  RentalAiController(Access access, CategoryCatalogs catalogs, RentalAiService ai) {
    this.access = access;
    this.ai = ai;
    this.catalogs = catalogs;
  }

  @PostMapping({"/api/workspace/categories/{category}/analyze", "/api/workspace/rental/analyze"})
  ObjectNode analyze(HttpServletRequest request, @PathVariable(required = false) String category, @RequestBody JsonNode input) {
    var actor = access.require(request);
    var selected = catalogs.require(category);
    if (!"apartment_rental".equals(selected.analysis()))
      throw new ApiException(409, "Заполнение с ИИ для этой категории ещё не подключено.");
    return ai.analyze(selected.catalog(), actor.id(), actor.workspace(), input);
  }
}
