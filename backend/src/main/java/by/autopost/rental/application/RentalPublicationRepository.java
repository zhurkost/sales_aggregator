package by.autopost.rental.application;

import java.util.List;
import java.util.Optional;

/**
 * History of publications: one record per launch (card revision and integration version) and
 * platform. Every operation is scoped to a workspace.
 */
public interface RentalPublicationRepository {
  /** The publication of one launch on one platform; {@code url} is the ad, if the user gave it. */
  record Publication(
      String id,
      String draftId,
      int revision,
      String integrationVersion,
      String platform,
      PublicationStatus status,
      String message,
      String url,
      String created,
      String updated) {}

  /**
   * The publication of this launch on this platform: created as {@code opened} on the first call,
   * returned unchanged on every later one.
   */
  Publication open(
      String workspace,
      String draft,
      int revision,
      String integrationVersion,
      String platform,
      String now);

  Optional<Publication> find(String workspace, String id);

  /**
   * Where a card stands on a platform, for «Мои квартиры»: the status of its latest launch there,
   * and the latest link to the ad any of its launches there has.
   */
  record LastPublication(
      String id,
      String draftId,
      String platform,
      PublicationStatus status,
      String message,
      String url,
      String updated) {}

  List<LastPublication> latest(String workspace);

  /** Sets the status and message if the status is still {@code expected}. */
  boolean report(
      String workspace,
      String id,
      PublicationStatus expected,
      PublicationStatus status,
      String message,
      String updated);

  /** The link to the ad; the time of the status stays. */
  void link(String workspace, String id, String url);

  void removeAll(String workspace, String draft);
}
