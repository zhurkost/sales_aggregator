package by.autopost.rental.catalog;

import static by.autopost.shared.Json.*;

import com.fasterxml.jackson.databind.node.ObjectNode;

/** AI consumes the domain reference, independently of the web editor's public DTO. */
public final class AnalysisSchemaBuilder {
  public ObjectNode build(ReferenceSnapshot snapshot) {
    ObjectNode category = snapshot.common().get(0).deepCopy();
    var groups = array();
    for (var group : category.path("options"))
      if (!text(group, "id").equals("group.address_projection")) groups.add(group.deepCopy());
    category.set("options", groups);
    var canonical = object();
    for (var evidence : snapshot.audit().path("field_evidence"))
      if (evidence.has("canonical_values"))
        canonical.set(text(evidence, "common_option_id"), evidence.get("canonical_values"));
    if (snapshot.card().has("canonicalValues"))
      canonical = (ObjectNode) snapshot.card().get("canonicalValues").deepCopy();
    var platforms = object();
    for (String platform : new java.util.TreeSet<>(snapshot.platforms()))
      platforms.set(platform, object("rules", snapshot.plan(platform).path("fields")));
    return object(
        "category",
        category,
        "canonicalValues",
        canonical,
        "platforms",
        platforms,
        "card",
        object("valueLabels", snapshot.card().path("valueLabels")),
        "version",
        snapshot.version());
  }
}
