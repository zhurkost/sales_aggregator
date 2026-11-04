package by.autopost.rental.catalog;

import static by.autopost.shared.Json.text;

import java.nio.charset.StandardCharsets;
import java.util.Arrays;
import java.util.stream.Collectors;

/**
 * {@code --rental-coverage=<bundle>}: the coverage of every platform as markdown, for a pull
 * request and for the owner. The bundle is loaded and validated as at the start of a release.
 */
public final class RentalCoverageReport {
  private RentalCoverageReport() {}

  public static void run(String directory) {
    // UTF-8 whatever the locale of the shell: the table is Russian text.
    System.out.writeBytes(
        markdown(new FileReferenceRepository(directory).snapshot())
            .getBytes(StandardCharsets.UTF_8));
    System.out.flush();
  }

  public static String markdown(ReferenceSnapshot snapshot) {
    var out = new StringBuilder("# Покрытие форм: ").append(snapshot.categoryId()).append("\n\n");
    out.append("| Площадка |");
    for (var transfer : Transfer.values()) out.append(' ').append(transfer.code()).append(" |");
    out.append("\n| --- |").append(" ---: |".repeat(Transfer.values().length)).append('\n');
    for (String platform : snapshot.platforms()) {
      var coverage = snapshot.coverage(platform);
      out.append("| ").append(name(snapshot, platform)).append(" |");
      for (var transfer : Transfer.values())
        out.append(' ').append(coverage.count(transfer)).append(" |");
      out.append('\n');
    }
    for (String platform : snapshot.platforms()) {
      out.append("\n## ").append(name(snapshot, platform)).append("\n\n");
      out.append("| Поле карточки | Поле площадки | Элемент формы | Статус | Причина |\n");
      out.append("| --- | --- | --- | --- | --- |\n");
      for (var row : snapshot.coverage(platform).rows())
        out.append("| ")
            .append(cell(String.join(", ", row.sources())))
            .append(" | ")
            .append(cell(row.field() + " — " + row.name()))
            .append(" | ")
            .append(row.element().isEmpty() ? "" : "`" + cell(row.element()) + "`")
            .append(" | ")
            .append(row.transfer().code())
            .append(" | ")
            .append(cell(row.reason()))
            .append(" |\n");
    }
    return out.toString();
  }

  private static String name(ReferenceSnapshot snapshot, String platform) {
    String name = text(snapshot.card().path("platforms").path(platform), "name");
    return name.isBlank() ? platform : name + " (" + platform + ")";
  }

  /** One table cell: a pipe would end it, a line break would end the row. */
  private static String cell(String value) {
    return Arrays.stream(value.split("\\R"))
        .map(String::strip)
        .collect(Collectors.joining(" "))
        .replace("|", "\\|");
  }
}
