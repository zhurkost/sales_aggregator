package by.autopost.rental.catalog;

import static by.autopost.rental.catalog.ReferenceValidator.check;
import static by.autopost.shared.Json.*;

import by.autopost.rental.engine.PlatformCoverage;
import by.autopost.rental.model.CardModel;
import by.autopost.rental.model.FormRecipe;
import by.autopost.rental.model.Mapping;
import by.autopost.rental.model.Schema;
import by.autopost.shared.Hashing;
import com.fasterxml.jackson.databind.JsonNode;
import java.util.Map;
import java.util.TreeMap;
import java.util.TreeSet;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Repository;

/**
 * The reference bundle of this release, read, parsed into records and validated once when the
 * application starts. A broken bundle throws {@link ReferenceBundleException} with the file and the
 * reason, so the application does not start. Files are never re-read: a new bundle is a new
 * release.
 */
@Repository
public class FileReferenceRepository implements ReferenceRepository {
  private static final String MANIFEST_FILE = "manifest.json";
  private final ReferenceSnapshot loaded;

  public FileReferenceRepository(@Value("${autopost.rental-reference-dir:}") String directory) {
    loaded = load(new ReferenceFiles(directory));
  }

  /** The loaded bundle: immutable, so every operation shares it. */
  @Override
  public ReferenceSnapshot snapshot() {
    return loaded;
  }

  private static ReferenceSnapshot load(ReferenceFiles files) {
    JsonNode manifestJson = files.read(MANIFEST_FILE);
    var manifest = files.typed(MANIFEST_FILE, manifestJson, Manifest.class);
    files.check(MANIFEST_FILE, () -> manifest(manifest));
    String category = manifest.categoryId();
    JsonNode commonJson = files.read(manifest.common());
    var common = files.typed(manifest.common(), commonJson, Schema.class);
    var canonical = files.checked(manifest.common(), () -> ReferenceValidator.common(common));
    var ids = new TreeSet<>(manifest.platforms().keySet());
    JsonNode cardJson = files.read(manifest.card());
    var card = files.typed(manifest.card(), cardJson, CardModel.class);
    files.check(manifest.card(), () -> ReferenceValidator.card(card, canonical, ids));
    Map<String, JsonNode> schemas = new TreeMap<>(), plans = new TreeMap<>(), browsers = new TreeMap<>();
    Map<String, ReferenceSnapshot.Platform> platforms = new TreeMap<>();
    for (String id : ids) {
      var entry = manifest.platforms().get(id);
      JsonNode schemaJson = files.read(entry.schema());
      files.check(entry.schema(), () -> SourceSchemaValidator.validate(schemaJson));
      var schema = files.typed(entry.schema(), schemaJson, Schema.class);
      var graph = files.checked(entry.schema(), () -> ReferenceValidator.schema(id, schema));
      JsonNode planJson = files.read(entry.plan());
      var plan = files.typed(entry.plan(), planJson, Mapping.class);
      files.check(
          entry.plan(), () -> ReferenceValidator.plan(category, canonical, id, schema, graph, plan));
      JsonNode browserJson = files.read(entry.browser());
      var form = files.typed(entry.browser(), browserJson, FormRecipe.class);
      files.check(entry.browser(), () -> new BrowserRecipeValidator().validate(id, schema, form));
      // Named after the plan: it marks what the recipe does not fill.
      var coverage =
          files.checked(
              entry.plan(),
              () -> {
                ReferenceValidator.manualWithoutControl(id, plan, form);
                var computed = PlatformCoverage.of(id, schema, plan, form, graph);
                ReferenceValidator.everyFieldReachesTheForm(computed);
                return computed;
              });
      schemas.put(id, schemaJson);
      plans.put(id, planJson);
      browsers.put(id, browserJson);
      platforms.put(id, new ReferenceSnapshot.Platform(id, schema, plan, form, coverage));
    }
    // The versions are hashes of the files as they are written, not of the records.
    String cardVersion = Hashing.sha256(object("common", commonJson, "card", cardJson).toString());
    String integrationVersion =
        Hashing.sha256(
            object(
                    "manifest", manifestJson,
                    "schemas", schemas,
                    "plans", plans,
                    "browsers", browsers)
                .toString());
    return new ReferenceSnapshot(
        category, common, card, platforms, cardVersion, integrationVersion);
  }

  /** manifest.json: its format, the category and the files of every platform. */
  private static void manifest(Manifest manifest) {
    check(
        manifest.formatVersion() != null && manifest.formatVersion() == 1,
        "неподдерживаемый format_version");
    check(
        manifest.categoryId().matches("[a-z][a-z0-9_]{0,79}"),
        "некорректная категория " + manifest.categoryId());
    check(
        "1.2".equals(manifest.sourceSchemaVersion()),
        "неподдерживаемая версия формата схем " + manifest.sourceSchemaVersion());
    check(!manifest.common().isBlank(), "в manifest не указан путь common");
    check(!manifest.card().isBlank(), "в manifest не указан путь card");
    check(!manifest.platforms().isEmpty(), "в manifest нет реестра площадок");
    manifest
        .platforms()
        .forEach(
            (id, files) -> {
              check(id.matches("[a-z][a-z0-9_]{0,39}"), "некорректный идентификатор площадки " + id);
              for (var path :
                  Map.of("schema", files.schema(), "plan", files.plan(), "browser", files.browser())
                      .entrySet())
                check(
                    !path.getValue().isBlank(),
                    "в manifest не указан путь " + path.getKey() + " площадки " + id);
            });
  }
}
