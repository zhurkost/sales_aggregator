package by.autopost;

import static org.junit.jupiter.api.Assertions.*;

import java.nio.file.*;
import java.util.*;
import org.junit.jupiter.api.Test;

/** Cheap boundaries check: new platform rules must not leak back into feature code. */
class ArchitectureTest {
  @Test
  void rentalModulesKeepTheirDependencyDirection() throws Exception {
    Path root = Path.of("src/main/java/by/autopost/rental");
    try (var paths = Files.walk(root)) {
      for (var file : paths.filter(p -> p.toString().endsWith(".java")).toList()) {
        String name = root.relativize(file).toString().replace('\\', '/'),
            source = Files.readString(file);
        if (!name.startsWith("web/"))
          assertFalse(
              source.contains("jakarta.servlet")
                  || source.contains("web.bind.annotation")
                  || source.matches("(?s).*import .*Controller;.*"),
              name);
        if (!name.startsWith("persistence/"))
          assertFalse(
              source.contains("jdbc")
                  || source.contains("SELECT ")
                  || source.contains("CREATE TABLE"),
              name);
        if (name.startsWith("web/"))
          assertFalse(
              source.contains("java.net.http")
                  || source.contains("java.nio.file")
                  || source.contains("rental.persistence"),
              name);
        if (name.startsWith("model/") || name.startsWith("preparation/")) {
          assertFalse(
              source.contains("org.springframework")
                  || source.contains("java.nio.file")
                  || source.contains("java.net.http")
                  || source.contains("rental.application")
                  || source.contains("rental.catalog"),
              name);
        }
        assertFalse(
            source.matches("(?s).*\"(?:kufar|onliner|realt|domovita)\".*"),
            name + ": marketplace IDs belong in the reference bundle");
      }
    }
  }
}
