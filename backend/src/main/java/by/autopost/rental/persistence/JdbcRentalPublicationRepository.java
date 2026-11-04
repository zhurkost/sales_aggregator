package by.autopost.rental.persistence;

import by.autopost.rental.application.PublicationStatus;
import by.autopost.rental.application.RentalPublicationRepository;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.context.annotation.DependsOn;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.stereotype.Repository;

@Repository
@DependsOn("database")
public class JdbcRentalPublicationRepository implements RentalPublicationRepository {
  private static final String COLUMNS =
      "id,draft_id,revision,integration_version,platform,status,message,url,created,updated";
  private static final RowMapper<Publication> ROW =
      (rs, n) ->
          new Publication(
              rs.getString("id"),
              rs.getString("draft_id"),
              rs.getInt("revision"),
              rs.getString("integration_version"),
              rs.getString("platform"),
              PublicationStatus.of(rs.getString("status")),
              rs.getString("message"),
              rs.getString("url"),
              rs.getString("created"),
              rs.getString("updated"));
  private final JdbcTemplate jdbc;

  public JdbcRentalPublicationRepository(JdbcTemplate jdbc) {
    this.jdbc = jdbc;
    // seq orders the launches of a card; the key of a launch on a platform is unique.
    jdbc.execute(
        "CREATE TABLE IF NOT EXISTS rental_publications(seq INTEGER PRIMARY KEY AUTOINCREMENT,id"
            + " TEXT NOT NULL UNIQUE,workspace_id TEXT NOT NULL,draft_id TEXT NOT NULL,revision"
            + " INTEGER NOT NULL,integration_version TEXT NOT NULL,platform TEXT NOT NULL,status"
            + " TEXT NOT NULL,message TEXT NOT NULL,url TEXT NOT NULL,created TEXT NOT NULL,updated"
            + " TEXT NOT NULL,"
            + "UNIQUE(workspace_id,draft_id,revision,integration_version,platform))");
    jdbc.execute(
        "CREATE INDEX IF NOT EXISTS rental_publications_card ON"
            + " rental_publications(workspace_id,draft_id,platform,seq)");
  }

  public Publication open(
      String workspace,
      String draft,
      int revision,
      String integrationVersion,
      String platform,
      String now) {
    jdbc.update(
        "INSERT INTO rental_publications(id,workspace_id,draft_id,revision,integration_version,"
            + "platform,status,message,url,created,updated) VALUES(?,?,?,?,?,?,?,?,'',?,?) ON"
            + " CONFLICT(workspace_id,draft_id,revision,integration_version,platform) DO NOTHING",
        UUID.randomUUID().toString(),
        workspace,
        draft,
        revision,
        integrationVersion,
        platform,
        PublicationStatus.OPENED.code(),
        "Открываем форму",
        now,
        now);
    return jdbc.queryForObject(
        "SELECT "
            + COLUMNS
            + " FROM rental_publications WHERE workspace_id=? AND draft_id=? AND revision=? AND"
            + " integration_version=? AND platform=?",
        ROW,
        workspace,
        draft,
        revision,
        integrationVersion,
        platform);
  }

  public Optional<Publication> find(String workspace, String id) {
    return jdbc
        .query(
            "SELECT " + COLUMNS + " FROM rental_publications WHERE workspace_id=? AND id=?",
            ROW,
            workspace,
            id)
        .stream()
        .findFirst();
  }

  public List<LastPublication> latest(String workspace) {
    return jdbc.query(
        "SELECT p.id,p.draft_id,p.platform,p.status,p.message,p.updated,coalesce((SELECT u.url"
            + " FROM rental_publications u WHERE u.workspace_id=p.workspace_id AND"
            + " u.draft_id=p.draft_id AND u.platform=p.platform AND u.url<>'' ORDER BY u.seq DESC"
            + " LIMIT 1),'') AS url FROM rental_publications p WHERE p.workspace_id=? AND p.seq IN"
            + " (SELECT max(seq) FROM rental_publications WHERE workspace_id=? GROUP BY"
            + " draft_id,platform) ORDER BY p.draft_id,p.platform",
        (rs, n) ->
            new LastPublication(
                rs.getString("id"),
                rs.getString("draft_id"),
                rs.getString("platform"),
                PublicationStatus.of(rs.getString("status")),
                rs.getString("message"),
                rs.getString("url"),
                rs.getString("updated")),
        workspace,
        workspace);
  }

  public boolean report(
      String workspace,
      String id,
      PublicationStatus expected,
      PublicationStatus status,
      String message,
      String updated) {
    return jdbc.update(
            "UPDATE rental_publications SET status=?,message=?,updated=? WHERE workspace_id=? AND"
                + " id=? AND status=?",
            status.code(),
            message,
            updated,
            workspace,
            id,
            expected.code())
        == 1;
  }

  public void link(String workspace, String id, String url) {
    jdbc.update(
        "UPDATE rental_publications SET url=? WHERE workspace_id=? AND id=?", url, workspace, id);
  }

  public void removeAll(String workspace, String draft) {
    jdbc.update(
        "DELETE FROM rental_publications WHERE workspace_id=? AND draft_id=?", workspace, draft);
  }
}
