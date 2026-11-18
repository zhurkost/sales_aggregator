package by.autopost.automotive.ai;
import static by.autopost.shared.Json.*;
import com.fasterxml.jackson.databind.*;
import com.fasterxml.jackson.databind.node.*;
import java.util.*;

/** Request-local short codes keep UUIDs and the full taxonomy out of model prompts. */
public final class CarPromptOptions {
  private final Map<String,String> ids=new LinkedHashMap<>();private final Set<String> enumFields=new HashSet<>();
  public ArrayNode compact(ArrayNode fields){
    ArrayNode result=array();
    for(JsonNode f:fields){
      ObjectNode item=object("id",text(f,"id"),"name",text(f,"name"));
      if(f.has("type"))item.set("type",f.path("type"));
      for(String bound:List.of("min","max"))if(f.has(bound))item.set(bound,f.path(bound));
      if(f.has("options")){
        enumFields.add(text(f,"id"));ArrayNode options=array();
        for(JsonNode o:f.path("options")){
          String code=text(f,"id").replaceFirst("^car\\.","")+":"+text(o,"name");ids.put(code,text(o,"id"));
          options.add(array(List.of(code,text(o,"name"))));
        }item.set("options",options);
      }result.add(item);
    }return result;
  }
  public ObjectNode decode(JsonNode reply){
    ObjectNode result=reply.isObject()?reply.deepCopy():object();
    if(result.path("values").isObject())for(String field:enumFields)if(result.path("values").has(field))
      {
        JsonNode value=result.path("values").path(field);
        if(value.isArray()){ArrayNode decoded=array();value.forEach(v->decoded.add(resolve(v.asText())));((ObjectNode)result.path("values")).set(field,decoded);}
        else ((ObjectNode)result.path("values")).put(field,resolve(value.asText()));
      }
    if(result.path("candidates").isObject())result.path("candidates").fields().forEachRemaining(e->{
      if(e.getValue().isArray()){ArrayNode decoded=array();e.getValue().forEach(v->decoded.add(e.getKey().equals("car.year")?v.asText():resolve(v.asText())));((ObjectNode)result.path("candidates")).set(e.getKey(),decoded);}
    });
    return result;
  }
  /** Translate previously validated photo constraints into this request's vocabulary. */
  public ObjectNode encodeCandidates(JsonNode photo){
    ObjectNode result=object();
    photo.path("candidates").fields().forEachRemaining(e->{
      if(e.getKey().equals("car.year")){result.set(e.getKey(),e.getValue());return;}
      ArrayNode codes=array();for(JsonNode id:e.getValue())ids.forEach((code,common)->{if(common.equals(id.asText()))codes.add(code);});
      if(!codes.isEmpty())result.set(e.getKey(),codes);
    });
    return object("candidates",result,"candidateEvidence",photo.path("candidateEvidence"));
  }
  private String resolve(String code){return ids.getOrDefault(code,"invalid-choice:"+code);}
  public static final String FORMAT="\nВ options пары [короткий код, название]. В facts[].value и candidates для этих полей возвращай только короткие коды, не UUID и не названия.\n";
}
