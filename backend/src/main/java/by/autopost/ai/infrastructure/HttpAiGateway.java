package by.autopost.ai.infrastructure;

import static by.autopost.shared.Json.*;

import by.autopost.ai.AiGateway;
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
public class HttpAiGateway implements AiGateway {
  private final String key, provider, model, visionModel;
  private final HttpClient client =
      HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(10)).build();
  private final Map<String, long[]> windows = new ConcurrentHashMap<>();

  public HttpAiGateway(
      @Value("${autopost.ai-key}") String key,
      @Value("${autopost.ai-provider}") String provider,
      @Value("${autopost.ai-model}") String model,
      @Value("${autopost.ai-vision-model:}") String visionModel) {
    this.key = key;
    this.provider = provider;
    this.model = model;
    this.visionModel = visionModel.isBlank() ? model : visionModel;
  }

  @Override
  public String model() {
    return model;
  }

  @Override
  public String visionModel() { return visionModel; }

  private void rateLimit(String identity) {
    long now = System.currentTimeMillis();
    synchronized (windows) {
      windows.entrySet().removeIf(e -> e.getValue()[1] <= now);
      long[] bucket = windows.computeIfAbsent(identity, k -> new long[] {0, now + 60000});
      if (bucket[0] >= 10) throw new ApiException(429, "Не более 10 запросов ИИ в минуту.");
      bucket[0]++;
    }
  }

  /** Uses only the configured server credential; callers must authenticate their workspace. */
  @Override
  public ObjectNode serverJson(String identity, String prompt, String source) {
    return serverJson(identity, prompt, source, List.of());
  }

  @Override
  public ObjectNode serverJson(String identity, String prompt, String source, List<String> images) {
    if (key.isBlank())
      throw new ApiException(503, "ИИ пока не подключён. Можно заполнить вручную.");
    if (!Set.of("openrouter", "deepseek").contains(provider))
      throw new ApiException(503, "Проверьте настройки сервиса ИИ на сервере.");
    rateLimit(identity);
    if (!images.isEmpty() && provider.equals("deepseek"))
      throw new ApiException(409, "Текущий провайдер не поддерживает фото. Для распознавания нужна модель с поддержкой изображений через OpenRouter; пока можно заполнить описание вручную.");
    var content = array();
    content.add(object("type", "text", "text", source));
    for (String image : images) content.add(object("type", "image_url", "image_url", object("url", image)));
    ObjectNode payload =
        object(
            "model",
            images.isEmpty() ? model : visionModel,
            "messages",
            List.of(
                object("role", "system", "content", prompt),
                object("role", "user", "content", images.isEmpty() ? MAPPER.valueToTree(source) : content)),
            "response_format",
            object("type", "json_object"),
            "max_tokens",
            4000);
    payload.set(
        provider.equals("deepseek") ? "thinking" : "reasoning",
        provider.equals("deepseek") ? object("type", "disabled")
            : images.isEmpty() ? object("enabled", false)
            : object("max_tokens", 1024, "exclude", true));
    try {
      return requestJson(payload);
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

  private ObjectNode requestJson(ObjectNode payload) throws Exception {
    String url =
        provider.equals("deepseek")
            ? "https://api.deepseek.com/chat/completions"
            : "https://openrouter.ai/api/v1/chat/completions";
    var upstream =
        client.send(
            HttpRequest.newBuilder(URI.create(url))
                .timeout(Duration.ofSeconds(45))
                .header("Content-Type", "application/json")
                .header("Authorization", "Bearer " + key)
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
    if (!(parsed instanceof ObjectNode result)) throw new ApiException(502, "ИИ вернул некорректную карточку.");
    return result;
  }
}
