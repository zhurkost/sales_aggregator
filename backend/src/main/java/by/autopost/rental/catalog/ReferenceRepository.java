package by.autopost.rental.catalog;

/** One request uses one complete, validated reference version. */
public interface ReferenceRepository {
  ReferenceSnapshot snapshot();
}
