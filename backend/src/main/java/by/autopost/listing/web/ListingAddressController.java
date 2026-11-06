package by.autopost.listing.web;

import static by.autopost.shared.Json.clean;

import by.autopost.Access;
import by.autopost.AddressService;
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

/** Ищет адрес для карточки. Для подтверждения принимает идентификатор подсказки, выданной текущему кабинету. */
@RestController
@RequestMapping({ListingRoutes.CATEGORY, ListingRoutes.LEGACY_RENTAL})
class ListingAddressController {
  private final Access access;
  private final CategoryCatalogs catalogs;
  private final AddressService addresses;

  ListingAddressController(Access access, CategoryCatalogs catalogs, AddressService addresses) {
    this.access = access;
    this.catalogs = catalogs;
    this.addresses = addresses;
  }

  @PostMapping("/address/suggest")
  ObjectNode suggest(
      HttpServletRequest req,
      @PathVariable(required = false) String category,
      @RequestBody JsonNode input) {
    String workspace = access.require(req).workspace();
    catalogs.require(category);
    if (!input.path("query").isTextual()) throw new ApiException(400, "Введите адрес.");
    return addresses.suggest(workspace, input.get("query").asText());
  }

  @PostMapping("/address/select")
  ObjectNode select(
      HttpServletRequest req,
      @PathVariable(required = false) String category,
      @RequestBody JsonNode input) {
    String workspace = access.require(req).workspace();
    catalogs.require(category);
    return addresses.select(workspace, clean(input, "id", 80));
  }
}
