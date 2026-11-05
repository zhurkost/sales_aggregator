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
    return new EditorContract().project(new EditorSchemaBuilder().build(references.snapshot()));
  }

  public ObjectNode analysisSchema() {
    return new AnalysisSchemaBuilder().build(references.snapshot());
  }

  public ObjectNode applicability(JsonNode input) {
    ReferenceSnapshot snapshot = references.snapshot();
    if (!input.isObject() || input.toString().length() > 250000)
      throw new ApiException(400, "Некорректная карточка.");
    var fields = object();
    // Applicability also needs a valid schema when the user deselects all platforms.
    if (!text(input, "schemaVersion").equals(snapshot.version()))
      throw new ApiException(409, "Правила обновились. Обновите поля карточки.");
    if (input.path("platforms").isArray() && input.path("platforms").isEmpty())
      return object("platforms", fields, "schemaVersion", snapshot.version());
    for (var platform : prepare(snapshot, input).path("platforms"))
      fields.set(text(platform, "platform"), platform.path("applicability"));
    return object("platforms", fields, "schemaVersion", snapshot.version());
  }

  public String version() {
    return references.snapshot().version();
  }

  public JsonNode card() {
    return references.snapshot().card();
  }

  public JsonNode plan(String platform) {
    return references.snapshot().plan(platform);
  }

  public ObjectNode normalize(JsonNode draft) {
    return normalize(references.snapshot(), draft);
  }

  private ObjectNode normalize(ReferenceSnapshot snapshot, JsonNode draft) {
    if (!draft.isObject()) throw new ApiException(400, "Некорректная карточка.");
    return snapshot.card().path("version").asInt() < 2
        ? draft.deepCopy()
        : new CardMigration(snapshot).normalize(draft);
  }

  public ObjectNode prepare(JsonNode input) {
    ReferenceSnapshot snapshot = references.snapshot();
    return prepare(snapshot, input);
  }

  public ObjectNode browser(JsonNode input) {
    ReferenceSnapshot snapshot = references.snapshot();
    return new RentalBrowserPreparation().compile(snapshot, prepare(snapshot, input), input);
  }

  private ObjectNode prepare(ReferenceSnapshot snapshot, JsonNode input) {
    if (!text(input, "schemaVersion").equals(snapshot.version()))
      throw new ApiException(409, "Правила обновились. Обновите поля карточки.");
    input = normalize(snapshot, input);
    ObjectNode values =
        input.path("values").isObject() ? (ObjectNode) input.get("values").deepCopy() : object();
    JsonNode extras = input.path("extras");
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
      var specific = extras.path(platform);
      if (!specific.isObject() && !specific.isMissingNode())
        throw new ApiException(400, "Уточнения площадки должны быть объектом.");
      var prepared =
          new PreparationEngine()
              .prepare(
                  schema,
                  plan,
                  values,
                  specific.isObject() ? (ObjectNode) specific : object(),
                  input.path("address"));
      CardProjection.annotate(prepared, plan, input);
      output.add(prepared);
    }
    return object("platforms", output, "schemaVersion", snapshot.version());
  }
}
