package by.autopost.rental.catalog;

import static by.autopost.shared.Json.text;
import by.autopost.shared.ApiException;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Set;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Repository;

@Repository
public class CategoryRegistry {
  public static final String LEGACY_RENT = "apartments_long_term_rent";
  public record Entry(ReferenceRepository references, String analysis, boolean publication) {}
  private final Map<String, Entry> categories = new LinkedHashMap<>();

  public CategoryRegistry(@Value("${autopost.category-reference-dir}") String directory) {
    var root = new ReferenceFiles(directory);
    var entries = root.read("categories.json");
    if (!entries.isObject() || entries.isEmpty()) throw new ApiException(409, "Пустой реестр категорий.");
    var bundles = new LinkedHashMap<String, FileReferenceRepository>();
    entries.fields().forEachRemaining(row -> {
      String id = row.getKey(), reference = text(row.getValue(), "reference");
      if (!id.matches("[a-z][a-z0-9_]{0,79}") || !reference.matches("[a-z][a-z0-9_]{0,79}"))
        throw new ApiException(409, "Некорректный идентификатор в реестре категорий.");
      var bundle = bundles.computeIfAbsent(reference, name ->
          new FileReferenceRepository(root.resolve(name).toString()));
      ReferenceRepository scoped = () -> {
        var snapshot = bundle.snapshot();
        if (!reference.equals(snapshot.categoryId()))
          throw new ApiException(409, "Категория в manifest.json не совпадает с реестром.");
        return snapshot.forCategory(id);
      };
      categories.put(id, new Entry(scoped, text(row.getValue(), "analysis"),
          row.getValue().path("publication").asBoolean(false)));
    });
  }

  public Set<String> ids() { return Set.copyOf(categories.keySet()); }

  public Entry require(String id) {
    var entry = categories.get(id);
    if (entry == null) throw new ApiException(404, "Неизвестная категория.");
    return entry;
  }
}
