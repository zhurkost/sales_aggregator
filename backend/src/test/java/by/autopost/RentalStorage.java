package by.autopost;

import by.autopost.rental.application.RentalDraftService;
import by.autopost.rental.persistence.JdbcRentalDraftRepository;
import by.autopost.rental.persistence.JdbcRentalPhotoRepository;
import java.nio.file.Path;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DriverManagerDataSource;

/** Rental storage of one SQLite file, wired as the application wires it. */
final class RentalStorage {
  final JdbcTemplate jdbc;
  final JdbcRentalDraftRepository drafts;
  final JdbcRentalPhotoRepository photos;

  RentalStorage(JdbcTemplate jdbc) {
    this.jdbc = jdbc;
    this.drafts = new JdbcRentalDraftRepository(jdbc);
    this.photos = new JdbcRentalPhotoRepository(jdbc);
  }

  static RentalStorage at(Path file) {
    return new RentalStorage(new JdbcTemplate(new DriverManagerDataSource("jdbc:sqlite:" + file)));
  }

  RentalDraftService draftService() {
    return new RentalDraftService(drafts, photos);
  }
}
