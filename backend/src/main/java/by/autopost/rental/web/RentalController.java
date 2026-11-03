package by.autopost.rental.web;

import static by.autopost.shared.Json.*;

import by.autopost.Access;
import by.autopost.rental.address.AddressService;
import by.autopost.rental.application.*;
import by.autopost.shared.ApiException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/workspace/rental")
class RentalController {
  /** The only size limit of a rental card, for every endpoint that receives one. */
  static final int CARD_CHARACTERS = 250_000;

  private final Access access;
  private final RentalCatalog catalog;
  private final AddressService addresses;
  private final RentalDraftService drafts;
  private final RentalPublicationService publication;

  RentalController(
      Access access,
      RentalCatalog catalog,
      AddressService addresses,
      RentalDraftService drafts,
      RentalPublicationService publication) {
    this.access = access;
    this.catalog = catalog;
    this.addresses = addresses;
    this.drafts = drafts;
    this.publication = publication;
  }

  @GetMapping("/editor")
  ObjectNode editor(HttpServletRequest req) {
    access.require(req);
    ObjectNode result = catalog.editor();
    result.put("addressSuggestions", addresses.configured());
    return result;
  }

  @PostMapping("/address/suggest")
  ObjectNode suggest(HttpServletRequest req, @RequestBody JsonNode input) {
    String workspace = access.require(req).workspace();
    if (!input.path("query").isTextual()) throw new ApiException(400, "Введите адрес.");
    return addresses.suggest(workspace, input.get("query").asText());
  }

  @PostMapping("/address/select")
  ObjectNode select(HttpServletRequest req, @RequestBody JsonNode input) {
    return addresses.select(access.require(req).workspace(), clean(input, "id", 80));
  }

  @PostMapping("/normalize")
  ObjectNode normalize(HttpServletRequest req, @RequestBody JsonNode input) {
    access.require(req);
    return catalog.normalize(card(input));
  }

  @PostMapping("/prepare")
  ObjectNode prepare(HttpServletRequest req, @RequestBody JsonNode input) {
    access.require(req);
    return catalog.prepare(card(input));
  }

  @GetMapping("/drafts")
  ObjectNode drafts(HttpServletRequest req) {
    return drafts.list(access.require(req).workspace());
  }

  @PostMapping("/extension-config")
  ObjectNode extensionConfig(HttpServletRequest req, @RequestBody JsonNode input) {
    String workspace = access.require(req).workspace();
    card(input.path("draft"));
    return publication.configuration(workspace, input);
  }

  @GetMapping("/drafts/{id}")
  ObjectNode draft(HttpServletRequest req, @PathVariable String id) {
    return drafts.get(access.require(req).workspace(), id);
  }

  @PostMapping("/drafts/{id}")
  ObjectNode save(HttpServletRequest req, @PathVariable String id, @RequestBody JsonNode input) {
    String workspace = access.require(req).workspace();
    card(input.path("draft"));
    return drafts.save(workspace, id, input);
  }

  private static JsonNode card(JsonNode card) {
    if (card.toString().length() > CARD_CHARACTERS)
      throw new ApiException(413, "Карточка слишком большая.");
    return card;
  }

  @PostMapping("/drafts/{id}/delete")
  ObjectNode delete(HttpServletRequest req, @PathVariable String id, @RequestBody JsonNode input) {
    return drafts.delete(access.require(req).workspace(), id, input);
  }
}
