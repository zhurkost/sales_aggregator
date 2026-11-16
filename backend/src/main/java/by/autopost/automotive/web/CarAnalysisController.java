package by.autopost.automotive.web;
import by.autopost.Access;
import by.autopost.automotive.ai.CarAiService;
import by.autopost.automotive.ai.CarPhotoRecognitionService;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.web.bind.annotation.*;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
@RestController
@RequestMapping("/api/workspace/categories/cars_used_sale")
class CarAnalysisController {
  private final Access access;private final CarAiService service;private final CarPhotoRecognitionService photos;
  CarAnalysisController(Access access,CarAiService service,CarPhotoRecognitionService photos){this.access=access;this.service=service;this.photos=photos;}
  @PostMapping("/analyze") ObjectNode analyze(HttpServletRequest r,@RequestBody JsonNode input){var actor=access.require(r);return service.analyze(actor.id(),input);}
  @PostMapping("/recognize-photos") ObjectNode photos(HttpServletRequest r,@RequestBody JsonNode input){var actor=access.require(r);return photos.recognize(actor.id(),input);}
}
