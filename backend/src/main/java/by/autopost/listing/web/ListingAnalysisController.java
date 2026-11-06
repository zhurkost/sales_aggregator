package by.autopost.listing.web;

import by.autopost.Access;
import by.autopost.rental.ai.RentalAiService;
import by.autopost.rental.application.CategoryCatalogs;
import by.autopost.shared.ApiException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/** Извлекает из описания предложения по полям схемы выбранной категории. Редактор применяет их к карточке. */
@RestController
@RequestMapping({ListingRoutes.CATEGORY, ListingRoutes.LEGACY_RENTAL})
class ListingAnalysisController {
  private final Access access;
  private final CategoryCatalogs catalogs;
  private final RentalAiService ai;

  ListingAnalysisController(Access access, CategoryCatalogs catalogs, RentalAiService ai) {
    this.access = access;
    this.catalogs = catalogs;
    this.ai = ai;
  }

  @PostMapping("/analyze")
  ObjectNode analyze(
      HttpServletRequest request,
      @PathVariable(required = false) String category,
      @RequestBody JsonNode input) {
    var actor = access.require(request);
    var selected = catalogs.require(category);
    if (!java.util.Set.of("apartment_rental", "apartment_sale").contains(selected.analysis()))
      throw new ApiException(409, "Заполнение с ИИ для этой категории ещё не подключено.");
    return ai.analyze(selected.catalog(), selected.analysis(), actor.id(), actor.workspace(), input);
  }
}
