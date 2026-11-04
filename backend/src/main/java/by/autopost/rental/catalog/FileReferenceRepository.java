package by.autopost.rental.catalog;

import static by.autopost.rental.catalog.ReferenceValidator.check;
import static by.autopost.shared.Json.*;

import by.autopost.shared.Hashing;
import com.fasterxml.jackson.databind.JsonNode;
import java.util.Map;
import java.util.Set;
import java.util.TreeMap;
import java.util.TreeSet;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Repository;

/**
 * The reference bundle of this release, read and validated once when the application starts. A
 * broken bundle throws {@link ReferenceBundleException} with the file and the reason, so the
 * application does not start. Files are never re-read: a new bundle is a new release.
 */
@Repository
public class FileReferenceRepository implements ReferenceRepository {
  private static final String MANIFEST_FILE = "manifest.json";
  private static final Set<String> MANIFEST =
      Set.of(
          "format_version", "source_schema_version", "category_id", "common", "card", "platforms");
  private static final Set<String> PLATFORM = Set.of("schema", "plan", "browser");
  private final ReferenceSnapshot loaded;

  public FileReferenceRepository(@Value("${autopost.rental-reference-dir:}") String directory) {
    loaded = load(new ReferenceFiles(directory));
  }

  /** A view of its own for one operation; the loaded bundle itself is never handed out. */
  @Override
  public ReferenceSnapshot snapshot() {
    return loaded.view();
  }

  private static ReferenceSnapshot load(ReferenceFiles files) {
    JsonNode manifest = files.read(MANIFEST_FILE);
    files.check(MANIFEST_FILE, () -> manifest(manifest));
    String category = text(manifest, "category_id");
    String commonFile = text(manifest, "common"), cardFile = text(manifest, "card");
    JsonNode common = files.read(commonFile);
    var canonical = files.checked(commonFile, () -> ReferenceValidator.common(common));
    var ids = new TreeSet<String>();
    manifest.path("platforms").fieldNames().forEachRemaining(ids::add);
    JsonNode card = files.read(cardFile);
    files.check(cardFile, () -> ReferenceValidator.card(card, canonical, ids));
    Map<String, JsonNode> schemas = new TreeMap<>(),
        plans = new TreeMap<>(),
        browsers = new TreeMap<>();
    Map<String, PlatformCoverage> coverage = new TreeMap<>();
    for (String id : ids) {
      var entry = manifest.path("platforms").path(id);
      String schemaFile = text(entry, "schema"), planFile = text(entry, "plan");
      JsonNode schema = files.read(schemaFile);
      var graph =
          files.checked(
              schemaFile,
              () -> {
                SourceSchemaValidator.validate(schema);
                return ReferenceValidator.schema(id, schema);
              });
      JsonNode plan = files.read(planFile);
      files.check(
          planFile, () -> ReferenceValidator.plan(category, canonical, id, schema, graph, plan));
      schemas.put(id, schema);
      plans.put(id, plan);
      String browserFile = text(entry, "browser");
      JsonNode browser = files.read(browserFile);
      files.check(browserFile, () -> new BrowserRecipeValidator().validate(id, schema, browser));
      browsers.put(id, browser);
      // Named after the plan: it marks what the recipe does not fill.
      coverage.put(
          id, files.checked(planFile, () -> PlatformCoverage.of(id, schema, plan, browser, graph)));
    }
    String cardVersion = Hashing.sha256(object("common", common, "card", card).toString());
    String integrationVersion =
        Hashing.sha256(
            object(
                    "manifest", manifest,
                    "schemas", schemas,
                    "plans", plans,
                    "browsers", browsers)
                .toString());
    return new ReferenceSnapshot(
        category,
        common,
        card,
        schemas,
        plans,
        browsers,
        coverage,
        cardVersion,
        integrationVersion);
  }

  /** manifest.json: its format, the category and the files of every platform. */
  private static void manifest(JsonNode manifest) {
    ReferenceValidator.keys(manifest, "manifest", MANIFEST);
    check(manifest.path("format_version").asInt() == 1, "неподдерживаемый format_version");
    check(
        text(manifest, "category_id").matches("[a-z][a-z0-9_]{0,79}"),
        "некорректная категория " + text(manifest, "category_id"));
    check(
        text(manifest, "source_schema_version").equals("1.2"),
        "неподдерживаемая версия формата схем " + text(manifest, "source_schema_version"));
    for (String key : Set.of("common", "card"))
      check(!text(manifest, key).isBlank(), "в manifest не указан путь " + key);
    var registry = manifest.path("platforms");
    check(registry.isObject() && !registry.isEmpty(), "в manifest нет реестра площадок");
    registry
        .fields()
        .forEachRemaining(
            platform -> {
              String id = platform.getKey();
              check(id.matches("[a-z][a-z0-9_]{0,39}"), "некорректный идентификатор площадки " + id);
              ReferenceValidator.keys(platform.getValue(), "manifest: площадка " + id, PLATFORM);
              // A plan without a form recipe would transfer nothing: every platform has both.
              for (String key : PLATFORM)
                check(
                    !text(platform.getValue(), key).isBlank(),
                    "в manifest не указан путь " + key + " площадки " + id);
            });
  }
}
