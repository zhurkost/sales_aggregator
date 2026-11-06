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

@RestController
@RequestMapping({ListingRoutes.CATEGORY, ListingRoutes.LEGACY_RENTAL})
class ListingPreparationController {
  private final Access access;
  private final CategoryCatalogs catalogs;

  ListingPreparationController(Access access, CategoryCatalogs catalogs) {
    this.access = access;
    this.catalogs = catalogs;
  }

  @PostMapping("/applicability")
  ObjectNode applicability(
      HttpServletRequest req,
      @PathVariable(required = false) String category,
      @RequestBody JsonNode input) {
    access.require(req);
    return catalogs.require(category).catalog().applicability(input);
  }

  @PostMapping("/prepare")
  ObjectNode prepare(
      HttpServletRequest req,
      @PathVariable(required = false) String category,
      @RequestBody JsonNode input) {
    access.require(req);
    return catalogs.require(category).catalog().prepare(input);
  }
}
