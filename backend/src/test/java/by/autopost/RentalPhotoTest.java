package by.autopost;

import static by.autopost.shared.Json.*;
import static org.junit.jupiter.api.Assertions.*;

import by.autopost.rental.application.RentalDraftService;
import by.autopost.rental.application.RentalPhotoRepository.PhotoInfo;
import by.autopost.rental.application.RentalPhotoService;
import by.autopost.rental.application.RentalPhotoService.NewPhoto;
import by.autopost.shared.ApiException;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.Base64;
import java.util.List;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.function.Executable;
import org.junit.jupiter.api.io.TempDir;

class RentalPhotoTest {
  @TempDir Path dir;
  RentalStorage storage;
  RentalDraftService drafts;
  RentalPhotoService photos;

  static final byte[] JPEG = {(byte) 0xFF, (byte) 0xD8, (byte) 0xFF, (byte) 0xE0, 1, 2, 3};
  static final byte[] PNG = {(byte) 0x89, 'P', 'N', 'G', 0x0D, 0x0A, 0x1A, 0x0A, 0, 0};
  static final byte[] WEBP = {'R', 'I', 'F', 'F', 9, 0, 0, 0, 'W', 'E', 'B', 'P', 1};

  static NewPhoto photo(String name, String type, byte[] data) {
    return new NewPhoto(
        name, "data:" + type + ";base64," + Base64.getEncoder().encodeToString(data));
  }

  static NewPhoto jpeg(String name) {
    return photo(name, "image/jpeg", JPEG);
  }

  @BeforeEach
  void setUp() {
    storage = RentalStorage.at(dir.resolve("workspace.sqlite"));
    drafts = storage.draftService();
    photos = new RentalPhotoService(storage.drafts, storage.photos);
    drafts.save("owner", "flat", object("revision", 0, "draft", card()));
  }

  static com.fasterxml.jackson.databind.node.ObjectNode card() {
    return object("modelVersion", 2, "values", object());
  }

  static List<String> names(List<PhotoInfo> list) {
    return list.stream().map(PhotoInfo::name).toList();
  }

  static int status(Executable call) {
    return assertThrows(ApiException.class, call).status;
  }

  @Test
  void photosAreStoredInOrderAndEachChangeIsANewRevisionOfTheCard() {
    var added =
        photos.add(
            "owner",
            "flat",
            1,
            List.of(jpeg("one.jpg"), photo("two.png", "image/png", PNG)));
    assertEquals(2, added.revision());
    assertEquals(List.of("one.jpg", "two.png"), names(added.photos()));
    assertEquals(
        List.of("image/jpeg", "image/png"), added.photos().stream().map(PhotoInfo::type).toList());
    assertEquals(JPEG.length, added.photos().get(0).size());
    var more = photos.add("owner", "flat", 2, List.of(photo("three.webp", "image/webp", WEBP)));
    assertEquals(List.of("one.jpg", "two.png", "three.webp"), names(more.photos()));
    var ids = more.photos().stream().map(PhotoInfo::id).toList();
    var ordered = photos.reorder("owner", "flat", 3, List.of(ids.get(2), ids.get(0), ids.get(1)));
    assertEquals(List.of("three.webp", "one.jpg", "two.png"), names(ordered.photos()));
    var removed = photos.remove("owner", "flat", 4, ids.get(0));
    assertEquals(5, removed.revision());
    assertEquals(List.of("three.webp", "two.png"), names(removed.photos()));
    // The card itself is unchanged; the editor saves on top of the revision the photos produced.
    var card = drafts.get("owner", "flat");
    assertEquals(5, card.path("revision").asInt());
    assertEquals(card(), card.path("draft"));
    assertEquals(
        List.of("three.webp", "two.png"),
        list(card.path("photos")).stream().map(p -> text(p, "name")).toList());
    assertEquals(
        409,
        status(() -> drafts.save("owner", "flat", object("revision", 4, "draft", card()))));
    drafts.save("owner", "flat", object("revision", 5, "draft", card()));
    assertArrayEquals(WEBP, photos.file("owner", "flat", ids.get(2)).data());
  }

  @Test
  void theExtensionReceivesThePhotosAsDataUrlsInTheirOrder() {
    photos.add("owner", "flat", 1, List.of(jpeg("one.jpg"), photo("two.png", "image/png", PNG)));
    var forExtension = photos.forExtension("owner", "flat");
    assertEquals(List.of("one.jpg", "two.png"), forExtension.stream().map(p -> p.name()).toList());
    assertEquals(
        "data:image/png;base64," + Base64.getEncoder().encodeToString(PNG),
        forExtension.get(1).dataUrl());
    assertTrue(photos.forExtension("other", "flat").isEmpty());
  }

  @Test
  void aCardHasAtMostTwelvePhotosOfTheAcceptedFormats() {
    var eleven = new ArrayList<NewPhoto>();
    for (int i = 0; i < 11; i++) eleven.add(jpeg(i + ".jpg"));
    photos.add("owner", "flat", 1, eleven);
    var error =
        assertThrows(
            ApiException.class,
            () -> photos.add("owner", "flat", 2, List.of(jpeg("a.jpg"), jpeg("b.jpg"))));
    assertEquals(400, error.status);
    assertEquals("У квартиры может быть до 12 фотографий.", error.getMessage());
    assertEquals(12, photos.add("owner", "flat", 2, List.of(jpeg("a.jpg"))).photos().size());
    assertEquals(3, drafts.get("owner", "flat").path("revision").asInt());
  }

  @Test
  void onlyCompressedJpgPngOrWebpImagesAreAccepted() {
    var gif = photo("anim.gif", "image/gif", new byte[] {'G', 'I', 'F', '8', '9', 'a'});
    var pretending = photo("fake.jpg", "image/jpeg", PNG);
    var html = photo("page.png", "image/png", "<html><script>".getBytes());
    var broken = new NewPhoto("x.jpg", "data:image/jpeg;base64,/9j");
    var bytes = new byte[263_000];
    System.arraycopy(JPEG, 0, bytes, 0, JPEG.length);
    var huge = photo("big.jpg", "image/jpeg", bytes);
    for (var wrong : List.of(gif, pretending, html, broken, huge, new NewPhoto("x", null)))
      assertEquals(400, status(() -> photos.add("owner", "flat", 1, List.of(wrong))), wrong.name());
    assertEquals(400, status(() -> photos.add("owner", "flat", 1, List.of())));
    assertTrue(photos.list("owner", "flat").isEmpty());
    assertEquals(1, drafts.get("owner", "flat").path("revision").asInt());
    // A file name never carries a path or control characters.
    var stored = photos.add("owner", "flat", 1, List.of(jpeg("../dir\\name\n.jpg"), jpeg(" ")));
    assertEquals(List.of("..dirname.jpg", "photo.jpg"), names(stored.photos()));
  }

  @Test
  void photosOfAnotherCabinetDoNotExistForThisOne() {
    var id = photos.add("owner", "flat", 1, List.of(jpeg("one.jpg"))).photos().get(0).id();
    assertTrue(photos.list("other", "flat").isEmpty());
    assertEquals(404, status(() -> photos.file("other", "flat", id)));
    assertEquals(404, status(() -> photos.add("other", "flat", 2, List.of(jpeg("x.jpg")))));
    assertEquals(404, status(() -> photos.remove("other", "flat", 2, id)));
    assertEquals(404, status(() -> photos.reorder("other", "flat", 2, List.of())));
    assertEquals(1, photos.list("owner", "flat").size());
    assertEquals(2, drafts.get("owner", "flat").path("revision").asInt());
  }

  @Test
  void changesNeedTheCurrentRevisionAndTheCompleteOrder() {
    var ids =
        photos.add("owner", "flat", 1, List.of(jpeg("one.jpg"), jpeg("two.jpg"))).photos().stream()
            .map(PhotoInfo::id)
            .toList();
    assertEquals(409, status(() -> photos.add("owner", "flat", 1, List.of(jpeg("x.jpg")))));
    assertEquals(409, status(() -> photos.remove("owner", "flat", 1, ids.get(0))));
    assertEquals(409, status(() -> photos.reorder("owner", "flat", 1, ids)));
    assertEquals(400, status(() -> photos.reorder("owner", "flat", 2, List.of(ids.get(0)))));
    assertEquals(
        400, status(() -> photos.reorder("owner", "flat", 2, List.of(ids.get(0), ids.get(0)))));
    assertEquals(404, status(() -> photos.remove("owner", "flat", 2, "missing")));
    assertEquals(400, status(() -> photos.add("owner", "flat", null, List.of(jpeg("x.jpg")))));
    assertEquals(2, photos.list("owner", "flat").size());
    assertEquals(2, drafts.get("owner", "flat").path("revision").asInt());
  }

  @Test
  void deletingACardDeletesItsPhotos() {
    photos.add("owner", "flat", 1, List.of(jpeg("one.jpg")));
    drafts.save("other", "flat", object("revision", 0, "draft", card()));
    photos.add("other", "flat", 1, List.of(jpeg("theirs.jpg")));
    drafts.delete("owner", "flat", object("revision", 2));
    assertEquals(0, storage.photos.count("owner", "flat"));
    assertEquals(1, storage.photos.count("other", "flat"));
  }
}
