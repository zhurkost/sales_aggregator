package by.autopost.rental.persistence;

import by.autopost.rental.application.RentalDraftRepository;
import java.util.List;
import java.util.Optional;
import org.springframework.context.annotation.DependsOn;
import org.springframework.jdbc.core.ConnectionCallback;
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
              rs.getString("title"),
              rs.getString("address_label"),
              rs.getString("updated"));
  private static final RowMapper<ListedDraft> LISTED =
      (rs, n) ->
          new ListedDraft(
              rs.getString("id"),
              rs.getInt("revision"),
              rs.getString("title"),
              rs.getString("address_label"),
              rs.getString("updated"));

  public JdbcRentalDraftRepository(JdbcTemplate jdbc) {
    this.jdbc = jdbc;
    jdbc.execute(
        "CREATE TABLE IF NOT EXISTS rental_drafts(id TEXT NOT NULL,workspace_id TEXT NOT NULL"
            + " REFERENCES profiles(id),revision INTEGER NOT NULL,data TEXT NOT NULL,updated TEXT"
            + " NOT NULL,title TEXT NOT NULL DEFAULT '',address_label TEXT NOT NULL DEFAULT '',"
            + "PRIMARY KEY(workspace_id,id))");
    addListColumns();
  }

  /**
   * One-time migration of tables created before the list columns: add them and copy the title
   * and address label from each stored card, in one transaction.
   */
  private void addListColumns() {
    var columns =
        jdbc.queryForList("SELECT name FROM pragma_table_info('rental_drafts')", String.class);
    if (columns.contains("title") && columns.contains("address_label")) return;
    jdbc.execute(
        (ConnectionCallback<Void>)
            connection -> {
              boolean autoCommit = connection.getAutoCommit();
              connection.setAutoCommit(false);
              try (var statement = connection.createStatement()) {
                for (String column : List.of("title", "address_label"))
                  if (!columns.contains(column))
                    statement.execute(
                        "ALTER TABLE rental_drafts ADD COLUMN "
                            + column
                            + " TEXT NOT NULL DEFAULT ''");
                statement.execute(
                    "UPDATE rental_drafts SET title=CASE WHEN json_valid(data) THEN CASE"
                        + " json_type(data,'$.values.\"listing.title\"') WHEN 'text' THEN"
                        + " json_extract(data,'$.values.\"listing.title\"') ELSE '' END ELSE ''"
                        + " END,address_label=CASE WHEN json_valid(data) THEN CASE"
                        + " json_type(data,'$.address.label') WHEN 'text' THEN"
                        + " json_extract(data,'$.address.label') ELSE '' END ELSE '' END");
                connection.commit();
              } catch (Exception e) {
                connection.rollback();
                throw e;
              } finally {
                connection.setAutoCommit(autoCommit);
              }
              return null;
            });
  }

  public List<String> workspaces() {
    return jdbc.queryForList(
        "SELECT DISTINCT workspace_id FROM rental_drafts ORDER BY workspace_id", String.class);
  }

  public List<ListedDraft> list(String workspace) {
    return jdbc.query(
        "SELECT id,revision,title,address_label,updated FROM rental_drafts WHERE workspace_id=?"
            + " ORDER BY updated DESC",
        LISTED,
        workspace);
  }

  public Optional<StoredDraft> find(String workspace, String id) {
    return jdbc
        .query(
            "SELECT id,revision,data,title,address_label,updated FROM rental_drafts WHERE"
                + " workspace_id=? AND id=?",
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
            "INSERT INTO rental_drafts(id,workspace_id,revision,data,title,address_label,updated)"
                + " VALUES(?,?,?,?,?,?,?) ON CONFLICT(workspace_id,id) DO NOTHING",
            d.id(),
            workspace,
            d.revision(),
            d.data(),
            d.title(),
            d.addressLabel(),
            d.updated())
        == 1;
  }

  public boolean update(String workspace, StoredDraft d, int revision) {
    return jdbc.update(
            "UPDATE rental_drafts SET revision=?,data=?,title=?,address_label=?,updated=? WHERE"
                + " workspace_id=? AND id=? AND revision=?",
            d.revision(),
            d.data(),
            d.title(),
            d.addressLabel(),
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
