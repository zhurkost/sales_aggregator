package by.autopost.ai;

import static by.autopost.shared.Json.*;

import by.autopost.shared.ApiException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.net.URI;
import java.net.http.*;
import java.time.Duration;
import java.util.*;
import java.util.concurrent.ConcurrentHashMap;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

/** Shared transport, server credential boundary and per-user request budget. */
@Service
public class AiGateway {
  private final String key, provider, model;
  private final HttpClient client =
      HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(10)).build();
  private final Map<String, long[]> windows = new ConcurrentHashMap<>();

  public AiGateway(
      @Value("${autopost.ai-key}") String key,
      @Value("${autopost.ai-provider}") String provider,
      @Value("${autopost.ai-model}") String model) {
    this.key = key;
    this.provider = provider;
    this.model = model;
  }

  public String model() {
    return model;
  }

  public void rateLimit(String identity) {
    long now = System.currentTimeMillis();
    synchronized (windows) {
      windows.entrySet().removeIf(e -> e.getValue()[1] <= now);
      long[] bucket = windows.computeIfAbsent(identity, k -> new long[] {0, now + 60000});
      if (bucket[0] >= 10) throw new ApiException(429, "Не более 10 запросов ИИ в минуту.");
      bucket[0]++;
    }
  }

  /** Uses only the configured server credential; callers must authenticate their workspace. */
  public ObjectNode serverJson(String identity, String prompt, String source) {
    if (key.isBlank())
      throw new ApiException(503, "ИИ пока не подключён. Можно заполнить вручную.");
    if (!Set.of("openrouter", "deepseek").contains(provider))
      throw new ApiException(503, "Проверьте настройки сервиса ИИ на сервере.");
    rateLimit(identity);
    ObjectNode payload =
        object(
            "model",
            model,
            "messages",
            List.of(
                object("role", "system", "content", prompt),
                object("role", "user", "content", source)),
            "response_format",
            object("type", "json_object"),
            "max_tokens",
            4000);
    payload.set(
        provider.equals("deepseek") ? "thinking" : "reasoning",
        provider.equals("deepseek") ? object("type", "disabled") : object("enabled", false));
    try {
      return (ObjectNode) requestJson(provider, key, payload);
    } catch (ApiException e) {
      if (e.status == 400)
        throw new ApiException(502, "ИИ вернул некорректный ответ. Попробуйте ещё раз.");
      throw e;
    } catch (HttpTimeoutException e) {
      throw new ApiException(502, "ИИ не ответил за 45 секунд. Ваш текст сохранён.");
    } catch (Exception e) {
      if (e instanceof InterruptedException) Thread.currentThread().interrupt();
      throw new ApiException(
          502, "Не удалось заполнить с ИИ. Ваш текст сохранён; можно продолжить вручную.");
    }
  }

  public JsonNode requestJson(String service, String apiKey, ObjectNode payload) throws Exception {
    String url =
        service.equals("deepseek")
            ? "https://api.deepseek.com/chat/completions"
            : "https://openrouter.ai/api/v1/chat/completions";
    var upstream =
        client.send(
            HttpRequest.newBuilder(URI.create(url))
                .timeout(Duration.ofSeconds(45))
                .header("Content-Type", "application/json")
                .header("Authorization", "Bearer " + apiKey)
                .POST(HttpRequest.BodyPublishers.ofString(payload.toString()))
                .build(),
            HttpResponse.BodyHandlers.ofString());
    if (upstream.statusCode() < 200 || upstream.statusCode() >= 300)
      throw new ApiException(
          502,
          switch (upstream.statusCode()) {
            case 401 -> "API-ключ не принят сервисом.";
            case 402 -> "Недостаточно средств на балансе ИИ.";
            case 429 -> "Сервис ИИ ограничил запросы.";
            default -> "Сервис ИИ вернул ошибку " + upstream.statusCode() + ". Проверьте модель.";
          });
    JsonNode choice = parse(upstream.body()).path("choices").path(0);
    if (text(choice.path("message"), "content").isEmpty()
        || text(choice, "finish_reason").equals("length"))
      throw new ApiException(502, "ИИ не вернул полную карточку.");
    JsonNode parsed = parse(text(choice.path("message"), "content"));
    if (!parsed.isObject()) throw new ApiException(502, "ИИ вернул некорректную карточку.");
    return parsed;
  }
}
