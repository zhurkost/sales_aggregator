package by.autopost;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;

@SpringBootApplication
public class AutopostApplication {
  public static void main(String[] args) {
    if (args.length == 1 && args[0].startsWith("--validate-rental-reference=")) {
      by.autopost.rental.catalog.ReferenceBundleCheck.run(
          args[0].substring(args[0].indexOf('=') + 1));
      return;
    }
    SpringApplication.run(AutopostApplication.class, args);
  }
}
