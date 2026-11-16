package by.autopost.automotive.application;
import static by.autopost.shared.Json.*;
import by.autopost.shared.ApiException;
import com.fasterxml.jackson.databind.*;
import com.fasterxml.jackson.databind.node.*;
import java.util.*;
import org.springframework.stereotype.Service;

@Service
public class CarCatalogService {
  public static final int MIN_YEAR=1886;
  public static int maxYear(){return java.time.Year.now().getValue();}
  private final CarReference reference;
  public CarCatalogService(CarReference reference){this.reference=reference;}
  public JsonNode data(){return reference.data();}
  public ObjectNode editor(){ArrayNode fields=data().path("fields").deepCopy();for(JsonNode f:fields)if(text(f,"id").equals("car.year"))((ObjectNode)f).put("control","select");return object("categoryId","cars_used_sale","fields",fields,"extras",data().path("extras"),"platforms",data().path("platforms"));}
  public JsonNode node(String id){return data().path("nodes").path(data().path("identityAliases").path(id).asText(id));}
  /** Only generations with an approved native counterpart on every platform are offered. */
  public boolean selectable(JsonNode node){
    if(node.isMissingNode())return false;
    if(!text(node,"field").equals("car.generation"))return true;
    String id=text(node,"id");
    return !data().path("platforms").isEmpty()&&list(data().path("platforms")).stream().allMatch(p->
      data().path("mappings").path(text(p,"id")).path("nodes").has(id));
  }
  public List<JsonNode> selection(String id){
    if(!selectable(node(id)))throw new ApiException(400,"Выберите поколение с соответствием на всех площадках.");
    return path(id);
  }
  public JsonNode field(String id){return list(data().path("fields")).stream().filter(f->text(f,"id").equals(id)).findFirst().orElse(null);}
  public List<JsonNode> path(String id){
    List<JsonNode> result=new ArrayList<>();Set<String> visited=new HashSet<>();
    while(!id.isBlank()){
      JsonNode n=node(id);if(n.isMissingNode()||!visited.add(id))throw new ApiException(400,"Неизвестный вариант справочника.");
      result.add(0,n);id=text(n,"parentId");
    }return result;
  }
  public ObjectNode options(String fieldId,String parent,String query,int offset){
    if(fieldId.equals("car.year")){
      if(!parent.isBlank())throw new ApiException(400,"У года выпуска нет родителя.");
      List<JsonNode> found=new ArrayList<>();String q=normalize(query);
      for(int year=maxYear();year>=MIN_YEAR;year--)if(String.valueOf(year).contains(q))found.add(object("id",String.valueOf(year),"name",String.valueOf(year),"field",fieldId));
      int start=Math.min(Math.max(offset,0),found.size());return object("items",found.subList(start,Math.min(start+200,found.size())),"total",found.size(),"offset",start);
    }
    JsonNode field=field(fieldId);if(field==null||!text(field,"type").equals("enum"))throw new ApiException(400,"Неизвестное поле.");
    String expected=text(field,"parent_option_id");
    if(!expected.isBlank()&&!text(node(parent),"field").equals(expected))throw new ApiException(400,"Сначала выберите родителя.");
    if(expected.isBlank()&&!parent.isBlank())throw new ApiException(400,"У корневого поля нет родителя.");
    String parentId=parent.isBlank()?"":text(node(parent),"id"),q=normalize(query);List<JsonNode> found=new ArrayList<>();
    data().path("nodes").forEach(n->{if(text(n,"field").equals(fieldId)&&text(n,"parentId").equals(parentId)&&selectable(n)&&(q.isBlank()||normalize(text(n,"name")).contains(q)||list(n.path("aliases")).stream().anyMatch(a->normalize(a.asText()).contains(q))))found.add(n);});
    found.sort(Comparator.comparing(n->normalize(text(n,"name"))));int start=Math.min(Math.max(offset,0),found.size());
    return object("items",found.subList(start,Math.min(start+200,found.size())),"total",found.size(),"offset",start);
  }
  public static String normalize(String s){return s.trim().toLowerCase(Locale.ROOT).replace('ё','е').replaceAll("\\s+"," ");}
  /** Store one selected node per tree root. Ancestors are derived, never guessed. */
  public ObjectNode validateValues(JsonNode input){
    if(!input.isObject()||input.toString().length()>100000)throw new ApiException(400,"Некорректная карточка.");
    ObjectNode result=object();
    input.fields().forEachRemaining(e->{
      JsonNode f=field(e.getKey());if(f==null||f.has("parent_option_id"))throw new ApiException(400,"Неизвестное поле карточки: "+e.getKey());
      JsonNode v=e.getValue();if(v.isNull()||v.isTextual()&&v.asText().isBlank())return;
      String type=text(f,"type");
      if(type.equals("enum")){
        if(!v.isTextual()||!text(node(v.asText()),"root").equals(e.getKey()))throw new ApiException(400,"Вариант не принадлежит полю «"+text(f,"name")+"».");
        selection(v.asText());
      } else if(type.equals("integer")||type.equals("number")){
        if(!v.isNumber()||!Double.isFinite(v.asDouble())||v.asDouble()<0||type.equals("integer")&&!v.isIntegralNumber())throw new ApiException(400,"Проверьте поле «"+text(f,"name")+"».");
        if(e.getKey().equals("car.year")&&(v.asInt()<MIN_YEAR||v.asInt()>maxYear()))throw new ApiException(400,"Проверьте год выпуска.");
      } else if(type.equals("text")){
        if(!v.isTextual()||v.asText().length()>15000)throw new ApiException(400,"Слишком длинный текст.");
      } else throw new ApiException(400,"Файлы передаются отдельно.");
      if(type.equals("enum"))result.put(e.getKey(),text(node(v.asText()),"id"));else result.set(e.getKey(),v.deepCopy());
    });return result;
  }
}
