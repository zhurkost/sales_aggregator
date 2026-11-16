package by.autopost.automotive.application;
import static by.autopost.shared.Json.*;
import by.autopost.shared.ApiException;
import com.fasterxml.jackson.databind.*;
import com.fasterxml.jackson.databind.node.*;
import java.util.*;
import org.springframework.stereotype.Service;

/** Mapping and validation live on the server; the extension receives resolved site values. */
@Service
public class CarPreparationService {
  private final CarCatalogService catalog;
  public CarPreparationService(CarCatalogService catalog){this.catalog=catalog;}
  public ObjectNode prepare(JsonNode card){
    ObjectNode values=catalog.validateValues(card.path("values"));ArrayNode platforms=array(),issues=array();
    List<String> chosen=list(card.path("platforms")).stream().map(JsonNode::asText).distinct().toList();
    if(chosen.isEmpty()||chosen.size()>4)throw new ApiException(400,"Выберите площадки.");
    for(String p:chosen){
      JsonNode mapping=catalog.data().path("mappings").path(p);if(mapping.isMissingNode())throw new ApiException(400,"Неизвестная площадка.");
      ObjectNode target=object();ArrayNode pending=array();
      values.fields().forEachRemaining(e->{
        JsonNode f=catalog.field(e.getKey());
        if(text(f,"type").equals("enum")){
          // A merged model can occupy several native branches. Resolve the complete native
          // path of the selected descendant before falling back to individual node mappings.
          JsonNode nativePath=mapping.path("paths").path(e.getValue().asText());
          if(nativePath.isArray()&&!nativePath.isEmpty()){
            for(JsonNode mapped:nativePath)target.set(text(mapped,"field"),object("value",mapped.get("value"),"name",text(mapped,"name"),"sourceId",text(mapped,"id")));
            return;
          }
          for(JsonNode n:catalog.path(e.getValue().asText())){
            JsonNode mapped=mapping.path("nodes").path(text(n,"id"));String sourceField=mapping.path("fields").path(text(n,"field")).asText("");
            if(mapped.isMissingNode()||sourceField.isBlank()){pending.add(text(f,"name")+": "+text(n,"name")+" — нет подтверждённого соответствия");break;}
            target.set(sourceField,object("value",mapped.get("value"),"name",text(mapped,"name"),"sourceId",text(mapped,"id")));
            for(JsonNode assignment:list(mapped.path("assignments")))target.set(text(assignment,"field"),object("value",assignment.get("value"),"name",text(assignment,"name"),"sourceId",text(assignment,"id")));
          }
        }else{
          String sf=mapping.path("fields").path(e.getKey()).asText("");
          if(!sf.isBlank()){
            if(e.getKey().equals("car.engine_capacity")&&p.equals("av")){
              try{int capacity=e.getValue().decimalValue().multiply(java.math.BigDecimal.valueOf(1000)).intValueExact();target.set(sf,object("value",capacity,"name",Integer.toString(capacity)));}
              catch(ArithmeticException invalid){pending.add("Объём двигателя: значение нельзя точно перевести в см³ для AV.by");}
            }else if(e.getKey().equals("car.engine_capacity")&&p.equals("kufar")){
              JsonNode option=list(catalog.data().path("sourceFields").path(sf).path("options")).stream().filter(o->{try{return new java.math.BigDecimal(text(o,"name").replace(" л","").replace(',','.')).compareTo(e.getValue().decimalValue())==0;}catch(NumberFormatException invalid){return false;}}).findFirst().orElse(null);
              if(option!=null)target.set(sf,object("value",option.get("value"),"name",text(option,"name")));else pending.add("Объём двигателя: нет точного варианта Kufar");
            }else target.set(sf,object("value",e.getValue(),"name",e.getValue().asText()));
          }
        }
      });
      // Additional site-only fields use source choice IDs, not arbitrary native values.
      JsonNode extras=card.path("extras").path(p);
      if(extras.isObject())extras.fields().forEachRemaining(e->{
        if(!has(mapping.path("extras"),e.getKey()))throw new ApiException(400,"Неизвестное дополнительное поле.");
        JsonNode sf=catalog.data().path("sourceFields").path(e.getKey()),v=e.getValue();String type=text(sf,"type");
        if(v.isNull()||v.asText().isBlank()&&!v.isBoolean()&&!v.isArray())return;
        if(type.equals("enum")||type.equals("multi_enum")){
          ArrayNode selected=array();for(JsonNode key:type.equals("enum")?List.of(v):list(v)){
            JsonNode option=list(sf.path("options")).stream().filter(o->text(o,"id").equals(key.asText())).findFirst().orElseThrow(()->new ApiException(400,"Неизвестный вариант дополнительного поля."));
            selected.add(object("value",option.get("value"),"name",text(option,"name")));
          }
          if(type.equals("enum"))target.set(e.getKey(),selected.get(0));else target.set(e.getKey(),object("value",selected,"name",text(sf,"name")));
        }else{
          if(type.equals("boolean")&&!v.isBoolean()||Set.of("integer","number").contains(type)&&!v.isNumber()||type.equals("text")&&!v.isTextual())throw new ApiException(400,"Неверный тип дополнительного поля.");
          target.set(e.getKey(),object("value",v,"name",v.asText()));
        }
      });
      // Explicit scope and units, never inferred from a photograph.
      if(p.equals("kufar"))target.set("kufar.condition",object("value","1","name","С пробегом"));
      if(p.equals("kufar")&&values.has("car.price"))target.set("kufar.price_mode",object("value","common","name","Цена"));
      if(p.equals("onliner")&&values.has("car.region"))target.set("onliner.country",object("value",mapping.path("context").get("value"),"name","Беларусь"));
      if(values.has("car.phone")){
        String phone=values.path("car.phone").asText().replaceAll("[\\s()\\-]","");
        if(p.equals("onliner"))target.set("onliner.phone",object("value",phone,"name",phone));
        if(p.equals("av")){
          // The common phone is international; AV has separate country and national inputs.
          if(phone.matches("\\+375\\d{9}")){
            target.set("av.phone_country",object("value",1,"name","🇧🇾 +375"));
            target.set("av.phone_number",object("value",phone.substring(4),"name",phone.substring(4)));
          }else{target.remove("av.phone_number");pending.add("Телефон AV.by: укажите номер вручную или используйте формат +375XXXXXXXXX.");}
        }
      }
      if(values.has("car.price")&&!target.has(mapping.path("fields").path("car.currency").asText())){
        pending.add("Цена не переносится без подтверждённого соответствия валюты.");target.remove(mapping.path("fields").path("car.price").asText());
      }
      // A known unit is selected explicitly; a default miles selector must not reinterpret kilometres.
      if(values.has("car.mileage")&&Set.of("onliner","av").contains(p)){
        String unit=p.equals("av")?"av.mileage_unit":"onliner.odometerUnit";
        JsonNode option=list(catalog.data().path("sourceFields").path(unit).path("options")).stream().filter(o->CarCatalogService.normalize(text(o,"name")).equals("км")).findFirst().orElse(null);
        if(option!=null)target.set(unit,object("value",option.get("value"),"name",text(option,"name")));
        else {pending.add("Проверьте единицу пробега: километры.");target.remove(mapping.path("fields").path("car.mileage").asText());}
      }
      List<String> remove=new ArrayList<>();
      do{remove.clear();target.fields().forEachRemaining(e->{JsonNode sf=catalog.data().path("sourceFields").path(e.getKey());((ObjectNode)e.getValue()).put("label",text(sf,"name"));
        if(sf.has("when")&&!applicable(sf.path("when"),target)){remove.add(e.getKey());pending.add(text(sf,"name")+": не подтверждены условия доступности поля");}
      });target.remove(remove);}while(!remove.isEmpty());
      JsonNode platform=list(catalog.data().path("platforms")).stream().filter(x->text(x,"id").equals(p)).findFirst().orElseThrow();
      platforms.add(object("platform",p,"name",text(platform,"name"),"startUrl",text(platform,"url"),"values",target,"issues",pending));
    }
    if(!values.has("car.brand"))issues.add("Укажите марку автомобиля.");
    if(!values.has("car.price"))issues.add("Укажите цену.");
    if(!values.has("car.currency"))issues.add("Укажите валюту.");
    return object("values",values,"platforms",platforms,"issues",issues);
  }
  private boolean applicable(JsonNode rule,JsonNode values){
    if(rule.has("all"))return list(rule.path("all")).stream().allMatch(r->applicable(r,values));
    if(rule.has("any"))return list(rule.path("any")).stream().anyMatch(r->applicable(r,values));
    JsonNode selected=values.path(text(rule,"option_id")).path("value");
    if(selected.isMissingNode()||selected.isNull())return false;
    return switch(text(rule,"operator")){case "exists"->true;case "equals"->selected.equals(rule.path("value"));case "not_equals"->!selected.equals(rule.path("value"));default->false;};
  }
  public ObjectNode configuration(JsonNode input){
    String id=text(input,"id");int revision=input.path("revision").asInt();
    if(!id.matches("[a-zA-Z0-9_.:-]{1,120}")||revision<1)throw new ApiException(400,"Неверный запуск карточки.");
    ObjectNode prepared=prepare(input.path("card"));ArrayNode jobs=array();
    for(JsonNode p:prepared.path("platforms")){
      ArrayNode controls=array();p.path("values").fields().forEachRemaining(e->{
        JsonNode field=catalog.data().path("sourceFields").path(e.getKey());
        ObjectNode binding=list(catalog.data().path("bindings").path(text(p,"platform"))).stream().filter(b->text(b,"option_id").equals(e.getKey())).findFirst().orElse(object()).deepCopy();
        JsonNode mapped=catalog.data().path("mappings").path(text(p,"platform")).path("fields");
        String prerequisite=e.getKey().equals(mapped.path("car.price").asText())?mapped.path("car.currency").asText():e.getKey().equals(mapped.path("car.mileage").asText())?switch(text(p,"platform")){case "av"->"av.mileage_unit";case "onliner"->"onliner.odometerUnit";default->"";}:"";
        if(!prerequisite.isBlank()){ArrayNode deps=binding.withArray("depends_on");if(!has(deps,prerequisite))deps.add(prerequisite);}
        controls.add(object("field",e.getKey(),"label",text(field,"name"),"fieldType",text(field,"type"),"selector","body","action","text","value",e.getValue().path("value"),"name",e.getValue().path("name"),"binding",binding));
      });
      String photoField=catalog.data().path("mappings").path(text(p,"platform")).path("fields").path("car.photos").asText();
      if(text(p,"platform").equals("abw")&&prepared.path("values").has("car.engine_capacity")){
        String gearbox=switch(CarCatalogService.normalize(text(p.path("values").path("abw.transmission"),"name"))){
          case "механика"->"MT";case "автомат"->"AT";case "вариатор"->"CVT";case "робот"->"AMT";default->"";
        };
        if(!gearbox.isBlank()){
          String selection=prepared.path("values").path("car.engine_capacity").decimalValue().stripTrailingZeros().toPlainString()+" "+gearbox;
          // ABW exposes modifications only for the selected car. Match the live choices,
          // without adding model-specific modifications to the shared catalog.
          controls.add(object("field","abw.modification","label","Модификация","fieldType","enum","selector","body","action","text","value",selection,"name",selection,
            "binding",object("action","choose","match","engine_transmission","depends_on",List.of("abw.brand","abw.model","abw.year","abw.generation","abw.body","abw.engine","abw.gear","abw.transmission"),
              "target",object("label","Модификация","labels",".item-title","container",".adverts-form-item","selector",".item-header"),
              "suggestions",object("selector",".list_modification .card_modification"),"expandSelector",".card_more-modification",
              "verify",object("kind","selected_text_equals","within_target",".item-selected"))));
        }
      }
      JsonNode photoBinding=list(catalog.data().path("bindings").path(text(p,"platform"))).stream().filter(b->text(b,"option_id").equals(photoField)).findFirst().orElse(object());
      jobs.add(object("platform",text(p,"platform"),"startUrl",text(p,"startUrl"),"format",1,"contract","cars-v1","controls",controls,"photoBinding",photoBinding,"ready",List.of(object("selector","body")),"setup",array(),"next",array(),"submit",array(),"issues",p.path("issues")));
    }
    return object("id",id,"revision",revision,"categoryId","cars_used_sale","jobs",jobs);
  }
}
