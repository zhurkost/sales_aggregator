package by.autopost.listing.web;

import by.autopost.Access;
import by.autopost.AddressService;
import by.autopost.rental.application.CategoryCatalogs;
import by.autopost.shared.ApiException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping({ListingRoutes.CATEGORY, ListingRoutes.LEGACY_RENTAL})
class ListingEditorController {
  private final Access access;
  private final CategoryCatalogs catalogs;
  private final AddressService addresses;

  ListingEditorController(Access access, CategoryCatalogs catalogs, AddressService addresses) {
    this.access = access;
    this.catalogs = catalogs;
    this.addresses = addresses;
  }

  @GetMapping("/editor")
  ObjectNode editor(HttpServletRequest req, @PathVariable(required = false) String category) {
    access.require(req);
    var selected = catalogs.require(category);
    ObjectNode result = selected.catalog().editor();
    result.put("categoryId", selected.id());
    result.put("publicationEnabled", selected.publication());
    result.put("addressSuggestions", addresses.configured());
    return result;
  }

  @PostMapping("/normalize")
  ObjectNode normalize(
      HttpServletRequest req,
      @PathVariable(required = false) String category,
      @RequestBody JsonNode input) {
    access.require(req);
    if (!input.isObject() || input.toString().length() > 250000)
      throw new ApiException(400, "Некорректная карточка.");
    return catalogs.require(category).catalog().normalize(input);
  }
}
