package by.autopost.rental.application;

import by.autopost.rental.catalog.CategoryRegistry;
import by.autopost.shared.ApiException;
import org.springframework.stereotype.Service;

@Service
public final class CategoryCatalogs {
  private final CategoryRegistry registry;

  public CategoryCatalogs(CategoryRegistry registry) { this.registry = registry; }

  public record Category(String id, RentalCatalog catalog, String analysis, boolean publication) {
    public RentalPublicationService publisher() {
      if (!publication) throw new ApiException(409, "Публикация этой категории пока недоступна.");
      return new RentalPublicationService(catalog);
    }
  }

  public Category require(String pathId) {
    // Only compatibility routes for previously installed clients omit the path variable.
    String id = pathId == null ? CategoryRegistry.LEGACY_RENT : pathId;
    var entry = registry.require(id);
    return new Category(id, new RentalCatalog(entry.references()), entry.analysis(), entry.publication());
  }
}
