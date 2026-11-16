package by.autopost.automotive.web;
import by.autopost.Access;
import by.autopost.automotive.application.CarCatalogService;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.web.bind.annotation.*;
import com.fasterxml.jackson.databind.node.ObjectNode;
/** Authenticated editor metadata and paged dependent choices. */
@RestController
@RequestMapping("/api/workspace/categories/cars_used_sale")
class CarEditorController {
  private final Access access;private final CarCatalogService catalog;
  CarEditorController(Access access,CarCatalogService catalog){this.access=access;this.catalog=catalog;}
  @GetMapping("/editor") ObjectNode editor(HttpServletRequest r){access.require(r);return catalog.editor();}
  @GetMapping("/selection") ObjectNode selection(HttpServletRequest r,@RequestParam String node){access.require(r);return by.autopost.shared.Json.object("path",catalog.selection(node));}
  @GetMapping("/options") ObjectNode options(HttpServletRequest r,@RequestParam String field,@RequestParam(defaultValue="") String parent,@RequestParam(defaultValue="") String query,@RequestParam(defaultValue="0") int offset){access.require(r);return catalog.options(field,parent,query,offset);}
}
