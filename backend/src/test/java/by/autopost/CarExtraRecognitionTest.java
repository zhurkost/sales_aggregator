package by.autopost;

import static org.junit.jupiter.api.Assertions.*;
import static by.autopost.shared.Json.*;
import by.autopost.ai.AiGateway;
import by.autopost.automotive.ai.CarAiService;
import by.autopost.automotive.application.*;
import by.autopost.shared.ApiException;
import com.fasterxml.jackson.databind.*;
import com.fasterxml.jackson.databind.node.*;
import java.util.*;
import org.junit.jupiter.api.Test;

class CarExtraRecognitionTest {
  final CarCatalogService catalog=new CarCatalogService(()->CarCatalogTest.DATA);
  ObjectNode analyze(String source,List<ObjectNode> facts){
    int[] calls={0};
    AiGateway gateway=new AiGateway(){public String model(){return "test";}public ObjectNode serverJson(String i,String prompt,String s){
      calls[0]++;for(String id:List.of("av.options","kufar.cars_aux","onliner.bluetooth","abw.availability"))assertTrue(prompt.contains(id));
      assertFalse(prompt.contains("\"id\":\"av.condition_promotion\""));assertFalse(prompt.contains("\"id\":\"onliner.state\""));
      assertTrue(prompt.contains("Отсутствие упоминания не false"));return object("facts",facts);
    }};
    ObjectNode result=new CarAiService(catalog,gateway).analyze("test",object("description",source));assertEquals(1,calls[0]);return result;
  }
  ObjectNode fact(String field,Object value,String quote){return object("field",field,"value",value,"evidence",quote);}
  @Test void equipmentTradeAndOtherExtrasSurviveRecognitionAndNativeRecipesForAllSites(){
    String source="Есть ABS, Bluetooth и USB, кондиционер, подогрев передних сидений. Обмен не интересует, торг уместен. Мощность 123 л.с. Автомобиль в наличии. Email seller@example.com.";
    var result=analyze(source,List.of(
      fact("kufar.cars_aux",true,"Bluetooth и USB"),fact("kufar.cars_climate",true,"кондиционер"),fact("kufar.possible_exchange",false,"Обмен не интересует"),fact("kufar.auction","kufar.auction:Торг уместен","торг уместен"),
      fact("onliner.bluetooth",true,"Bluetooth"),fact("onliner.usb",true,"USB"),fact("onliner.exchange",false,"Обмен не интересует"),fact("onliner.heatedSeats",List.of("onliner.heatedSeats:Подогрев передних сидений"),"подогрев передних сидений"),fact("onliner.power",123,"123 л.с."),fact("onliner.powerUnit","onliner.powerUnit:л.с.","123 л.с."),
      fact("av.options",List.of("av.options:ABS","av.options:Bluetooth","av.options:USB","av.options:USB"),"Есть ABS, Bluetooth и USB"),fact("av.exchange_options","av.exchange_options:не интересует","Обмен не интересует"),
      fact("abw.availability","abw.availability:в наличии","в наличии"),fact("abw.email","seller@example.com","seller@example.com")
    ));
    assertTrue(result.path("warnings").isEmpty(),result.toString());assertEquals(4,result.path("extras").size());
    assertFalse(result.path("extras").path("kufar").path("kufar.possible_exchange").asBoolean(true));
    assertEquals(3,result.path("extras").path("av").path("av.options").size());assertFalse(result.path("values").has("av.options"));
    assertEquals("Есть ABS, Bluetooth и USB",result.path("evidence").path("av.options").asText());
    var jobs=new CarPreparationService(catalog).configuration(object("id","extras","revision",1,"card",object("values",result.path("values"),"extras",result.path("extras"),"platforms",List.of("kufar","onliner","av","abw")))).path("jobs");
    Map<String,JsonNode> controls=new HashMap<>();for(JsonNode job:jobs)for(JsonNode c:job.path("controls"))controls.put(text(c,"field"),c);
    assertFalse(controls.get("kufar.possible_exchange").path("value").asBoolean(true));assertEquals("2",text(controls.get("kufar.auction"),"value"));
    assertEquals("front",controls.get("onliner.heatedSeats").path("value").get(0).path("value").asText());assertEquals(123,controls.get("onliner.power").path("value").asInt());assertEquals("horse",text(controls.get("onliner.powerUnit"),"value"));
    assertEquals(List.of(1,29,31),list(controls.get("av.options").path("value")).stream().map(o->o.path("value").asInt()).toList());assertEquals(1,controls.get("av.exchange_options").path("value").asInt());
    assertEquals(173083,controls.get("abw.availability").path("value").asInt());assertEquals("seller@example.com",text(controls.get("abw.email"),"value"));
  }
  @Test void rejectsWrongTypesUnknownChoicesAndMissingEvidenceWithoutLosingValidFields(){
    String source="Есть Bluetooth. Обмен не интересует.";
    var result=analyze(source,List.of(fact("onliner.bluetooth",true,"Bluetooth"),
      fact("kufar.possible_exchange","false","Обмен не интересует"),fact("av.options","av.options:ABS","Bluetooth"),
      fact("onliner.heatedSeats",List.of("av.options:USB"),"Bluetooth"),fact("abw.email","invented@example.com","не существующая цитата"),
      fact("onliner.power",123,""),fact("av.condition_promotion","av.condition_promotion:новый","Bluetooth"),fact("abw.fake",true,"Bluetooth")
    ));
    assertEquals(1,result.path("extras").size());assertEquals(1,result.path("extras").path("onliner").size());assertTrue(result.path("extras").path("onliner").path("onliner.bluetooth").asBoolean());assertEquals(7,result.path("warnings").size());
    assertTrue(analyze("Продаю Kia Rio.",List.of()).path("extras").isEmpty());
  }
  @Test void everyEditableSupportedExtraIsInThePromptAndAcceptsItsOwnType(){
    AiGateway gateway=new AiGateway(){public String model(){return "test";}public ObjectNode serverJson(String i,String prompt,String s){
      try{
        JsonNode fields=MAPPER.readTree(prompt.substring(prompt.lastIndexOf("\nПоля: ")+"\nПоля: ".length()));ArrayNode facts=array();
        for(JsonNode f:fields){String id=text(f,"id");if(id.startsWith("car."))continue;
          Object value=switch(text(f,"type")){case "boolean"->false;case "number","integer"->100;case "text"->"Текст";case "enum"->f.path("options").get(0).get(0).asText();case "multi_enum"->List.of(f.path("options").get(0).get(0).asText());default->throw new AssertionError(id);};
          facts.add(fact(id,value,"Текст"));
        }assertTrue(facts.size()>100);return object("facts",facts);
      }catch(Exception e){throw new RuntimeException(e);}
    }};
    var result=new CarAiService(catalog,gateway).analyze("test",object("description","Текст"));assertTrue(result.path("warnings").isEmpty(),result.path("warnings").toString());
    int count=0;for(JsonNode platform:result.path("extras"))count+=platform.size();assertTrue(count>100);
  }
  @Test void preparationRejectsMalformedManualExtrasToo(){
    var service=new CarPreparationService(catalog);
    for(JsonNode extras:List.of(object("av",object("av.options","not-an-array")),object("onliner",object("onliner.bluetooth","true")),object("av",object("av.engine_endurance",1.5))))
      assertThrows(ApiException.class,()->service.prepare(object("values",object(),"platforms",List.of("av","onliner"),"extras",extras)));
  }
  @Test void powerWithoutConfirmedUnitsIsNotFilled(){
    var result=analyze("Мощность 123.",List.of(fact("onliner.power",123,"123")));
    assertTrue(result.path("extras").isEmpty());assertEquals(1,result.path("warnings").size());
  }
}
