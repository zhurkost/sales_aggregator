package by.autopost.listing.web;

import by.autopost.Access;
import by.autopost.rental.application.CategoryCatalogs;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/** По запросу расширения готовит значения и инструкции для заполнения форм. Открытием вкладок управляет расширение. */
@RestController
@RequestMapping({ListingRoutes.CATEGORY, ListingRoutes.LEGACY_RENTAL})
class ListingPublicationController {
  private final Access access;
  private final CategoryCatalogs catalogs;

  ListingPublicationController(Access access, CategoryCatalogs catalogs) {
    this.access = access;
    this.catalogs = catalogs;
  }

  @PostMapping("/extension-config")
  ObjectNode extensionConfig(
      HttpServletRequest req,
      @PathVariable(required = false) String category,
      @RequestBody JsonNode input) {
    access.require(req);
    var selected = catalogs.require(category);
    return selected.publisher().configuration(input).put("categoryId", selected.id());
  }
}
