package by.autopost;

import java.net.*;
import java.nio.charset.*;
import java.util.*;
import java.util.concurrent.ConcurrentHashMap;
import org.apache.hc.client5.http.classic.methods.HttpGet;
import org.apache.hc.client5.http.config.RequestConfig;
import org.apache.hc.client5.http.impl.classic.HttpClients;
import org.apache.hc.client5.http.impl.io.PoolingHttpClientConnectionManagerBuilder;
import org.apache.hc.core5.util.Timeout;
import org.springframework.stereotype.Service;

@Service
class FeedService {
  private final Map<String, Long> requests = new ConcurrentHashMap<>();

  String fetch(String profile, String address) {
    long now = System.currentTimeMillis();
    synchronized (requests) {
      if (now - requests.getOrDefault(profile, 0L) < 15000)
        throw new ApiException(429, "Повторите загрузку через 15 секунд.");
      requests.entrySet().removeIf(e -> now - e.getValue() > 60000);
      requests.put(profile, now);
    }
    return fetch(address, 0);
  }

  static boolean publicAddress(InetAddress ip) {
    byte[] bytes = ip.getAddress();
    if (bytes.length != 4) return false;
    int a = bytes[0] & 255, b = bytes[1] & 255;
    return !(a == 0
        || a == 10
        || a == 127
        || a >= 224
        || a == 169 && b == 254
        || a == 172 && b >= 16 && b <= 31
        || a == 192 && Set.of(0, 2, 168).contains(b)
        || a == 198 && Set.of(18, 19, 51).contains(b)
        || a == 203 && b == 0
        || a == 100 && b >= 64 && b <= 127);
  }

  private String fetch(String address, int redirects) {
    try {
      URI url = URI.create(address);
      String host = url.getHost();
      if (!"https".equals(url.getScheme())
          || url.getUserInfo() != null
          || url.getPort() != -1 && url.getPort() != 443
          || host == null
          || host.endsWith(".")
          || host.matches("[0-9.]+")
          || host.contains(":")
          || host.length() > 253
          || redirects > 3)
        throw new ApiException(
            400, "Нужен публичный HTTPS-адрес каталога без пароля и нестандартного порта.");
      InetAddress[] addresses =
          Arrays.stream(InetAddress.getAllByName(host))
              .filter(ip -> ip instanceof java.net.Inet4Address)
              .toArray(InetAddress[]::new);
      if (addresses.length == 0 || Arrays.stream(addresses).anyMatch(ip -> !publicAddress(ip)))
        throw new ApiException(400, "Внутренние сетевые адреса недоступны для импорта.");
      var manager =
          PoolingHttpClientConnectionManagerBuilder.create()
              .setDnsResolver(
                  new org.apache.hc.client5.http.DnsResolver() {
                    public InetAddress[] resolve(String name) throws UnknownHostException {
                      if (!name.equals(host)) throw new UnknownHostException();
                      return addresses;
                    }

                    public String resolveCanonicalHostname(String name) {
                      return name;
                    }
                  })
              .build();
      try (var client =
          HttpClients.custom()
              .setConnectionManager(manager)
              .disableRedirectHandling()
              .disableContentCompression()
              .setDefaultRequestConfig(
                  RequestConfig.custom()
                      .setResponseTimeout(Timeout.ofSeconds(15))
                      .setConnectTimeout(Timeout.ofSeconds(12))
                      .build())
              .build()) {
        HttpGet request = new HttpGet(url);
        // A total deadline also stops a source that sends bytes just often enough to avoid a socket
        // timeout.
        java.util.concurrent.CompletableFuture.delayedExecutor(
                15, java.util.concurrent.TimeUnit.SECONDS)
            .execute(request::cancel);
        request.setHeader("Accept", "application/xml,text/xml,text/plain");
        request.setHeader("Accept-Encoding", "identity");
        return client.execute(
            request,
            response -> {
              int status = response.getCode();
              if (Set.of(301, 302, 303, 307, 308).contains(status)) {
                var location = response.getFirstHeader("Location");
                if (location == null)
                  throw new ApiException(400, "Некорректное перенаправление каталога.");
                return fetch(url.resolve(location.getValue()).toString(), redirects + 1);
              }
              if (status != 200
                  || response.getFirstHeader("Content-Encoding") != null
                      && !response.getFirstHeader("Content-Encoding").getValue().equals("identity"))
                throw new ApiException(400, "Источник не вернул доступный XML-каталог.");
              byte[] bytes = response.getEntity().getContent().readNBytes(5 * 1024 * 1024 + 1);
              if (bytes.length > 5 * 1024 * 1024)
                throw new ApiException(400, "Каталог больше 5 МБ.");
              String header =
                  new String(bytes, 0, Math.min(200, bytes.length), StandardCharsets.US_ASCII);
              Charset charset =
                  header
                          .toLowerCase(Locale.ROOT)
                          .matches("(?s).*encoding\\s*=\\s*[\"']windows-1251[\"'].*")
                      ? Charset.forName("windows-1251")
                      : StandardCharsets.UTF_8;
              String text =
                  charset
                      .newDecoder()
                      .onMalformedInput(CodingErrorAction.REPORT)
                      .decode(java.nio.ByteBuffer.wrap(bytes))
                      .toString();
              if (!text.matches("(?s).*<yml_catalog[\\s>].*")
                  || text.toUpperCase(Locale.ROOT).matches("(?s).*<!(DOCTYPE|ENTITY).*"))
                throw new ApiException(400, "По ссылке должен быть YML без DTD и сущностей.");
              return text;
            });
      }
    } catch (ApiException e) {
      throw e;
    } catch (Exception e) {
      throw new ApiException(400, "Не удалось загрузить каталог. Проверьте HTTPS-ссылку.");
    }
  }
}
