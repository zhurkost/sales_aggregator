package by.autopost.rental.catalog;

/**
 * The reference bundle of this release cannot be used. The message names the file and the
 * reason; it stops the application start, the bundle validator and the card migration.
 */
public final class ReferenceBundleException extends RuntimeException {
  ReferenceBundleException(String file, String reason, Throwable cause) {
    super(file + ": " + reason, cause);
  }
}
