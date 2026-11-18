package by.autopost.automotive.application;

import static by.autopost.shared.Json.*;
import by.autopost.shared.ApiException;
import com.fasterxml.jackson.databind.JsonNode;
import java.util.*;

/** Shared validation for manual and recognized site-specific values before native mapping. */
public final class CarExtraFields {
  private CarExtraFields(){}
  public static JsonNode validate(JsonNode field,JsonNode value){
    String type=text(field,"type");boolean valid=switch(type){
      case "boolean" -> value.isBoolean();
      case "number" -> value.isNumber();
      case "integer" -> value.isIntegralNumber();
      case "text" -> value.isTextual();
      case "enum" -> choice(field,value);
      case "multi_enum" -> value.isArray()&&list(value).stream().allMatch(v->choice(field,v));
      default -> false;
    };
    if(!valid)throw new ApiException(400,"Неверное значение дополнительного поля: "+text(field,"name"));
    JsonNode rules=field.path("validation");
    if(value.isNumber()&&(rules.path("min").isNumber()&&value.decimalValue().compareTo(rules.path("min").decimalValue())<0||rules.path("max").isNumber()&&value.decimalValue().compareTo(rules.path("max").decimalValue())>0))
      throw new ApiException(400,"Значение дополнительного поля вне допустимых границ.");
    if(value.isTextual()&&rules.path("max_length").isInt()&&value.asText().length()>rules.path("max_length").asInt())throw new ApiException(400,"Слишком длинное значение дополнительного поля.");
    if(type.equals("multi_enum"))return array(new ArrayList<>(new LinkedHashSet<>(list(value))));
    return value.deepCopy();
  }
  private static boolean choice(JsonNode field,JsonNode value){return value.isTextual()&&list(field.path("options")).stream().anyMatch(o->text(o,"id").equals(value.asText()));}
}
