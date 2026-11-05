package by.autopost.rental.catalog;

import by.autopost.shared.Json;
import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.JsonMappingException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.exc.InvalidTypeIdException;
import com.fasterxml.jackson.databind.exc.MismatchedInputException;
import com.fasterxml.jackson.databind.exc.UnrecognizedPropertyException;

/**
 * The parsing boundary of reference files: JSON becomes records of {@code rental/model}, and a
 * parsing error becomes a reason the owner of the bundle can act on.
 */
public final class ReferenceJson {
  private ReferenceJson() {}

  /** One reference record from JSON, for a check outside the loader (a test, a command). */
  public static <T> T parse(JsonNode data, Class<T> type) {
    try {
      return Json.TYPED.treeToValue(data, type);
    } catch (JsonProcessingException e) {
      throw new by.autopost.shared.ApiException(409, reason(e));
    }
  }

  /** The reason in the words of the bundle: the place in the file and what is wrong there. */
  static String reason(JsonProcessingException e) {
    String where = e instanceof JsonMappingException mapping ? path(mapping) : "";
    String what;
    if (e instanceof UnrecognizedPropertyException unknown)
      what = "неизвестный ключ " + unknown.getPropertyName();
    else if (e instanceof InvalidTypeIdException kind)
      what = "неподдерживаемое преобразование " + (kind.getTypeId() == null ? "" : kind.getTypeId());
    else if (cause(e) != null) what = cause(e).getMessage();
    else if (e instanceof MismatchedInputException && e.getOriginalMessage().startsWith("Missing"))
      what = "нет обязательного ключа";
    else if (e instanceof MismatchedInputException) what = "значение другого типа";
    else what = "не JSON: " + e.getOriginalMessage();
    return "Ошибка комплекта справочников: " + (where.isEmpty() ? "" : where + ": ") + what + ".";
  }

  /** The message a record of the model gave for a broken fact, if one did. */
  private static IllegalArgumentException cause(Throwable e) {
    for (Throwable c = e.getCause(); c != null; c = c.getCause())
      if (c instanceof IllegalArgumentException argument && argument.getMessage() != null)
        return argument;
    return null;
  }

  private static String path(JsonMappingException e) {
    var out = new StringBuilder();
    var references = new java.util.ArrayList<>(e.getPath());
    // The unknown key itself is named after the place.
    if (e instanceof UnrecognizedPropertyException unknown
        && !references.isEmpty()
        && unknown.getPropertyName().equals(references.get(references.size() - 1).getFieldName()))
      references.remove(references.size() - 1);
    for (var reference : references) {
      if (reference.getFieldName() != null) {
        if (out.length() > 0) out.append('.');
        out.append(reference.getFieldName());
      } else if (reference.getIndex() >= 0) out.append('[').append(reference.getIndex()).append(']');
    }
    return out.toString();
  }
}
