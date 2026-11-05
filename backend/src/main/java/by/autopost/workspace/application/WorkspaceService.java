package by.autopost.workspace.application;

import static by.autopost.shared.Hashing.sha256;
import static by.autopost.shared.Json.*;

import by.autopost.shared.ApiException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.util.*;
import java.util.concurrent.ConcurrentHashMap;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class WorkspaceService {
  public static final int SESSION_SECONDS = 604800;
  private final WorkspaceRepository repository;
  private final SecureRandom random = new SecureRandom();
  private final Map<String, long[]> attempts = new ConcurrentHashMap<>();

  public WorkspaceService(WorkspaceRepository repository) {
    this.repository = repository;
  }

  public record Actor(String id, String workspace, String name, String login) {
    public ObjectNode profile() {
      return object("id", workspace, "accountId", id, "name", name, "login", login);
    }
  }

  public record Login(Actor actor, String token) {}

  public Actor user(String token) {
    if (token.isEmpty()) return null;
    var session = repository.session(sha256(token), System.currentTimeMillis()).orElse(null);
    if (session == null) return null;
    var account = session.account();
    String workspace = Objects.toString(session.workspace(), "");
    if (workspace.isEmpty()
        || !workspace.equals(account.id()) && !repository.isMember(workspace, account.id()))
      workspace = account.id();
    String name = repository.workspaceName(workspace).orElse(account.name());
    return new Actor(account.id(), workspace, name, account.login());
  }

  public ObjectNode session(String token) {
    var actor = user(token);
    return object(
        "profile", actor == null ? null : actor.profile(), "profiles", repository.profiles());
  }

  public ObjectNode settings(String workspace) {
    var saved = repository.settings(workspace).map(raw -> parse(raw)).orElseGet(() -> object());
    var defaults = object();
    for (String key : List.of("company", "contactPerson", "phone"))
      defaults.put(
          key, clean(saved, key, key.equals("company") ? 150 : key.equals("phone") ? 40 : 100));
    return object("settings", defaults);
  }

  @Transactional
  public void logout(String token) {
    repository.deleteSession(sha256(token));
  }

  // Account creation and issuing its session must commit or roll back together.
  @Transactional
  public synchronized Login login(JsonNode input, boolean register) {
    String login = clean(input, "login", 40).toLowerCase(Locale.ROOT),
        password = text(input, "password");
    if (!login.matches("[\\p{L}\\p{N}_.-]{2,40}")
        || !input.path("password").isTextual()
        || password.length() < 6
        || password.length() > 128)
      throw new ApiException(400, "Логин: 2–40 букв или цифр. Пароль: 6–128 символов.");
    long now = System.currentTimeMillis();
    attempts.entrySet().removeIf(e -> e.getValue()[1] < now);
    long[] bucket = attempts.computeIfAbsent(login, k -> new long[] {0, now + 600000});
    if (bucket[0] >= 10 || attempts.size() > 1000)
      throw new ApiException(429, "Слишком много попыток. Подождите 10 минут.");
    bucket[0]++;
    var account = repository.account(login).orElse(null);
    if (register) {
      if (account != null)
        throw new ApiException(400, "Такой логин уже есть. Выберите профиль и войдите.");
      if (repository.accountCount() >= 100)
        throw new ApiException(400, "Лимит профилей MVP достигнут.");
      String salt = random(16), name = clean(input, "name", 80);
      account =
          new WorkspaceRepository.Account(
              UUID.randomUUID().toString(),
              login,
              name.isEmpty() ? login : name,
              salt,
              Passwords.derive(password, salt));
      repository.insert(account);
    } else {
      String derived =
          Passwords.derive(password, account == null ? "dummy-account-salt" : account.salt());
      if (account == null
          || !MessageDigest.isEqual(
              derived.getBytes(StandardCharsets.US_ASCII),
              account.password().getBytes(StandardCharsets.US_ASCII)))
        throw new ApiException(401, "Неверный логин или пароль.");
    }
    String token = random(32);
    repository.expireSessions(now);
    repository.createSession(sha256(token), account.id(), now + SESSION_SECONDS * 1000L);
    attempts.remove(login);
    return new Login(new Actor(account.id(), account.id(), account.name(), account.login()), token);
  }

  private String random(int bytes) {
    byte[] data = new byte[bytes];
    random.nextBytes(data);
    return HexFormat.of().formatHex(data);
  }
}
