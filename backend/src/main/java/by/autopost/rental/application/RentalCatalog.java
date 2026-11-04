package by.autopost.rental.application;

import static by.autopost.shared.Json.*;

import by.autopost.rental.card.*;
import by.autopost.rental.catalog.*;
import by.autopost.rental.preparation.PreparationEngine;
import by.autopost.shared.ApiException;
import com.fasterxml.jackson.databind.JsonNode;
import by.autopost.rental.model.SchemaFields;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.fasterxml.jackson.databind.node.TextNode;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import org.springframework.stereotype.Service;

/** Application boundary. Each operation captures exactly one reference snapshot. */
@Service
public class RentalCatalog {
  private final ReferenceRepository references;

  public RentalCatalog(ReferenceRepository references) {
    this.references = references;
  }

  public ObjectNode editor() {
    return new EditorSchemaBuilder().build(references.snapshot());
  }

  /** Version of the card model the editor shows; a card stores the one it was edited under. */
  public String cardVersion() {
    return references.snapshot().cardVersion();
  }

  public JsonNode card() {
    return references.snapshot().card();
  }

  public JsonNode plan(String platform) {
    return references.snapshot().plan(platform);
  }

  /**
   * «Обновить поля карточки»: a card of the current model keeps its data and is checked against
   * the current rules from now on. Older cards are converted only by --migrate-rental-drafts.
   */
  public ObjectNode acceptRules(JsonNode draft) {
    if (!draft.isObject()) throw new ApiException(400, "Некорректная карточка.");
    CardMigration.requireCurrent(draft);
    ObjectNode accepted = draft.deepCopy();
    accepted.put("cardVersion", references.snapshot().cardVersion());
    return accepted;
  }

  /** The check of a card that has {@code photos} photos stored with it. */
  public ObjectNode prepare(JsonNode input, int photos) {
    ReferenceSnapshot snapshot = references.snapshot();
    return prepare(snapshot, input, photos);
  }

  public ObjectNode browser(JsonNode input, int photos) {
    ReferenceSnapshot snapshot = references.snapshot();
    return new RentalBrowserPreparation()
        .compile(snapshot, prepare(snapshot, input, photos), input);
  }

  /**
   * Only the card model is compared: plans, schemas and browser recipes may change under an open
   * card, the card's values keep their meaning and are prepared with the current rules.
   */
  private ObjectNode prepare(ReferenceSnapshot snapshot, JsonNode input, int photos) {
    if (!text(input, "cardVersion").equals(snapshot.cardVersion()))
      throw new ApiException(409, "Правила обновились. Обновите поля карточки.");
    if (!input.isObject()) throw new ApiException(400, "Некорректная карточка.");
    CardMigration.requireCurrent(input);
    ObjectNode values =
        input.path("values").isObject() ? (ObjectNode) input.get("values").deepCopy() : object();
    CardProjection.projectAddress(values, input.path("address"), snapshot.card());
    var selected = list(input.path("platforms"));
    if (selected.isEmpty() || selected.size() > snapshot.platforms().size())
      throw new ApiException(400, "Выберите доступные площадки.");
    ArrayNode output = array();
    Set<String> seen = new HashSet<>();
    for (var selectedPlatform : selected) {
      String platform = selectedPlatform.asText();
      if (!seen.add(platform)) continue;
      var schema = snapshot.schema(platform);
      var plan = snapshot.plan(platform);
      // A card of model 2 keeps every fact in values; platform extras are not a second source.
      var prepared =
          new PreparationEngine().prepare(schema, plan, values, object(), input.path("address"));
      var photoFields = photoFields(snapshot.browser(platform));
      requirePhotos(prepared, schema, photoFields, photos);
      CardProjection.annotate(prepared, plan, input);
      // What the form receives and what the user enters there: the check shows both.
      var transfer =
          snapshot.coverage(platform).transfer(prepared.path("values"), input.path("address"));
      var form = new ArrayList<CardTransfer.FormValue>();
      for (var value : transfer.form())
        if (!photoFields.contains(value.field())) form.add(value);
      if (photos > 0)
        for (String field : photoFields)
          form.add(
              new CardTransfer.FormValue(
                  field,
                  text(SchemaFields.fields(schema).get(field), "name"),
                  TextNode.valueOf(photos + " фото")));
      prepared.set("form", MAPPER.valueToTree(form));
      prepared.set("manual", MAPPER.valueToTree(transfer.manual()));
      // An automatic submission would publish the ad without the values entered by hand.
      if (!transfer.manual().isEmpty()) {
        ((ArrayNode) prepared.get("issues"))
            .add(
                object(
                    "field",
                    "",
                    "source",
                    "",
                    "code",
                    "manual_fields",
                    "message",
                    "Часть заполненных полей нужно ввести на площадке вручную — автоматическая"
                        + " подача выключена."));
        prepared.put("checksPassed", false);
      }
      output.add(prepared);
    }
    return object("platforms", output);
  }

  /** The fields the extension puts the stored photos into: the recipe's file inputs. */
  private static List<String> photoFields(JsonNode recipe) {
    var fields = new ArrayList<String>();
    for (var control : recipe.path("controls"))
      if (text(control, "action").equals("files")) fields.add(text(control, "field"));
    return fields;
  }

  /**
   * A photo field is filled from the photos stored with the card, not from the links in the card:
   * the plan's own «required» remark on it is replaced by this one. A platform whose schema
   * requires the field gets the remark when the card has no photo, instead of a launch without
   * photos.
   */
  private static void requirePhotos(
      ObjectNode prepared, JsonNode schema, List<String> photoFields, int photos) {
    var issues = (ArrayNode) prepared.get("issues");
    var fields = SchemaFields.fields(schema);
    for (String field : photoFields) {
      for (int i = issues.size() - 1; i >= 0; i--)
        if (text(issues.get(i), "field").equals(field)
            && text(issues.get(i), "code").equals("required")) issues.remove(i);
      if (photos == 0 && fields.get(field).path("fill_rule").path("required").asBoolean(false))
        issues.add(
            object(
                "field",
                field,
                "source",
                "photos",
                "code",
                "photos_required",
                "message",
                "Добавьте фотографии квартиры: площадка не публикует объявление без фото."));
    }
  }
}
