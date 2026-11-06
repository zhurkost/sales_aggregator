package by.autopost.rental.catalog;

import static by.autopost.shared.Json.object;

import by.autopost.rental.model.SchemaFields;

/** Offline deployment check. No web server, accounts, database or provider keys required. */
public final class ReferenceBundleCheck {
  private ReferenceBundleCheck() {}

  public static void run(String directory) {
    validate(new FileReferenceRepository(directory).snapshot());
  }

  public static void categories(String root) {
    var registry = new CategoryRegistry(root);
    for (String id : registry.ids()) validate(registry.require(id).references().snapshot());
  }

  private static void validate(ReferenceSnapshot snapshot) {
    // Also exercise editor construction before activating a bundle.
    new EditorSchemaBuilder().build(snapshot);
    System.out.println(
        object(
            "valid",
            true,
            "category",
            snapshot.categoryId(),
            "version",
            snapshot.version(),
            "platforms",
            snapshot.platforms(),
            "commonFields",
            SchemaFields.fields(snapshot.common()).size()));
  }
}
