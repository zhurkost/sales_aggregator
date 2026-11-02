package by.autopost.rental.catalog;

import static by.autopost.shared.Json.*;

import by.autopost.shared.ApiException;
import com.fasterxml.jackson.databind.JsonNode;
import java.io.IOException;
import java.nio.file.*;

/** Disk boundary: no source URLs, symlink escape or customer-supplied paths. */
final class ReferenceFiles {
  private final Path root;

  ReferenceFiles(String directory) {
    root = directory.isBlank() ? null : Path.of(directory).toAbsolutePath().normalize();
  }

  Path resolve(String relative) {
    if (root == null)
      throw new ApiException(503, "Справочники аренды ещё не подключены на сервере.");
    try {
      Path path = root.resolve(relative).normalize();
      if (!path.startsWith(root) || Path.of(relative).isAbsolute()) throw new IOException();
      if (Files.exists(path) && !path.toRealPath().startsWith(root.toRealPath()))
        throw new IOException();
      return path;
    } catch (Exception e) {
      throw new ApiException(409, "Некорректный путь в комплекте справочников.");
    }
  }

  boolean exists(String relative) {
    return Files.isRegularFile(resolve(relative));
  }

  JsonNode read(String relative) {
    try {
      Path file = resolve(relative);
      if (Files.size(file) > 5 * 1024 * 1024) throw new IOException();
      JsonNode data = MAPPER.readTree(Files.readAllBytes(file));
      if (data == null) throw new IOException();
      return data;
    } catch (ApiException e) {
      throw e;
    } catch (Exception e) {
      throw new ApiException(503, "Комплект справочников отсутствует или повреждён.");
    }
  }

  String stamp(String relative) {
    try {
      Path file = resolve(relative);
      return Files.exists(file)
          ? Files.getLastModifiedTime(file).toString() + ":" + Files.size(file)
          : "missing";
    } catch (Exception e) {
      return "unavailable";
    }
  }
}
