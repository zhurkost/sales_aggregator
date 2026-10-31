package by.autopost;

import static by.autopost.Json.*;

import com.fasterxml.jackson.databind.node.ObjectNode;
import org.springframework.http.ResponseEntity;
import org.springframework.http.converter.HttpMessageNotReadableException;
import org.springframework.web.bind.annotation.*;

@RestControllerAdvice
class ApiErrors {
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
