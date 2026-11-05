package by.autopost.rental.persistence;

import static by.autopost.shared.Json.MAPPER;

import by.autopost.rental.catalog.FileReferenceRepository;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import org.springframework.jdbc.core.JdbcTemplate;
import org.sqlite.SQLiteConfig;
import org.sqlite.SQLiteDataSource;

/**
 * {@code java -jar autopost-api.jar --migrate-rental-drafts --database=<workspace.sqlite>
 * --rental-reference=<bundle>}: converts stored cards of an older card model once, with the
 * reference bundle of the release, moves cards of the current model from schemaVersion to
 * cardVersion, removes the IDs of photos kept in one browser (localPhotoIds), and prints the
 * report. No web server or provider keys.
 */
public final class RentalDraftMigrationCommand {
  public static final String FLAG = "--migrate-rental-drafts";

  private RentalDraftMigrationCommand() {}

  public static RentalDraftMigration.Report run(String... args) throws Exception {
    String database = null, reference = null;
    for (String arg : args)
      if (arg.equals(FLAG)) continue;
      else if (arg.startsWith("--database=")) database = arg.substring("--database=".length());
      else if (arg.startsWith("--rental-reference="))
        reference = arg.substring("--rental-reference=".length());
      else throw new IllegalArgumentException("Неизвестный параметр миграции: " + arg);
    if (database == null || database.isBlank() || reference == null || reference.isBlank())
      throw new IllegalArgumentException(
          "Укажите --database=<файл SQLite> и --rental-reference=<каталог справочников>.");
    // A broken bundle stops the migration before any card is read.
    var catalog = new FileReferenceRepository(reference).snapshot();
    Path file = Path.of(database);
    // Never create an empty database instead of the working one.
    if (!Files.isRegularFile(file))
      throw new IllegalArgumentException("База не найдена: " + file);
    var config = new SQLiteConfig();
    config.setBusyTimeout(5000);
    var source = new SQLiteDataSource(config);
    source.setUrl("jdbc:sqlite:" + file);
    var jdbc = new JdbcTemplate(source);
    boolean table =
        jdbc.queryForObject(
                "SELECT count(*) FROM sqlite_master WHERE type='table' AND name='rental_drafts'",
                Integer.class)
            > 0;
    var report =
        table
            ? new RentalDraftMigration(new JdbcRentalDraftRepository(jdbc), catalog).run()
            : new RentalDraftMigration.Report(0, 0, 0, 0, List.of(), List.of());
    System.out.println(MAPPER.writeValueAsString(report));
    return report;
  }
}
