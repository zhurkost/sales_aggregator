package by.autopost.rental.persistence;

import by.autopost.rental.application.RentalPhotoRepository;
import java.util.List;
import java.util.Optional;
import org.springframework.context.annotation.DependsOn;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.stereotype.Repository;

/** The photo bytes live in the workspace database, as the photos of ordinary ads do. */
@Repository
@DependsOn("database")
public class JdbcRentalPhotoRepository implements RentalPhotoRepository {
  private final JdbcTemplate jdbc;
  private static final RowMapper<PhotoInfo> INFO =
      (rs, n) ->
          new PhotoInfo(
              rs.getString("id"), rs.getString("name"), rs.getString("mime"), rs.getInt("size"));
  private static final RowMapper<PhotoFile> FILE =
      (rs, n) ->
          new PhotoFile(
              rs.getString("id"), rs.getString("name"), rs.getString("mime"), rs.getBytes("data"));

  public JdbcRentalPhotoRepository(JdbcTemplate jdbc) {
    this.jdbc = jdbc;
    jdbc.execute(
        "CREATE TABLE IF NOT EXISTS rental_photos(workspace_id TEXT NOT NULL,draft_id TEXT NOT"
            + " NULL,id TEXT NOT NULL,position INTEGER NOT NULL,name TEXT NOT NULL,mime TEXT NOT"
            + " NULL,size INTEGER NOT NULL,data BLOB NOT NULL,created TEXT NOT NULL,PRIMARY"
            + " KEY(workspace_id,draft_id,id))");
  }

  public List<PhotoInfo> list(String workspace, String draft) {
    return jdbc.query(
        "SELECT id,name,mime,size FROM rental_photos WHERE workspace_id=? AND draft_id=? ORDER BY"
            + " position,id",
        INFO,
        workspace,
        draft);
  }

  public List<PhotoFile> files(String workspace, String draft) {
    return jdbc.query(
        "SELECT id,name,mime,data FROM rental_photos WHERE workspace_id=? AND draft_id=? ORDER BY"
            + " position,id",
        FILE,
        workspace,
        draft);
  }

  public Optional<PhotoFile> file(String workspace, String draft, String id) {
    return jdbc
        .query(
            "SELECT id,name,mime,data FROM rental_photos WHERE workspace_id=? AND draft_id=? AND"
                + " id=?",
            FILE,
            workspace,
            draft,
            id)
        .stream()
        .findFirst();
  }

  public int count(String workspace, String draft) {
    return jdbc.queryForObject(
        "SELECT count(*) FROM rental_photos WHERE workspace_id=? AND draft_id=?",
        Integer.class,
        workspace,
        draft);
  }

  public void append(String workspace, String draft, List<PhotoFile> photos, String created) {
    int next =
        jdbc.queryForObject(
            "SELECT coalesce(max(position),-1)+1 FROM rental_photos WHERE workspace_id=? AND"
                + " draft_id=?",
            Integer.class,
            workspace,
            draft);
    for (var photo : photos)
      jdbc.update(
          "INSERT INTO rental_photos(workspace_id,draft_id,id,position,name,mime,size,data,created)"
              + " VALUES(?,?,?,?,?,?,?,?,?)",
          workspace,
          draft,
          photo.id(),
          next++,
          photo.name(),
          photo.type(),
          photo.data().length,
          photo.data(),
          created);
  }

  public boolean remove(String workspace, String draft, String id) {
    return jdbc.update(
            "DELETE FROM rental_photos WHERE workspace_id=? AND draft_id=? AND id=?",
            workspace,
            draft,
            id)
        == 1;
  }

  public void order(String workspace, String draft, List<String> ids) {
    for (int i = 0; i < ids.size(); i++)
      jdbc.update(
          "UPDATE rental_photos SET position=? WHERE workspace_id=? AND draft_id=? AND id=?",
          i,
          workspace,
          draft,
          ids.get(i));
  }

  public void removeAll(String workspace, String draft) {
    jdbc.update("DELETE FROM rental_photos WHERE workspace_id=? AND draft_id=?", workspace, draft);
  }
}
