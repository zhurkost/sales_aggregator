package by.autopost.rental.persistence;

import by.autopost.rental.application.RentalDraftRepository;
import java.util.List;
import java.util.Optional;
import org.springframework.context.annotation.DependsOn;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.stereotype.Repository;

@Repository
@DependsOn("database")
public class JdbcRentalDraftRepository implements RentalDraftRepository {
  private final JdbcTemplate jdbc;
  private static final RowMapper<StoredDraft> ROW =
      (rs, n) ->
          new StoredDraft(
              rs.getString("id"),
              rs.getInt("revision"),
              rs.getString("data"),
              rs.getString("updated"));

  public JdbcRentalDraftRepository(JdbcTemplate jdbc) {
    this.jdbc = jdbc;
    jdbc.execute(
        "CREATE TABLE IF NOT EXISTS rental_drafts(id TEXT NOT NULL,workspace_id TEXT NOT NULL"
            + " REFERENCES profiles(id),revision INTEGER NOT NULL,data TEXT NOT NULL,updated TEXT"
            + " NOT NULL,PRIMARY KEY(workspace_id,id))");
  }

  public List<StoredDraft> list(String workspace) {
    return jdbc.query(
        "SELECT id,revision,data,updated FROM rental_drafts WHERE workspace_id=? ORDER BY updated"
            + " DESC",
        ROW,
        workspace);
  }

  public Optional<StoredDraft> find(String workspace, String id) {
    return jdbc
        .query(
            "SELECT id,revision,data,updated FROM rental_drafts WHERE workspace_id=? AND id=?",
            ROW,
            workspace,
            id)
        .stream()
        .findFirst();
  }

  public long count(String workspace) {
    return jdbc.queryForObject(
        "SELECT count(*) FROM rental_drafts WHERE workspace_id=?", Long.class, workspace);
  }

  public boolean insert(String workspace, StoredDraft d) {
    return jdbc.update(
            "INSERT INTO rental_drafts(id,workspace_id,revision,data,updated) VALUES(?,?,?,?,?) ON"
                + " CONFLICT(workspace_id,id) DO NOTHING",
            d.id(),
            workspace,
            d.revision(),
            d.data(),
            d.updated())
        == 1;
  }

  public boolean update(String workspace, StoredDraft d, int revision) {
    return jdbc.update(
            "UPDATE rental_drafts SET revision=?,data=?,updated=? WHERE workspace_id=? AND id=? AND"
                + " revision=?",
            d.revision(),
            d.data(),
            d.updated(),
            workspace,
            d.id(),
            revision)
        == 1;
  }

  public boolean delete(String workspace, String id, int revision) {
    return jdbc.update(
            "DELETE FROM rental_drafts WHERE workspace_id=? AND id=? AND revision=?",
            workspace,
            id,
            revision)
        == 1;
  }
}
