package by.autopost;

import static com.tngtech.archunit.lang.syntax.ArchRuleDefinition.noClasses;

import com.tngtech.archunit.core.domain.JavaClasses;
import com.tngtech.archunit.core.importer.ClassFileImporter;
import com.tngtech.archunit.core.importer.ImportOption;
import org.junit.jupiter.api.Test;

/**
 * Raw JSON stays at the boundary: the model, the engine and the application of the rental module
 * work on records. Parsing (catalog, web), stored documents of older formats (persistence), the AI
 * answer and the DaData answer are the places where JSON is read.
 */
class RentalLayersTest {
  static final JavaClasses RENTAL =
      new ClassFileImporter()
          .withImportOption(ImportOption.Predefined.DO_NOT_INCLUDE_TESTS)
          .importPackages("by.autopost.rental");

  @Test
  void modelEngineAndApplicationDoNotWorkOnRawJson() {
    noClasses()
        .that()
        .resideInAnyPackage(
            "by.autopost.rental.model..",
            "by.autopost.rental.engine..",
            "by.autopost.rental.application..")
        .should()
        .dependOnClassesThat()
        .haveFullyQualifiedName("com.fasterxml.jackson.databind.JsonNode")
        .orShould()
        .dependOnClassesThat()
        .resideInAPackage("com.fasterxml.jackson.databind.node..")
        .because("JSON is parsed into records of rental/model at the boundary")
        .check(RENTAL);
  }

  @Test
  void modelAndEngineDependOnNothingButEachOther() {
    noClasses()
        .that()
        .resideInAnyPackage("by.autopost.rental.model..", "by.autopost.rental.engine..")
        .should()
        .dependOnClassesThat()
        .resideInAnyPackage(
            "by.autopost.rental.catalog..",
            "by.autopost.rental.application..",
            "by.autopost.rental.persistence..",
            "by.autopost.rental.web..",
            "org.springframework..",
            "java.nio.file..",
            "java.net.http..")
        .check(RENTAL);
    noClasses()
        .that()
        .resideInAPackage("by.autopost.rental.model..")
        .should()
        .dependOnClassesThat()
        .resideInAPackage("by.autopost.rental.engine..")
        .check(RENTAL);
  }
}
