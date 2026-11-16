package by.autopost.ai;

import com.fasterxml.jackson.databind.node.ObjectNode;

public interface AiGateway {
  String model();

  default String visionModel() { return model(); }

  ObjectNode serverJson(String identity, String prompt, String source);

  default ObjectNode serverJson(String identity, String prompt, String source, java.util.List<String> images) {
    if (!images.isEmpty()) throw new by.autopost.shared.ApiException(503, "Распознавание фото для этой модели ИИ не подключено.");
    return serverJson(identity, prompt, source);
  }
}
