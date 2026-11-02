package by.autopost.rental.catalog;

import static by.autopost.shared.Json.*;

import by.autopost.shared.ApiException;
import by.autopost.shared.Hashing;
import com.fasterxml.jackson.databind.JsonNode;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.TreeMap;
import java.util.TreeSet;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Repository;

@Repository
public class FileReferenceRepository implements ReferenceRepository {
  private static final String LEGACY_CATEGORY = "apartments_long_term_rent";
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
    paths.put("manifest.json", files.stamp("manifest.json"));
    var manifest = files.exists("manifest.json") ? read("manifest.json", paths) : object();
    boolean modern = !manifest.isEmpty();
    if (modern && manifest.path("format_version").asInt() != 1)
      throw new ApiException(409, "Неподдерживаемый manifest справочников.");
    String category = manifest.path("category_id").asText(LEGACY_CATEGORY);
    if (!category.matches("[a-z][a-z0-9_]{0,79}"))
      throw new ApiException(409, "Некорректная категория справочника.");
    String format = manifest.path("source_schema_version").asText("1.2");
    JsonNode card = read(manifest.path("card").asText("runtime/card.json"), paths);
    JsonNode common =
        read(manifest.path("common").asText("integration/" + category + "_common.json"), paths);
    var registry = modern ? manifest.path("platforms") : card.path("platforms");
    if (!registry.isObject() || registry.isEmpty())
      throw new ApiException(409, "В справочнике отсутствует реестр площадок.");
    JsonNode audit = object();
    if (!card.has("canonicalValues")) audit = read("integration/integration-audit.json", paths);
    Map<String, JsonNode> schemas = new TreeMap<>(),
        plans = new TreeMap<>(),
        bindings = new TreeMap<>(),
        browsers = new TreeMap<>();
    var ids = new TreeSet<String>();
    registry.fieldNames().forEachRemaining(ids::add);
    for (String id : ids) {
      if (!id.matches("[a-z][a-z0-9_]{0,39}"))
        throw new ApiException(409, "Некорректный идентификатор площадки.");
      var entry = registry.path(id);
      JsonNode schema =
          read(entry.path("schema").asText(id + "/" + category + "_" + id + ".json"), paths);
      JsonNode plan = read(entry.path("plan").asText("runtime/preparation_" + id + ".json"), paths);
      if (!text(plan, "schema_hash").equals(Hashing.sha256(schema.toString()))
          || !text(plan, "common_hash").equals(Hashing.sha256(common.toString())))
        throw new ApiException(409, "Обновите схему и маппинг площадки единым комплектом.");
      schemas.put(id, SchemaCompatibility.normalize(schema, format));
      plans.put(id, plan);
      if (entry.has("browser")) {
        var browser = read(entry.path("browser").asText(), paths);
        new BrowserRecipeValidator().validate(id, schemas.get(id), browser);
        browsers.put(id, browser);
      }
      if (entry.has("binding")) bindings.put(id, read(entry.path("binding").asText(), paths));
      if (format.equals("2.1") && !entry.has("binding"))
        throw new ApiException(409, "Для схемы 2.1 нужен отдельный binding-файл.");
    }
    new ReferenceValidator().validate(category, common, card, schemas, plans, bindings, format);
    if (paths.entrySet().stream().anyMatch(e -> !e.getValue().equals(files.stamp(e.getKey()))))
      throw new ApiException(409, "Справочники изменились при чтении. Повторите запрос.");
    String version = ReferenceSnapshot.fingerprint(common, card, plans);
    if (modern)
      version =
          Hashing.sha256(version + manifest + object("bindings", bindings, "browsers", browsers));
    ReferenceSnapshot next =
        new ReferenceSnapshot(
            category, common, card, audit, schemas, plans, bindings, browsers, version);
    cached = next;
    stamps = Map.copyOf(paths);
    return next;
  }

  private JsonNode read(String path, Map<String, String> paths) {
    paths.put(path, files.stamp(path));
    return files.read(path);
  }
}
