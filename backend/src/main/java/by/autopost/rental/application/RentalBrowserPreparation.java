package by.autopost.rental.application;

import by.autopost.rental.catalog.ReferenceSnapshot;
import by.autopost.rental.model.Card;
import by.autopost.rental.model.Value;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Compiles filled native values and verified selectors. Issues never block a launch; each job's
 * checksPassed (no issues for that platform) only decides whether the extension may submit itself.
 */
final class RentalBrowserPreparation {
  ExtensionLaunch compile(
      ReferenceSnapshot snapshot, List<RentalCatalog.Checked> checks, Card card) {
    List<ExtensionLaunch.Job> jobs = new ArrayList<>();
    var address = card.address();
    for (var checked : checks) {
      var check = checked.check();
      String platform = check.platform();
      var recipe = snapshot.form(platform);
      var fields = snapshot.schema(platform).fields();
      List<ExtensionLaunch.Control> controls = new ArrayList<>();
      for (var source : recipe.controlList()) {
        String id = source.field();
        Value value =
            source.addressPart() != null
                ? Value.text(address.part(source.addressPart()))
                : checked.preparation().values().get(id);
        if (!source.action().equals("files") && Value.missing(value)) continue;
        List<String> matchContext = new ArrayList<>();
        if (source.autocomplete() != null && source.autocomplete().contextParts() != null)
          for (String part : source.autocomplete().contextParts()) {
            String context = address.part(part);
            // A city may be its own first-level region (DaData's "г Минск").
            // The city already matches the primary suggestion label; treating it as an
            // additional oblast would reject the correct suggestion on another platform.
            if (part.equals("region") && placeName(context).equals(placeName(address.settlement())))
              continue;
            if (!context.isBlank()) matchContext.add(context);
          }
        var field = fields.get(id);
        Map<String, String> labels = new LinkedHashMap<>();
        for (var option : field.options())
          if (option.rule().value() != null)
            labels.put(labelKey(option.rule().value()), option.name());
        controls.add(
            new ExtensionLaunch.Control(
                source,
                value == null ? new Value.Items(List.of()) : value,
                matchContext.isEmpty() ? null : matchContext,
                field.name(),
                labels));
      }
      // The fields the user enters on the platform, as the check of the card lists them.
      var unbound = check.manual().stream().map(manual -> manual.name()).toList();
      jobs.add(
          new ExtensionLaunch.Job(
              recipe.format(),
              recipe.platform(),
              recipe.startUrl(),
              recipe.ready(),
              controls,
              recipe.setup(),
              recipe.next(),
              recipe.submit(),
              unbound,
              check.checksPassed(),
              null));
    }
    return new ExtensionLaunch(1, snapshot.integrationVersion(), jobs, null, null, null);
  }

  /** The key of an option code in the label table, as the extension looks it up. */
  private static String labelKey(Value code) {
    return code == Value.Null.NULL ? "null" : code.text();
  }

  private String placeName(String value) {
    return value
        .toLowerCase(java.util.Locale.ROOT)
        .replaceAll("\\s+", " ")
        .trim()
        .replaceFirst("^(?:г\\.?|город)\\s+", "");
  }
}
