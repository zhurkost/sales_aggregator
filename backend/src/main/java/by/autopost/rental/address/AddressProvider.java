package by.autopost.rental.address;

import java.util.List;

/** Network boundary of address search. Callers must not hold a lock while calling it. */
public interface AddressProvider {
  default boolean configured() {
    return true;
  }

  List<DadataSuggestion> suggest(String query, int count);

  /** The provider asked to pause (HTTP 429 or 5xx). */
  final class Throttled extends RuntimeException {
    public final long retryAfterSeconds;

    public Throttled(long retryAfterSeconds) {
      super("address provider throttled", null, false, false);
      this.retryAfterSeconds = retryAfterSeconds;
    }
  }
}
