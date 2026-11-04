package by.autopost.rental.catalog;

import static by.autopost.shared.Json.*;

import by.autopost.shared.ApiException;
import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.JsonNode;
import java.io.IOException;
import java.nio.file.*;
import java.util.function.Supplier;

/**
 * Disk boundary of the bundle: no source URLs, symlink escape or customer-supplied paths. Every
 * error names the file it is about.
 */
final class ReferenceFiles {
  private static final long LIMIT = 5 * 1024 * 1024;
  private final Path root;

  ReferenceFiles(String directory) {
    if (directory == null || directory.isBlank())
      throw new ReferenceBundleException(
          "autopost.rental-reference-dir", "каталог справочников аренды не задан", null);
    root = Path.of(directory).toAbsolutePath().normalize();
  }

  JsonNode read(String relative) {
    Path file = resolve(relative);
    if (!Files.isRegularFile(file)) throw fail(relative, "файл не найден", null);
    try {
      if (Files.size(file) > LIMIT) throw fail(relative, "файл больше 5 МиБ", null);
      JsonNode data = MAPPER.readTree(Files.readAllBytes(file));
      if (data == null || data.isMissingNode()) throw fail(relative, "файл пуст", null);
      return data;
    } catch (JsonProcessingException e) {
      var at = e.getLocation();
      throw fail(
          relative,
          "не JSON (строка "
              + at.getLineNr()
              + ", столбец "
              + at.getColumnNr()
              + "): "
              + e.getOriginalMessage(),
          e);
    } catch (IOException e) {
      throw fail(relative, "файл не читается: " + e.getMessage(), e);
    }
  }

  /** Runs the checks of one file: their error names that file. */
  void check(String relative, Runnable check) {
    checked(
        relative,
        () -> {
          check.run();
          return null;
        });
  }

  <T> T checked(String relative, Supplier<T> check) {
    try {
      return check.get();
    } catch (ApiException e) {
      throw fail(relative, e.getMessage(), null);
    }
  }

  private Path resolve(String relative) {
    try {
      Path path = root.resolve(relative).normalize();
      if (!path.startsWith(root) || Path.of(relative).isAbsolute()) throw new IOException();
      if (Files.exists(path) && !path.toRealPath().startsWith(root.toRealPath()))
        throw new IOException();
      return path;
    } catch (Exception e) {
      throw fail(relative, "путь выходит за каталог комплекта " + root, null);
    }
  }

  private ReferenceBundleException fail(String relative, String reason, Throwable cause) {
    String file;
    try {
      file = root.resolve(relative).normalize().toString();
    } catch (InvalidPathException e) {
      file = root + "/" + relative;
    }
    return new ReferenceBundleException(file, reason, cause);
  }
}
