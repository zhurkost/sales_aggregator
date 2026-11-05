package by.autopost.workspace.application;

import java.util.List;
import java.util.Optional;

/** Persistence port: application code never receives SQL or database rows. */
public interface WorkspaceRepository {
  record Profile(String id, String login, String name) {}

  record Account(String id, String login, String name, String salt, String password) {
    public Profile profile() {
      return new Profile(id, login, name);
    }
  }

  record Session(Account account, String workspace) {}

  List<Profile> profiles();

  Optional<Account> account(String login);

  long accountCount();

  void insert(Account account);

  Optional<Session> session(String tokenHash, long now);

  boolean isMember(String workspace, String account);

  Optional<String> workspaceName(String workspace);

  void expireSessions(long now);

  void createSession(String tokenHash, String account, long expires);

  void deleteSession(String tokenHash);

  Optional<String> settings(String workspace);
}
