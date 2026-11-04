package by.autopost.rental.catalog;

import static by.autopost.shared.Json.object;

import by.autopost.rental.model.SchemaFields;

/** Offline deployment check. No web server, accounts, database or provider keys required. */
public final class ReferenceBundleCheck {
  private ReferenceBundleCheck() {}

  public static void run(String directory) {
    var snapshot = new FileReferenceRepository(directory).snapshot();
    // Also exercise editor construction before activating a bundle.
    new EditorSchemaBuilder().build(snapshot);
    System.out.println(
        object(
            "valid",
            true,
            "category",
            snapshot.categoryId(),
            "cardVersion",
            snapshot.cardVersion(),
            "integrationVersion",
            snapshot.integrationVersion(),
            "platforms",
            snapshot.platforms(),
            "commonFields",
            SchemaFields.fields(snapshot.common()).size()));
  }
}
