package by.autopost;

import static by.autopost.shared.Json.*;

import by.autopost.shared.ApiException;
import com.fasterxml.jackson.databind.node.ObjectNode;
import org.springframework.http.ResponseEntity;
import org.springframework.http.converter.HttpMessageNotReadableException;
import org.springframework.web.bind.annotation.*;

@RestControllerAdvice
class ApiErrors {
  @ExceptionHandler(org.springframework.web.servlet.resource.NoResourceFoundException.class)
  ResponseEntity<ObjectNode> missing() {
    return ResponseEntity.status(404).body(object("error", "Раздел не найден."));
  }

  @ExceptionHandler(org.springframework.web.HttpRequestMethodNotSupportedException.class)
  ResponseEntity<ObjectNode> method() {
    return ResponseEntity.status(405).body(object("error", "Метод не поддерживается."));
  }

  @ExceptionHandler(ApiException.class)
  ResponseEntity<ObjectNode> api(ApiException e) {
    var body = object("error", e.getMessage());
    if (e.code != null) body.put("code", e.code);
    return ResponseEntity.status(e.status).body(body);
  }

  @ExceptionHandler(HttpMessageNotReadableException.class)
  ResponseEntity<ObjectNode> json() {
    return ResponseEntity.badRequest().body(object("error", "Некорректный JSON."));
  }

  @ExceptionHandler(Exception.class)
  ResponseEntity<ObjectNode> unexpected(Exception e) {
    org.slf4j.LoggerFactory.getLogger(ApiErrors.class)
        .error("API operation failed ({})", e.getClass().getSimpleName());
    return ResponseEntity.internalServerError()
        .body(object("error", "Не удалось обработать запрос. Попробуйте ещё раз."));
  }
}
