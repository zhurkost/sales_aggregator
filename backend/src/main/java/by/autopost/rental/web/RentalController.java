package by.autopost.rental.web;

import static by.autopost.shared.Json.*;

import by.autopost.Access;
import by.autopost.rental.address.AddressService;
import by.autopost.rental.application.*;
import by.autopost.rental.model.Card;
import by.autopost.shared.ApiException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import jakarta.servlet.http.HttpServletRequest;
import java.util.List;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

/**
 * The HTTP boundary of the rental editor. A card arrives as JSON and becomes a {@link Card} here;
 * the card document itself is stored as written.
 */
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
  EditorSchema editor(HttpServletRequest req) {
    access.require(req);
    // The editor shows the server's limit; the server enforces it.
    return catalog.editor().with(addresses.configured(), RentalPhotoService.LIMIT);
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

  /** «Обновить поля карточки»: the same card document with the current card version. */
  @PostMapping("/normalize")
  ObjectNode normalize(HttpServletRequest req, @RequestBody JsonNode input) {
    access.require(req);
    var document = document(input);
    ObjectNode accepted = input.deepCopy();
    accepted.put("cardVersion", catalog.acceptRules(document.card()));
    return accepted;
  }

  /** The check of the card being edited: {id, draft}; the photos are those stored with it. */
  @PostMapping("/prepare")
  CardCheck prepare(HttpServletRequest req, @RequestBody JsonNode input) {
    String workspace = access.require(req).workspace();
    var card = document(input.path("draft")).card();
    return catalog.prepare(card, photos.count(workspace, clean(input, "id", 100)));
  }

  /** The card fields the editor shows for the card being edited: {draft}. */
  @PostMapping("/fields")
  FieldStates fields(HttpServletRequest req, @RequestBody JsonNode input) {
    access.require(req);
    return catalog.fields(document(input.path("draft")).card());
  }

  @GetMapping("/drafts")
  RentalDraftService.Drafts drafts(HttpServletRequest req) {
    return drafts.list(access.require(req).workspace());
  }

  @PostMapping("/extension-config")
  ExtensionLaunch extensionConfig(HttpServletRequest req, @RequestBody JsonNode input) {
    String workspace = access.require(req).workspace();
    if (!input.isObject()) throw new ApiException(400, "Некорректная карточка.");
    var card = document(input.path("draft")).card();
    return publication.configuration(workspace, clean(input, "id", 100), card);
  }

  @GetMapping("/drafts/{id}")
  RentalDraftService.Opened draft(HttpServletRequest req, @PathVariable String id) {
    return drafts.get(access.require(req).workspace(), id);
  }

  @PostMapping("/drafts/{id}")
  RentalDraftService.Saved save(
      HttpServletRequest req, @PathVariable String id, @RequestBody JsonNode input) {
    String workspace = access.require(req).workspace();
    var draft = document(input.path("draft"));
    return drafts.save(workspace, id, revision(input.path("revision"), 0), draft);
  }

  /**
   * A card of a request: an object of at most {@link #CARD_CHARACTERS} characters whose values the
   * server can read.
   */
  private static CardDocument document(JsonNode card) {
    String json = card.toString();
    if (json.length() > CARD_CHARACTERS) throw new ApiException(413, "Карточка слишком большая.");
    if (!card.isObject()) throw new ApiException(400, "Некорректная карточка.");
    try {
      return new CardDocument(json, typed(card, Card.class));
    } catch (IllegalArgumentException e) {
      throw new ApiException(400, "Некорректная карточка.");
    }
  }

  /** A revision the editor sent: a whole number from {@code min}. */
  private static int revision(JsonNode value, int min) {
    if (!value.isIntegralNumber() || !value.canConvertToInt() || value.asInt() < min)
      throw new ApiException(400, "Некорректная карточка.");
    return value.asInt();
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
  RentalDraftService.Deleted delete(
      HttpServletRequest req, @PathVariable String id, @RequestBody JsonNode input) {
    String workspace = access.require(req).workspace();
    var version = input.path("revision");
    if (!version.isIntegralNumber() || !version.canConvertToInt() || version.asInt() < 1)
      throw new ApiException(400, "Некорректная версия карточки.");
    return drafts.delete(workspace, id, version.asInt());
  }
}
