package by.autopost;

import static org.junit.jupiter.api.Assertions.*;

import by.autopost.rental.catalog.FileReferenceRepository;
import by.autopost.rental.catalog.ReferenceBundleException;
import java.nio.file.Files;
import java.nio.file.Path;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.boot.builder.SpringApplicationBuilder;
import org.springframework.boot.test.system.CapturedOutput;
import org.springframework.boot.test.system.OutputCaptureExtension;

/** The bundle ships with the release: a broken one stops the start instead of answering 409. */
@ExtendWith(OutputCaptureExtension.class)
class RentalReferenceStartupTest {
  @TempDir Path dir;

  @Test
  void brokenBundleStopsTheApplicationAndTheLogNamesTheFileAndTheReason(CapturedOutput output)
      throws Exception {
    Path bundle = Files.createDirectory(dir.resolve("bundle"));
    try (var files = Files.list(Path.of("src/test/resources/reference-example"))) {
      for (Path file : files.toList()) Files.copy(file, bundle.resolve(file.getFileName()));
    }
    Path plan = bundle.resolve("example.plan.json");
    Files.writeString(plan, Files.readString(plan).replace("\"fields\"", "\"field\""));
    var application = new SpringApplicationBuilder(AutopostApplication.class);
    var error =
        assertThrows(
            Exception.class,
            () ->
                application.run(
                    "--server.port=0",
                    "--autopost.rental-reference-dir=" + bundle,
                    "--autopost.data-dir=" + dir.resolve("data"),
                    "--spring.datasource.url=jdbc:sqlite:" + dir.resolve("data/workspace.sqlite")));
    Throwable cause = error;
    while (!(cause instanceof ReferenceBundleException) && cause.getCause() != null)
      cause = cause.getCause();
    String reason =
        plan + ": Ошибка комплекта справочников: неизвестный ключ field.";
    assertEquals(reason, cause.getMessage());
    assertTrue(output.getAll().contains(reason), "the start log names the file and the reason");
  }

  @Test
  void aReleaseWithoutTheBundleDirectoryDoesNotStart() {
    var error = assertThrows(ReferenceBundleException.class, () -> new FileReferenceRepository(""));
    assertTrue(error.getMessage().contains("каталог справочников аренды не задан"));
  }
}
