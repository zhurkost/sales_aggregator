package by.autopost.rental.application;

import static by.autopost.shared.Json.*;

import by.autopost.rental.card.*;
import by.autopost.rental.catalog.*;
import by.autopost.rental.preparation.PreparationEngine;
import by.autopost.shared.ApiException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.util.HashSet;
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

  public ObjectNode prepare(JsonNode input) {
    ReferenceSnapshot snapshot = references.snapshot();
    return prepare(snapshot, input);
  }

  public ObjectNode browser(JsonNode input) {
    ReferenceSnapshot snapshot = references.snapshot();
    return new RentalBrowserPreparation().compile(snapshot, prepare(snapshot, input), input);
  }

  /**
   * Only the card model is compared: plans, schemas and browser recipes may change under an open
   * card, the card's values keep their meaning and are prepared with the current rules.
   */
  private ObjectNode prepare(ReferenceSnapshot snapshot, JsonNode input) {
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
      CardProjection.annotate(prepared, plan, input);
      output.add(prepared);
    }
    return object("platforms", output);
  }
}
