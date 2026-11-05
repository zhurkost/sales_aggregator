package by.autopost.workspace.persistence;

import by.autopost.workspace.application.WorkspaceRepository;
import java.util.List;
import java.util.Optional;
import org.springframework.context.annotation.DependsOn;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.stereotype.Repository;

@Repository
@DependsOn("database")
public class JdbcWorkspaceRepository implements WorkspaceRepository {
  private final JdbcTemplate jdbc;
  private static final RowMapper<Account> ACCOUNT =
      (rs, n) ->
          new Account(
              rs.getString("id"),
              rs.getString("login"),
              rs.getString("name"),
              rs.getString("salt"),
              rs.getString("password"));

  public JdbcWorkspaceRepository(JdbcTemplate jdbc) {
    this.jdbc = jdbc;
  }

  public List<Profile> profiles() {
    return jdbc.query(
        "SELECT id,login,name FROM profiles ORDER BY login",
        (rs, n) -> new Profile(rs.getString("id"), rs.getString("login"), rs.getString("name")));
  }

  public Optional<Account> account(String login) {
    return jdbc.query("SELECT * FROM profiles WHERE login=?", ACCOUNT, login).stream().findFirst();
  }

  public long accountCount() {
    return jdbc.queryForObject("SELECT count(*) FROM profiles", Long.class);
  }

  public void insert(Account p) {
    jdbc.update(
        "INSERT INTO profiles(id,login,name,salt,password) VALUES(?,?,?,?,?)",
        p.id(),
        p.login(),
        p.name(),
        p.salt(),
        p.password());
  }

  public Optional<Session> session(String tokenHash, long now) {
    return jdbc
        .query(
            "SELECT p.*,s.workspace_id FROM profiles p JOIN sessions s ON s.profile_id=p.id"
                + " WHERE s.token=? AND s.expires>?",
            (rs, n) -> new Session(ACCOUNT.mapRow(rs, n), rs.getString("workspace_id")),
            tokenHash,
            now)
        .stream()
        .findFirst();
  }

  public boolean isMember(String workspace, String account) {
    return !jdbc.queryForList(
            "SELECT 1 FROM members WHERE owner_id=? AND member_id=?", workspace, account)
        .isEmpty();
  }

  public Optional<String> workspaceName(String workspace) {
    return jdbc
        .query("SELECT name FROM profiles WHERE id=?", (rs, n) -> rs.getString("name"), workspace)
        .stream()
        .findFirst();
  }

  public void expireSessions(long now) {
    jdbc.update("DELETE FROM sessions WHERE expires<=?", now);
  }

  public void createSession(String tokenHash, String account, long expires) {
    jdbc.update(
        "INSERT INTO sessions(token,profile_id,expires) VALUES(?,?,?)",
        tokenHash,
        account,
        expires);
  }

  public void deleteSession(String tokenHash) {
    jdbc.update("DELETE FROM sessions WHERE token=?", tokenHash);
  }

  public Optional<String> settings(String workspace) {
    return jdbc
        .query(
            "SELECT data FROM settings WHERE profile_id=?",
            (rs, n) -> rs.getString("data"),
            workspace)
        .stream()
        .findFirst();
  }
}
