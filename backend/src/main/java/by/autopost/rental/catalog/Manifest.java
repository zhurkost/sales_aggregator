package by.autopost.rental.catalog;

import com.fasterxml.jackson.annotation.JsonProperty;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.Map;

/** {@code manifest.json}: the format, the category and the files of every platform. */
record Manifest(
    @JsonProperty("format_version") Integer formatVersion,
    @JsonProperty("source_schema_version") String sourceSchemaVersion,
    @JsonProperty("category_id") String categoryId,
    String common,
    String card,
    Map<String, Files> platforms) {
  Manifest {
    categoryId = categoryId == null ? "" : categoryId;
    common = common == null ? "" : common;
    card = card == null ? "" : card;
    platforms =
        platforms == null ? Map.of() : Collections.unmodifiableMap(new LinkedHashMap<>(platforms));
  }

  /** A plan without a form recipe would transfer nothing: every platform has all three. */
  record Files(String schema, String plan, String browser) {
    Files {
      schema = schema == null ? "" : schema;
      plan = plan == null ? "" : plan;
      browser = browser == null ? "" : browser;
    }
  }
}
