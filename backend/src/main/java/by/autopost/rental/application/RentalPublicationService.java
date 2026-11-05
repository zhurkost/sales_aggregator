package by.autopost.rental.application;

import by.autopost.rental.application.RentalPublicationRepository.Publication;
import by.autopost.rental.model.Card;
import by.autopost.shared.ApiException;
import java.net.URI;
import java.net.URISyntaxException;
import java.time.Instant;
import java.util.Locale;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * The extension receives only the saved snapshot in the authenticated workspace, with the photos
 * stored with it, and a publication record per platform of the launch; it reports the progress of
 * each through the Autopost tab, and the server decides which change of status is allowed.
 */
@Service
public class RentalPublicationService {
  static final int MESSAGE_CHARACTERS = 500;
  static final int LINK_CHARACTERS = 1500;
  private final RentalDraftService drafts;
  private final RentalCatalog catalog;
  private final RentalPhotoService photos;
  private final RentalPublicationRepository publications;

  public RentalPublicationService(
      RentalDraftService drafts,
      RentalCatalog catalog,
      RentalPhotoService photos,
      RentalPublicationRepository publications) {
    this.drafts = drafts;
    this.catalog = catalog;
    this.photos = photos;
    this.publications = publications;
  }

  /**
   * The card, its revision and its photos are read in one transaction: one consistent launch. A
   * launch is the revision of the card and the integration version of the rules: launching it again
   * returns the same publications, never new ones.
   */
  @Transactional
  public ExtensionLaunch configuration(String workspace, String id, Card sent) {
    var saved = drafts.stored(workspace, id == null ? "" : id);
    Cards.requireCurrent(saved.card());
    // What the page shows must be what was saved: every value the server reads.
    if (!saved.card().equals(sent))
      throw new ApiException(
          409, "Карточка изменилась. Дождитесь сохранения и повторите публикацию.");
    var stored = photos.forExtension(workspace, saved.id());
    var result = catalog.browser(saved.card(), stored.size());
    String integration = result.integrationVersion(), now = Instant.now().toString();
    var jobs =
        result.jobs().stream()
            .map(
                job ->
                    job.withPublication(
                        publications
                            .open(workspace, saved.id(), saved.revision(), integration, job.platform(), now)
                            .id()))
            .toList();
    // The extension puts the photos into the form's file inputs; the browser keeps no copy.
    return new ExtensionLaunch(
        result.format(), integration, jobs, saved.id(), saved.revision(), stored);
  }

  /**
   * A report of the extension. {@code submitted} comes before the final click and is its
   * permission: only once, and only while the card and the rules are those of the launch.
   */
  @Transactional
  public Publication report(String workspace, String id, String status, String message) {
    var next = PublicationStatus.of(status);
    var current = find(workspace, id);
    current
        .status()
        .refusal(next)
        .ifPresent(
            reason -> {
              throw new ApiException(409, reason);
            });
    if (next == PublicationStatus.SUBMITTED) {
      if (drafts.revision(workspace, current.draftId()) != current.revision())
        throw new ApiException(
            409, "Карточка изменена. Остановите старый запуск и передайте новую версию.");
      if (!catalog.integrationVersion().equals(current.integrationVersion()))
        throw new ApiException(
            409,
            "Правила площадок обновились. Остановите старый запуск и передайте карточку заново.");
    }
    String text = message == null ? "" : message.strip();
    if (text.length() > MESSAGE_CHARACTERS) text = text.substring(0, MESSAGE_CHARACTERS);
    if (!publications.report(
        workspace, id, current.status(), next, text, Instant.now().toString()))
      throw new ApiException(409, "Статус публикации изменился. Повторите.");
    return find(workspace, id);
  }

  /** The link to the published ad, which the user gives: an HTTPS page of the platform's site. */
  @Transactional
  public Publication link(String workspace, String id, String url) {
    var current = find(workspace, id);
    publications.link(workspace, id, link(url, catalog.formUrl(current.platform())));
    return find(workspace, id);
  }

  private Publication find(String workspace, String id) {
    return publications
        .find(workspace, id == null ? "" : id)
        .orElseThrow(() -> new ApiException(404, "Публикация не найдена."));
  }

  /**
   * The ad lives on the site of the form (for {@code www.kufar.by} that is {@code kufar.by} and its
   * subdomains); where exactly is not researched, so any page of that site is accepted. An empty
   * link removes it.
   */
  static String link(String raw, String formUrl) {
    String value = raw == null ? "" : raw.strip();
    if (value.isEmpty()) return "";
    var refused = new ApiException(400, "Укажите ссылку https на объявление на сайте площадки.");
    URI uri;
    try {
      uri = new URI(value);
    } catch (URISyntaxException e) {
      throw refused;
    }
    String host = uri.getHost() == null ? "" : uri.getHost().toLowerCase(Locale.ROOT);
    String[] labels = URI.create(formUrl).getHost().split("\\.");
    String site = labels[labels.length - 2] + "." + labels[labels.length - 1];
    if (value.length() > LINK_CHARACTERS
        || !"https".equalsIgnoreCase(uri.getScheme())
        || uri.getRawUserInfo() != null
        || uri.getPort() != -1
        || !(host.equals(site) || host.endsWith("." + site))) throw refused;
    int fragment = value.indexOf('#');
    return fragment < 0 ? value : value.substring(0, fragment);
  }
}
