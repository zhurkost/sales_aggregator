package by.autopost.rental.ai;

import by.autopost.address.application.AddressText;

import static by.autopost.shared.Json.*;

import by.autopost.ai.AiGateway;
import by.autopost.rental.application.RentalCatalog;
import by.autopost.shared.ApiException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import org.springframework.stereotype.Service;

@Service
public class RentalAiService {
  private final AiGateway ai;
  private final RentalAiAddressResolver addresses;

  public RentalAiService(AiGateway ai, RentalAiAddressResolver addresses) {
    this.ai = ai;
    this.addresses = addresses;
  }

  public ObjectNode analyze(RentalCatalog catalog, String profile, String identity, String workspace, JsonNode input) {
    if (!input.isObject() || !input.path("text").isTextual() || input.toString().length() > 18000)
      throw new ApiException(400, "Введите описание объявления.");
    String source = input.path("text").asText().trim();
    if (source.length() < 10 || source.length() > 8000)
      throw new ApiException(400, "Описание должно содержать от 10 до 8000 символов.");
    ObjectNode editor = catalog.analysisSchema();
    if (!text(input, "schemaVersion").equals(text(editor, "version")))
      throw new ApiException(
          409, "Правила обновились. Обновите поля карточки и повторите заполнение.");
    var parsed = ai.serverJson(identity, RentalAiPolicy.prompt(editor, profile), source);
    ObjectNode result = RentalAiPolicy.sanitize(editor, source, parsed);
    completeCopy(editor, profile, identity, source, result);
    addresses.resolve(workspace, result);
    // Keep type information during provider matching; expose clean components to the editor.
    if (result.get("address") instanceof ObjectNode address)
      AddressText.cleanComponents(address);
    result.put("schemaVersion", text(editor, "version"));
    result.put("model", ai.model());
    return result;
  }

  /** Retry only omitted/invalid copy, without replacing already verified facts. */
  private void completeCopy(ObjectNode editor, String profile, String identity, String source, ObjectNode result) {
    if (result.path("suggestions").isEmpty()) return;
    var fields = RentalAiPolicy.fields(editor);
    var missing = array();
    for (String id : java.util.List.of("listing.title", "listing.short_description"))
      if (fields.containsKey(id) && list(result.path("suggestions")).stream().noneMatch(s -> text(s, "field").equals(id)))
        missing.add(fields.get(id));
    if (missing.isEmpty()) return;
    ObjectNode copyEditor = editor.deepCopy();
    copyEditor.set("category", object("options", java.util.List.of(object("options", missing))));
    try {
      var extra = RentalAiPolicy.sanitize(copyEditor, source,
          ai.serverJson(identity, RentalAiPolicy.prompt(copyEditor, profile)
              + "\nЭто дополнение к уже распознанному объявлению. Верни только перечисленные текстовые поля. Не используй многоточия в цитате: скопируй непрерывный фрагмент дословно.", source));
      ((com.fasterxml.jackson.databind.node.ArrayNode) result.path("suggestions")).addAll(
          (com.fasterxml.jackson.databind.node.ArrayNode) extra.path("suggestions"));
    } catch (ApiException unavailable) {
      // A copy-generation failure must not discard the successfully extracted card.
    }
    if (list(result.path("suggestions")).stream().noneMatch(s -> text(s, "field").equals("listing.title"))
        && fields.containsKey("listing.title") && result.path("questions").size() < 3)
      ((com.fasterxml.jackson.databind.node.ArrayNode) result.path("questions"))
          .add("Не удалось составить проверенный заголовок. Заполните его вручную.");
  }
}
