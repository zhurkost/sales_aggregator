package by.autopost.rental.ai;

import static by.autopost.shared.Json.*;

import by.autopost.AddressService;
import by.autopost.shared.ApiException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import org.springframework.stereotype.Service;

/**
 * Resolves AI evidence through the same workspace-scoped provider used by manual address search.
 */
@Service
public class RentalAiAddressResolver {
  private final AddressService addresses;

  public RentalAiAddressResolver(AddressService addresses) {
    this.addresses = addresses;
  }

  private static String lookupQuery(JsonNode address) {
    if (text(address, "settlement").isBlank() || text(address, "street").isBlank()) return text(address, "label");
    return java.util.stream.Stream.of(text(address, "region"), text(address, "district"),
        text(address, "settlement"), text(address, "street"), text(address, "house"),
        text(address, "block").isBlank() ? "" : "корпус " + text(address, "block"))
        .filter(s -> !s.isBlank()).collect(java.util.stream.Collectors.joining(" "));
  }

  public void resolve(String workspace, ObjectNode result) {
    if (!(result.get("address") instanceof ObjectNode literal)) return;
    String status = "not_found";
    try {
      JsonNode suggestions =
          addresses.suggest(workspace, lookupQuery(literal)).path("suggestions");
      var matches =
          list(suggestions).stream()
              .filter(s -> LiteralAddress.matches(literal, s.path("address")))
              .toList();
      if (matches.size() == 1) {
        ObjectNode selected =
            (ObjectNode) addresses.select(workspace, text(matches.get(0), "id")).path("address");
        // A provider may refine a suggestion during confirmation; verify every component again.
        if (LiteralAddress.matches(literal, selected)) {
          selected.put("resolution", "matched");
          result.set("address", selected);
          result.set(
              "addressResolution",
              object(
                  "status",
                  "matched",
                  "sourceLabel",
                  text(literal, "label"),
                  "message",
                  "Адрес проверен по DaData."));
          return;
        }
      }
      if (!suggestions.isEmpty()) status = "ambiguous";
    } catch (ApiException e) {
      // Address lookup is optional. Keep the literal components and all other AI suggestions.
      status = e.status == 409 ? "ambiguous" : "unavailable";
    }
    String sourceLabel = text(literal, "label");
    // The editor displays label, including when the provider cannot confirm the house.
    if (!text(literal, "settlement").isBlank() || !text(literal, "street").isBlank()) {
      String display = java.util.stream.Stream.of(text(literal, "region"), text(literal, "district"),
          text(literal, "settlement"), text(literal, "street"),
          text(literal, "house").isBlank() ? "" : "дом " + text(literal, "house"),
          text(literal, "block").isBlank() ? "" : "корпус " + text(literal, "block"))
          .filter(part -> !part.isBlank()).collect(java.util.stream.Collectors.joining(", "));
      literal.put("label", display);
    }
    literal.put("resolution", status);
    String message =
        switch (status) {
          case "unavailable" -> "DaData недоступна. Проверьте адрес в отдельных полях.";
          case "ambiguous" ->
              "Не удалось однозначно определить дом. Проверьте адрес в отдельных полях.";
          default -> "Адрес не найден в DaData. Проверьте адрес в отдельных полях.";
        };
    result.set(
        "addressResolution",
        object("status", status, "sourceLabel", sourceLabel, "message", message));
  }
}
