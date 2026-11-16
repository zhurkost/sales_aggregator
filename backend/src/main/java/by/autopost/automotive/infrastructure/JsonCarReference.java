package by.autopost.automotive.infrastructure;
import by.autopost.automotive.application.CarReference;
import com.fasterxml.jackson.databind.JsonNode;
import by.autopost.shared.Json;
import java.nio.file.*;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;
/** Loads the generated catalogue once; private marketplace/account data are not included. */
@Component
public class JsonCarReference implements CarReference {
  private final JsonNode data;
  public JsonCarReference(@Value("${autopost.automotive-reference-file:}") String file) {
    try (var stream=file.isBlank()?getClass().getResourceAsStream("/automotive/cars_used_sale/runtime.json"):Files.newInputStream(Path.of(file))) { data=Json.MAPPER.readTree(stream); }
    catch(Exception e) { throw new IllegalStateException("Не найден справочник автомобилей: "+file,e); }
    if(!data.path("categoryId").asText().equals("cars_used_sale"))throw new IllegalStateException("Неверный справочник автомобилей");
  }
  public JsonNode data(){return data;}
}
