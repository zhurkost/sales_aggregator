package by.autopost.rental.preparation;

import static by.autopost.rental.model.Conditions.*;
import static by.autopost.shared.Json.*;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;

/** Domain applicability after conversion; contains no visibility or layout decisions. */
public final class FieldApplicability {
  public ObjectNode evaluate(JsonNode schema, ObjectNode values) {
    ObjectNode result = object();
    for (var category : schema) collect(category.path("options"), Truth.YES, values, result);
    return result;
  }

  private void collect(JsonNode fields, Truth parent, ObjectNode values, ObjectNode result) {
    for (var field : fields) {
      Truth own = when(field.path("fill_rule").get("when"), values);
      Truth active =
          parent == Truth.NO || own == Truth.NO
              ? Truth.NO
              : parent == Truth.UNKNOWN || own == Truth.UNKNOWN ? Truth.UNKNOWN : Truth.YES;
      if (text(field, "type").equals("group")) {
        collect(field.path("options"), active, values, result);
      } else if (!text(field, "type").equals("choice")) {
        if (active == Truth.UNKNOWN) result.putNull(text(field, "id"));
        else result.put(text(field, "id"), active == Truth.YES);
      }
    }
  }
}
