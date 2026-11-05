package by.autopost;

import static com.tngtech.archunit.lang.syntax.ArchRuleDefinition.noClasses;
import static org.junit.jupiter.api.Assertions.*;

import com.tngtech.archunit.core.domain.JavaClasses;
import com.tngtech.archunit.core.importer.ClassFileImporter;
import com.tngtech.archunit.core.importer.ImportOption;
import java.nio.file.*;
import org.junit.jupiter.api.Test;

class ArchitectureTest {
  private static final JavaClasses CLASSES =
      new ClassFileImporter()
          .withImportOption(ImportOption.Predefined.DO_NOT_INCLUDE_TESTS)
          .importPackages("by.autopost");

  @Test
  void httpLayerCannotAccessPersistence() {
    noClasses()
        .that()
        .haveSimpleNameEndingWith("Controller")
        .or()
        .haveSimpleName("Access")
        .should()
        .dependOnClassesThat()
        .resideInAnyPackage("..persistence..", "org.springframework.jdbc..", "java.sql..")
        .check(CLASSES);
    noClasses()
        .that()
        .haveSimpleNameEndingWith("Controller")
        .or()
        .haveSimpleName("Access")
        .should()
        .dependOnClassesThat()
        .haveSimpleNameEndingWith("Repository")
        .check(CLASSES);
    noClasses()
        .that()
        .haveSimpleNameEndingWith("Controller")
        .or()
        .haveSimpleName("Access")
        .should()
        .dependOnClassesThat()
        .haveSimpleName("Database")
        .check(CLASSES);
  }

  @Test
  void applicationDoesNotDependOnHttpOrDatabaseImplementations() {
    noClasses()
        .that()
        .resideInAnyPackage("..application..", "..rental.ai..")
        .should()
        .dependOnClassesThat()
        .resideInAnyPackage(
            "..web..",
            "jakarta.servlet..",
            "org.springframework.web..",
            "..persistence..",
            "org.springframework.jdbc..",
            "java.sql..",
            "java.net.http..",
            "..infrastructure..")
        .check(CLASSES);
    noClasses()
        .that()
        .resideInAnyPackage("..application..", "..rental.ai..")
        .should()
        .dependOnClassesThat()
        .haveSimpleName("Database")
        .check(CLASSES);
    noClasses()
        .that()
        .haveSimpleName("AddressService")
        .should()
        .dependOnClassesThat()
        .resideInAnyPackage("java.net.http..", "..infrastructure..", "jakarta.servlet..")
        .check(CLASSES);
  }

  @Test
  void domainRulesDoNotDependOnApplicationOrInfrastructure() {
    noClasses()
        .that()
        .resideInAnyPackage("..rental.model..", "..rental.card..", "..rental.preparation..")
        .should()
        .dependOnClassesThat()
        .resideInAnyPackage(
            "..web..",
            "..application..",
            "..persistence..",
            "jakarta.servlet..",
            "org.springframework..")
        .check(CLASSES);
  }

  @Test
  void persistenceDoesNotCallUseCasesOrControllers() {
    noClasses()
        .that()
        .resideInAPackage("..persistence..")
        .should()
        .dependOnClassesThat()
        .haveSimpleNameEndingWith("Service")
        .check(CLASSES);
    noClasses()
        .that()
        .resideInAPackage("..persistence..")
        .should()
        .dependOnClassesThat()
        .resideInAnyPackage("..web..", "jakarta.servlet..", "org.springframework.web..")
        .check(CLASSES);
  }

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
