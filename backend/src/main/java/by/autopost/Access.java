package by.autopost;

import static by.autopost.shared.Json.*;

import by.autopost.shared.ApiException;
import by.autopost.workspace.application.WorkspaceService;
import by.autopost.workspace.application.WorkspaceService.Actor;
import jakarta.servlet.*;
import jakarta.servlet.http.*;
import java.io.*;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.security.*;
import java.util.*;
import java.util.regex.Pattern;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

@Component
public class Access extends OncePerRequestFilter {
  private final WorkspaceService workspaceService;
  final String origin, proxySecret;

  Access(
      WorkspaceService workspaceService,
      @Value("${autopost.origin}") String origin,
      @Value("${autopost.proxy-secret}") String secret) {
    this.workspaceService = workspaceService;
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
        int limit = 5 * 1024 * 1024;
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

  public static String token(HttpServletRequest req) {
    var m =
        Pattern.compile("(?:^|;\\s*)autopost_session=([a-f0-9]{64})(?:;|$)")
            .matcher(Objects.toString(req.getHeader("Cookie"), ""));
    return m.find() ? m.group(1) : "";
  }

  Actor user(HttpServletRequest req) {
    return workspaceService.user(token(req));
  }

  public Actor require(HttpServletRequest req) {
    Actor actor = user(req);
    if (actor == null) throw new ApiException(401, "Выберите профиль и войдите.");
    String workspace = req.getHeader("X-Autopost-Workspace");
    if (workspace != null && !workspace.equals(actor.workspace()))
      throw new ApiException(409, "Кабинет изменился в другой вкладке. Обновите страницу.");
    return actor;
  }

  public String cookie(String token, int age) {
    return "autopost_session="
        + token
        + "; Path=/; HttpOnly; SameSite=Strict; Max-Age="
        + age
        + (origin.startsWith("https:") ? "; Secure" : "");
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
