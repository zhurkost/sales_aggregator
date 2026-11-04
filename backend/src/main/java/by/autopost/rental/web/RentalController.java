package by.autopost.rental.web;

import static by.autopost.shared.Json.*;

import by.autopost.Access;
import by.autopost.rental.address.AddressService;
import by.autopost.rental.application.*;
import by.autopost.shared.ApiException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import jakarta.servlet.http.HttpServletRequest;
import java.util.List;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
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
  private final RentalPhotoService photos;

  RentalController(
      Access access,
      RentalCatalog catalog,
      AddressService addresses,
      RentalDraftService drafts,
      RentalPublicationService publication,
      RentalPhotoService photos) {
    this.access = access;
    this.catalog = catalog;
    this.addresses = addresses;
    this.drafts = drafts;
    this.publication = publication;
    this.photos = photos;
  }

  /** Photos the editor adds to the end of the card, compressed, with the revision it saw. */
  record PhotoUpload(Integer revision, List<RentalPhotoService.NewPhoto> photos) {}

  record PhotoRemoval(Integer revision, String photo) {}

  /** The new order of all photos of the card. */
  record PhotoOrder(Integer revision, List<String> order) {}

  /** What the extension reports through the Autopost tab. */
  record PublicationReport(String status, String message) {}

  record PublicationLink(String url) {}

  @GetMapping("/editor")
  ObjectNode editor(HttpServletRequest req) {
    access.require(req);
    ObjectNode result = catalog.editor();
    result.put("addressSuggestions", addresses.configured());
    // The editor shows the server's limit; the server enforces it.
    result.put("photoLimit", RentalPhotoService.LIMIT);
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
    return catalog.acceptRules(card(input));
  }

  /** The check of the card being edited: {id, draft}; the photos are those stored with it. */
  @PostMapping("/prepare")
  ObjectNode prepare(HttpServletRequest req, @RequestBody JsonNode input) {
    String workspace = access.require(req).workspace();
    var draft = card(input.path("draft"));
    if (!draft.isObject()) throw new ApiException(400, "Некорректная карточка.");
    return catalog.prepare(draft, photos.count(workspace, clean(input, "id", 100)));
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

  @GetMapping("/drafts/{id}/photos/{photo}")
  ResponseEntity<byte[]> photo(
      HttpServletRequest req, @PathVariable String id, @PathVariable String photo) {
    var file = photos.file(access.require(req).workspace(), id, photo);
    return ResponseEntity.ok().contentType(MediaType.parseMediaType(file.type())).body(file.data());
  }

  @PostMapping("/drafts/{id}/photos")
  RentalPhotoService.Photos addPhotos(
      HttpServletRequest req, @PathVariable String id, @RequestBody PhotoUpload input) {
    return photos.add(access.require(req).workspace(), id, input.revision(), input.photos());
  }

  @PostMapping("/drafts/{id}/photos/delete")
  RentalPhotoService.Photos removePhoto(
      HttpServletRequest req, @PathVariable String id, @RequestBody PhotoRemoval input) {
    return photos.remove(access.require(req).workspace(), id, input.revision(), input.photo());
  }

  @PostMapping("/drafts/{id}/photos/order")
  RentalPhotoService.Photos orderPhotos(
      HttpServletRequest req, @PathVariable String id, @RequestBody PhotoOrder input) {
    return photos.reorder(access.require(req).workspace(), id, input.revision(), input.order());
  }

  @PostMapping("/publications/{id}")
  RentalPublicationRepository.Publication report(
      HttpServletRequest req, @PathVariable String id, @RequestBody PublicationReport input) {
    return publication.report(
        access.require(req).workspace(), id, input.status(), input.message());
  }

  @PostMapping("/publications/{id}/link")
  RentalPublicationRepository.Publication link(
      HttpServletRequest req, @PathVariable String id, @RequestBody PublicationLink input) {
    return publication.link(access.require(req).workspace(), id, input.url());
  }

  @PostMapping("/drafts/{id}/delete")
  ObjectNode delete(HttpServletRequest req, @PathVariable String id, @RequestBody JsonNode input) {
    return drafts.delete(access.require(req).workspace(), id, input);
  }
}
