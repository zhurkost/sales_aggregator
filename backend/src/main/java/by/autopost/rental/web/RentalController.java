package by.autopost.rental.web;

import static by.autopost.shared.Json.*;

import by.autopost.Access;
import by.autopost.AddressService;
import by.autopost.rental.application.*;
import by.autopost.shared.ApiException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping({"/api/workspace/categories/{category}", "/api/workspace/rental"})
class RentalController {
  private final Access access;
  private final CategoryCatalogs catalogs;
  private final AddressService addresses;

  RentalController(
      Access access,
      CategoryCatalogs catalogs,
      AddressService addresses) {
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

  @PostMapping("/address/suggest")
  ObjectNode suggest(HttpServletRequest req, @PathVariable(required = false) String category, @RequestBody JsonNode input) {
    String workspace = access.require(req).workspace();
    catalogs.require(category);
    if (!input.path("query").isTextual()) throw new ApiException(400, "Введите адрес.");
    return addresses.suggest(workspace, input.get("query").asText());
  }

  @PostMapping("/address/select")
  ObjectNode select(HttpServletRequest req, @PathVariable(required = false) String category, @RequestBody JsonNode input) {
    String workspace = access.require(req).workspace();
    catalogs.require(category);
    return addresses.select(workspace, clean(input, "id", 80));
  }

  @PostMapping("/normalize")
  ObjectNode normalize(HttpServletRequest req, @PathVariable(required = false) String category, @RequestBody JsonNode input) {
    access.require(req);
    if (!input.isObject() || input.toString().length() > 250000)
      throw new ApiException(400, "Некорректная карточка.");
    return catalogs.require(category).catalog().normalize(input);
  }

  @PostMapping("/prepare")
  ObjectNode prepare(HttpServletRequest req, @PathVariable(required = false) String category, @RequestBody JsonNode input) {
    access.require(req);
    return catalogs.require(category).catalog().prepare(input);
  }

  @PostMapping("/applicability")
  ObjectNode applicability(HttpServletRequest req, @PathVariable(required = false) String category, @RequestBody JsonNode input) {
    access.require(req);
    return catalogs.require(category).catalog().applicability(input);
  }

  @PostMapping("/extension-config")
  ObjectNode extensionConfig(HttpServletRequest req, @PathVariable(required = false) String category, @RequestBody JsonNode input) {
    access.require(req);
    var selected = catalogs.require(category);
    return selected.publisher().configuration(input).put("categoryId", selected.id());
  }

}
