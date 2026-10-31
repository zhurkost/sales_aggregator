package by.autopost;

import static by.autopost.Json.*;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import jakarta.servlet.*;
import jakarta.servlet.http.*;
import java.io.*;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.security.*;
import java.util.*;
import java.util.concurrent.ConcurrentHashMap;
import java.util.regex.Pattern;
import org.bouncycastle.crypto.generators.SCrypt;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

@Component
class Access extends OncePerRequestFilter {
  final Database db;
  final String origin, proxySecret;
  private final SecureRandom random = new SecureRandom();
  private final Map<String, long[]> attempts = new ConcurrentHashMap<>();

  Access(
      Database db,
      @Value("${autopost.origin}") String origin,
      @Value("${autopost.proxy-secret}") String secret) {
    this.db = db;
    this.origin = origin.replaceAll("/$", "");
    this.proxySecret = secret;
    URI uri = URI.create(this.origin);
    boolean local = Set.of("localhost", "127.0.0.1").contains(uri.getHost());
    if (!local && !"https".equals(uri.getScheme()))
      throw new IllegalArgumentException("PUBLIC_ORIGIN must use HTTPS");
    if (!local && secret.length() < 32)
      throw new IllegalArgumentException("VPS_PROXY_SECRET must contain at least 32 characters");
  }

  @Override
  protected void doFilterInternal(
      HttpServletRequest req, HttpServletResponse res, FilterChain chain)
      throws ServletException, IOException {
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    if (req.getRequestURI().startsWith("/api/")) {
      String provided = Objects.toString(req.getHeader("X-Autopost-Proxy-Secret"), "");
      if (!proxySecret.isEmpty()
          && !MessageDigest.isEqual(
              proxySecret.getBytes(StandardCharsets.UTF_8),
              provided.getBytes(StandardCharsets.UTF_8))) {
        reject(res, 401, "Войдите на сайт.");
        return;
      }
      if (!Set.of("GET", "POST").contains(req.getMethod())) {
        reject(res, 405, "Метод не поддерживается.");
        return;
      }
      if ("POST".equals(req.getMethod())) {
        if (!origin.equals(req.getHeader("Origin"))) {
          reject(res, 403, "Запрос разрешён только со страницы Автопост.");
          return;
        }
        if (req.getContentType() == null
            || !req.getContentType().toLowerCase(Locale.ROOT).startsWith("application/json")) {
          reject(res, 415, "Нужен JSON.");
          return;
        }
        int limit = req.getRequestURI().equals("/api/analyze") ? 1_200_000 : 5 * 1024 * 1024;
        if (req.getContentLengthLong() > limit) {
          reject(res, 413, "Слишком большой запрос.");
          return;
        }
        byte[] body = req.getInputStream().readNBytes(limit + 1);
        if (body.length > limit) {
          reject(res, 413, "Слишком большой запрос.");
          return;
        }
        req = new BodyRequest(req, body);
      }
    }
    chain.doFilter(req, res);
  }

  static void reject(HttpServletResponse res, int status, String message) throws IOException {
    res.setStatus(status);
    res.setContentType("application/json;charset=UTF-8");
    res.getWriter().write(object("error", message).toString());
  }

  static String hash(String value) {
    try {
      return HexFormat.of()
          .formatHex(
              MessageDigest.getInstance("SHA-256").digest(value.getBytes(StandardCharsets.UTF_8)));
    } catch (Exception e) {
      throw new IllegalStateException(e);
    }
  }

  private String random(int bytes) {
    byte[] data = new byte[bytes];
    random.nextBytes(data);
    return HexFormat.of().formatHex(data);
  }

  static String token(HttpServletRequest req) {
    var m =
        Pattern.compile("(?:^|;\\s*)autopost_session=([a-f0-9]{64})(?:;|$)")
            .matcher(Objects.toString(req.getHeader("Cookie"), ""));
    return m.find() ? m.group(1) : "";
  }

  record Actor(String id, String workspace, String name, String login) {
    ObjectNode profile() {
      return object("id", workspace, "accountId", id, "name", name, "login", login);
    }
  }

  Actor user(HttpServletRequest req) {
    String token = token(req);
    if (token.isEmpty()) return null;
    var p =
        db.one(
            "SELECT p.*,s.workspace_id FROM profiles p JOIN sessions s ON s.profile_id=p.id WHERE"
                + " s.token=? AND s.expires>?",
            hash(token),
            System.currentTimeMillis());
    if (p == null) return null;
    String id = p.get("id").toString(), workspace = Objects.toString(p.get("workspace_id"), "");
    if (workspace.isEmpty()
        || !workspace.equals(id)
            && db.one("SELECT 1 FROM members WHERE owner_id=? AND member_id=?", workspace, id)
                == null) workspace = id;
    var owner = db.one("SELECT name FROM profiles WHERE id=?", workspace);
    return new Actor(id, workspace, owner.get("name").toString(), p.get("login").toString());
  }

  Actor require(HttpServletRequest req) {
    Actor actor = user(req);
    if (actor == null) throw new ApiException(401, "Выберите профиль и войдите.");
    String workspace = req.getHeader("X-Autopost-Workspace");
    if (workspace != null && !workspace.equals(actor.workspace))
      throw new ApiException(409, "Кабинет изменился в другой вкладке. Обновите страницу.");
    return actor;
  }

  String cookie(String token, int age) {
    return "autopost_session="
        + token
        + "; Path=/; HttpOnly; SameSite=Strict; Max-Age="
        + age
        + (origin.startsWith("https:") ? "; Secure" : "");
  }

  synchronized ObjectNode login(JsonNode input, boolean register, HttpServletResponse response) {
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
    var p = db.one("SELECT * FROM profiles WHERE login=?", login);
    if (register) {
      if (p != null)
        throw new ApiException(400, "Такой логин уже есть. Выберите профиль и войдите.");
      if (db.count("SELECT count(*) FROM profiles") >= 100)
        throw new ApiException(400, "Лимит профилей MVP достигнут.");
      String salt = random(16), id = UUID.randomUUID().toString();
      String name = clean(input, "name", 80);
      if (name.isEmpty()) name = login;
      db.run(
          "INSERT INTO profiles VALUES(?,?,?,?,?)", id, login, name, salt, derive(password, salt));
      p = db.one("SELECT * FROM profiles WHERE id=?", id);
    } else {
      String derived =
          derive(password, p == null ? "dummy-account-salt" : p.get("salt").toString());
      if (p == null
          || !MessageDigest.isEqual(
              derived.getBytes(StandardCharsets.US_ASCII),
              p.get("password").toString().getBytes(StandardCharsets.US_ASCII)))
        throw new ApiException(401, "Неверный логин или пароль.");
    }
    attempts.remove(login);
    String token = random(32);
    db.run("DELETE FROM sessions WHERE expires<=?", now);
    db.run(
        "INSERT INTO sessions(token,profile_id,expires) VALUES(?,?,?)",
        hash(token),
        p.get("id"),
        now + 604800000);
    response.setHeader("Set-Cookie", cookie(token, 604800));
    return object(
        "profile",
        object(
            "id",
            p.get("id"),
            "accountId",
            p.get("id"),
            "login",
            p.get("login"),
            "name",
            p.get("name")));
  }

  static String derive(String password, String salt) {
    return HexFormat.of()
        .formatHex(
            SCrypt.generate(
                password.getBytes(StandardCharsets.UTF_8),
                salt.getBytes(StandardCharsets.UTF_8),
                16384,
                8,
                1,
                64));
  }

  private static class BodyRequest extends HttpServletRequestWrapper {
    final byte[] body;

    BodyRequest(HttpServletRequest request, byte[] body) {
      super(request);
      this.body = body;
    }

    @Override
    public ServletInputStream getInputStream() {
      ByteArrayInputStream bytes = new ByteArrayInputStream(body);
      return new ServletInputStream() {
        public int read() {
          return bytes.read();
        }

        public boolean isFinished() {
          return bytes.available() == 0;
        }

        public boolean isReady() {
          return true;
        }

        public void setReadListener(ReadListener listener) {
          throw new UnsupportedOperationException();
        }
      };
    }

    @Override
    public BufferedReader getReader() {
      return new BufferedReader(new InputStreamReader(getInputStream(), StandardCharsets.UTF_8));
    }
  }
}
