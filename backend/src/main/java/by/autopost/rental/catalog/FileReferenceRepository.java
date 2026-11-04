package by.autopost.rental.catalog;

import static by.autopost.shared.Json.*;

import by.autopost.shared.ApiException;
import by.autopost.shared.Hashing;
import com.fasterxml.jackson.databind.JsonNode;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Set;
import java.util.TreeMap;
import java.util.TreeSet;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Repository;

@Repository
public class FileReferenceRepository implements ReferenceRepository {
  private static final Set<String> MANIFEST =
      Set.of(
          "format_version", "source_schema_version", "category_id", "common", "card", "platforms");
  private static final Set<String> PLATFORM = Set.of("schema", "plan", "browser");
  private final ReferenceFiles files;
  private ReferenceSnapshot cached;
  private Map<String, String> stamps = Map.of();

  public FileReferenceRepository(@Value("${autopost.rental-reference-dir:}") String directory) {
    files = new ReferenceFiles(directory);
  }

  @Override
  public synchronized ReferenceSnapshot snapshot() {
    if (cached != null
        && stamps.entrySet().stream().allMatch(e -> e.getValue().equals(files.stamp(e.getKey()))))
      return cached;
    var paths = new LinkedHashMap<String, String>();
    JsonNode manifest = read("manifest.json", paths);
    ReferenceValidator.keys(manifest, "manifest", MANIFEST);
    if (manifest.path("format_version").asInt() != 1)
      throw new ApiException(409, "Неподдерживаемый manifest справочников.");
    String category = text(manifest, "category_id");
    if (!category.matches("[a-z][a-z0-9_]{0,79}"))
      throw new ApiException(409, "Некорректная категория справочника.");
    if (!text(manifest, "source_schema_version").equals("1.2"))
      throw new ApiException(409, "Неподдерживаемая версия формата справочника.");
    JsonNode card = read(path(manifest, "card"), paths);
    JsonNode common = read(path(manifest, "common"), paths);
    var registry = manifest.path("platforms");
    if (!registry.isObject() || registry.isEmpty())
      throw new ApiException(409, "В справочнике отсутствует реестр площадок.");
    Map<String, JsonNode> schemas = new TreeMap<>(),
        plans = new TreeMap<>(),
        browsers = new TreeMap<>();
    var ids = new TreeSet<String>();
    registry.fieldNames().forEachRemaining(ids::add);
    for (String id : ids) {
      if (!id.matches("[a-z][a-z0-9_]{0,39}"))
        throw new ApiException(409, "Некорректный идентификатор площадки.");
      var entry = registry.path(id);
      ReferenceValidator.keys(entry, "manifest: площадка " + id, PLATFORM);
      JsonNode schema = read(path(entry, "schema"), paths);
      JsonNode plan = read(path(entry, "plan"), paths);
      SourceSchemaValidator.validate(schema);
      schemas.put(id, schema);
      plans.put(id, plan);
      if (entry.has("browser")) {
        var browser = read(path(entry, "browser"), paths);
        new BrowserRecipeValidator().validate(id, schemas.get(id), browser);
        browsers.put(id, browser);
      }
    }
    new ReferenceValidator().validate(category, common, card, schemas, plans);
    if (paths.entrySet().stream().anyMatch(e -> !e.getValue().equals(files.stamp(e.getKey()))))
      throw new ApiException(409, "Справочники изменились при чтении. Повторите запрос.");
    String cardVersion = Hashing.sha256(object("common", common, "card", card).toString());
    String integrationVersion =
        Hashing.sha256(
            object(
                    "manifest", manifest,
                    "schemas", schemas,
                    "plans", plans,
                    "browsers", browsers)
                .toString());
    ReferenceSnapshot next =
        new ReferenceSnapshot(
            category, common, card, schemas, plans, browsers, cardVersion, integrationVersion);
    cached = next;
    stamps = Map.copyOf(paths);
    return next;
  }

  private static String path(JsonNode entry, String key) {
    String path = text(entry, key);
    if (path.isBlank()) throw new ApiException(409, "В manifest не указан путь " + key + ".");
    return path;
  }

  private JsonNode read(String path, Map<String, String> paths) {
    paths.put(path, files.stamp(path));
    return files.read(path);
  }
}
