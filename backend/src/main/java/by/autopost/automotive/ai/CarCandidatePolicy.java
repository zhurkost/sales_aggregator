package by.autopost.automotive.ai;
import static by.autopost.shared.Json.*;
import by.autopost.automotive.application.CarCatalogService;
import com.fasterxml.jackson.databind.*;
import com.fasterxml.jackson.databind.node.*;
import java.util.*;

/** Only technical flat choices can restrict dropdowns; an invalid set is rejected as a whole. */
public final class CarCandidatePolicy {
  private static final Set<String> FIELDS=Set.of("car.year","car.body","car.engine","car.drive","car.transmission","car.color","car.seats","car.interior_material","car.interior_color");
  private final CarCatalogService catalog;
  public CarCandidatePolicy(CarCatalogService catalog){this.catalog=catalog;}
  public ArrayNode fields(){
    ArrayNode result=array();
    for(JsonNode f:catalog.data().path("fields"))if(FIELDS.contains(text(f,"id"))){
      if(text(f,"id").equals("car.year")){result.add(object("id","car.year","name",text(f,"name"),"type","integer","min",CarCatalogService.MIN_YEAR,"max",CarCatalogService.maxYear()));continue;}
      ArrayNode options=array();catalog.data().path("nodes").forEach(n->{if(text(n,"field").equals(text(f,"id")))options.add(object("id",text(n,"id"),"name",text(n,"name"),"aliases",n.path("aliases")));});
      result.add(object("id",text(f,"id"),"name",text(f,"name"),"options",options));
    }return result;
  }
  public ObjectNode validate(JsonNode reply,ArrayNode warnings){
    ObjectNode choices=object(),evidence=object();
    if(reply.path("candidates").isObject())reply.path("candidates").fields().forEachRemaining(e->{
      String field=e.getKey(),why=clean(reply.path("candidateEvidence"),field,1500);
      if(!FIELDS.contains(field)||!e.getValue().isArray()||e.getValue().isEmpty())return;
      if(why.isBlank()){warnings.add("ИИ не указал основание ограничения для поля «"+text(catalog.field(field),"name")+"».");return;}
      LinkedHashSet<String> ids=new LinkedHashSet<>();
      for(JsonNode id:e.getValue()){
        if(field.equals("car.year")){
          String year=id.asText();if(!year.matches("[0-9]{4}")||Integer.parseInt(year)<CarCatalogService.MIN_YEAR||Integer.parseInt(year)>CarCatalogService.maxYear()){warnings.add("Не применён список вариантов ИИ: год выпуска");return;}
          ids.add(year);continue;
        }
        JsonNode n=catalog.node(id.asText());
        if(!id.isTextual()||!text(n,"field").equals(field)||!text(n,"parentId").isBlank()){
          warnings.add("Не применён список вариантов ИИ: "+text(catalog.field(field),"name"));return;
        }ids.add(text(n,"id"));
      }
      choices.set(field,array(ids));evidence.put(field,why);
    });
    return object("candidates",choices,"candidateEvidence",evidence);
  }
  public static final String RULES="""
    Если техническую характеристику нельзя определить однозначно, не выбирай одну наугад.
    Верни candidates:{fieldId:[короткийКод,...]} и candidateEvidence:{fieldId:основание списка}.
    Разрешены только предложенные коды плоских технических полей; не фильтруй валюту, географию и дерево автомобиля.
    Для car.year возвращай годы обычными числами, без кодов. Ограничивай год полным обоснованным набором
    годов выпуска распознанного поколения или рестайлинга в заданном диапазоне min..max.
    По внешнему виду не выбирай один год из нескольких: перечисли все подходящие годы.
    Явно указанный пользователем год приоритетнее диапазона из фотографий.
    Включай все обоснованные варианты для всех возможных распознанных версий автомобиля, а не только самый вероятный.
    Если набор возможных значений неизвестен или не уверен в полноте списка — пропусти ограничение этого поля.
    Возможные значения не являются подтверждённой комплектацией конкретной машины.
    Для неоднозначного поля не возвращай одиночное значение в facts. Не выводи мощность, пробег, VIN, цену по внешности.
    """;
}
