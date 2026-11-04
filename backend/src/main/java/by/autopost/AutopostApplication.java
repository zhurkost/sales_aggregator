package by.autopost;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;

@SpringBootApplication
public class AutopostApplication {
  public static void main(String[] args) throws Exception {
    if (args.length > 0
        && args[0].equals(by.autopost.rental.persistence.RentalDraftMigrationCommand.FLAG)) {
      by.autopost.rental.persistence.RentalDraftMigrationCommand.run(args);
      return;
    }
    if (args.length == 1 && args[0].startsWith("--rental-coverage=")) {
      by.autopost.rental.catalog.RentalCoverageReport.run(
          args[0].substring(args[0].indexOf('=') + 1));
      return;
    }
    if (args.length == 1 && args[0].startsWith("--validate-rental-reference=")) {
      by.autopost.rental.catalog.ReferenceBundleCheck.run(
          args[0].substring(args[0].indexOf('=') + 1));
      return;
    }
    SpringApplication.run(AutopostApplication.class, args);
  }
}
