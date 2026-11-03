package by.autopost.rental.ai;

import static by.autopost.shared.Json.*;

import by.autopost.rental.address.AddressService;
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

  public void resolve(String workspace, ObjectNode result) {
    if (!(result.get("address") instanceof ObjectNode literal)) return;
    String status = "not_found";
    try {
      JsonNode suggestions =
          addresses.suggest(workspace, text(literal, "label")).path("suggestions");
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
        object("status", status, "sourceLabel", text(literal, "label"), "message", message));
  }
}
