package by.autopost.rental.model;

import static by.autopost.shared.Json.*;

import com.fasterxml.jackson.databind.JsonNode;
import java.util.ArrayList;
import java.util.List;

public final class MappingSources {
  public static List<String> sources(JsonNode row) {
    List<String> ids = new ArrayList<>();
    if (!text(row, "common_option_id").isBlank()) ids.add(text(row, "common_option_id"));
    for (var m : row.path("conversion").path("members")) ids.add(text(m, "common_option_id"));
    return ids;
  }
}
