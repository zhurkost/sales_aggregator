package by.autopost.rental.ai;

import static by.autopost.shared.Json.*;

import by.autopost.ai.AiGateway;
import by.autopost.rental.application.RentalCatalog;
import by.autopost.shared.ApiException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import org.springframework.stereotype.Service;

@Service
public class RentalAiService {
  private final RentalCatalog catalog;
  private final AiGateway ai;
  private final RentalAiAddressResolver addresses;

  public RentalAiService(RentalCatalog catalog, AiGateway ai, RentalAiAddressResolver addresses) {
    this.catalog = catalog;
    this.ai = ai;
    this.addresses = addresses;
  }

  public ObjectNode analyze(String identity, String workspace, JsonNode input) {
    if (!input.isObject() || !input.path("text").isTextual() || input.toString().length() > 18000)
      throw new ApiException(400, "Введите описание квартиры.");
    String source = input.path("text").asText().trim();
    if (source.length() < 10 || source.length() > 8000)
      throw new ApiException(400, "Описание должно содержать от 10 до 8000 символов.");
    ObjectNode editor = catalog.editor();
    if (!text(input, "cardVersion").equals(text(editor, "cardVersion")))
      throw new ApiException(
          409, "Правила обновились. Обновите поля карточки и повторите заполнение.");
    var parsed = ai.serverJson(identity, RentalAiPolicy.prompt(editor), source);
    ObjectNode result = RentalAiPolicy.sanitize(editor, source, parsed);
    addresses.resolve(workspace, result);
    result.put("cardVersion", text(editor, "cardVersion"));
    result.put("model", ai.model());
    return result;
  }
}
