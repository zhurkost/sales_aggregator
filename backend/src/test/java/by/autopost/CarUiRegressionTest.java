package by.autopost;

import static by.autopost.shared.Json.*;
import static org.junit.jupiter.api.Assertions.*;
import by.autopost.ai.AiGateway;
import by.autopost.automotive.ai.CarAiService;
import by.autopost.automotive.application.*;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.util.List;
import org.junit.jupiter.api.Test;

/** Reproductions from the real UI session of 2026-11-16. */
class CarUiRegressionTest {
  final CarCatalogService catalog=new CarCatalogService(()->CarCatalogTest.DATA);
  ObjectNode analyze(ObjectNode response,String text){
    AiGateway gateway=new AiGateway(){public String model(){return "fixture";}public ObjectNode serverJson(String i,String p,String s){return response;}};
    return new CarAiService(catalog,gateway).analyze("test",object("description",text));
  }
  String option(String field,String parent,String name){return list(catalog.options(field,parent,name,0).path("items")).stream().filter(n->text(n,"name").equals(name)).findFirst().orElseThrow().path("id").asText();}
  @Test void cityWithoutRegionRecoversOnlyAUniqueParent(){
    var result=analyze(object("values",object(),"location",object("city","Брест"),"evidence",object("car.city","Брест")),"Автомобиль в Бресте");
    String region=option("car.region","","Брестская область"),city=option("car.city",region,"Брест");
    assertEquals(city,result.path("values").path("car.region").asText());
    var ambiguous=analyze(object("values",object(),"location",object("city","Октябрьский"),"evidence",object("car.city","Октябрьский")),"Октябрьский");
    assertFalse(ambiguous.path("values").has("car.region"));
  }
  @Test void generationAcceptsRestylingCodeLciAndOrdinalWording(){
    for(var sample:List.of(List.of("BMW","7 серия","G12 рестайлинг","G12 (Long) Рестайлинг"),List.of("BMW","7 серия","BMW 7 серия, VI (G11/G12) LCI","VI Рестайлинг"),List.of("Toyota","RAV4","V поколение","V (XA50)"))){
      var response=object("values",object(),"vehicle",object("brand",sample.get(0),"model",sample.get(1),"generation",sample.get(2)),"evidence",object("car.brand",sample.get(0),"car.model",sample.get(1),"car.generation",sample.get(2)));
      String model=option("car.model",option("car.brand","",sample.get(0)),sample.get(1));
      assertEquals(option("car.generation",model,sample.get(3)),analyze(response,String.join(" ",sample)).path("values").path("car.brand").asText(),sample.get(2));
    }
  }
  @Test void quotedOwnerFactNarrowsPhotoCandidates(){
    var response=object("values",object("car.year",2019),"evidence",object("car.year","2019 года"),"candidates",object("car.year",List.of("2019","2020")),"candidateEvidence",object("car.year","Годы выпуска поколения"));
    var result=analyze(response,"BMW 2019 года");
    assertEquals(2019,result.path("values").path("car.year").asInt());
    assertEquals(array(List.of("2019")),result.path("candidates").path("car.year"));
  }
  @Test void generatedCopyWithoutQuoteIsNotDiscardedButTechnicalFactsStillNeedEvidence(){
    var result=analyze(object("values",object("car.description","Продаю Kia Rio. Есть сервисная книжка.","car.price",35000),"evidence",object()),"Kia Rio 2021, 1.6. Есть сервисная книжка.");
    assertEquals("Продаю Kia Rio. Есть сервисная книжка.",result.path("values").path("car.description").asText());
    assertFalse(result.path("values").has("car.price"));assertFalse(result.path("evidence").path("car.description").asText().isBlank());
  }
  @Test void sellingCopyCannotInventGoodCondition(){
    var response=object("values",object("car.description","Продаю Kia Rio. Серебристый седан в хорошем состоянии. Есть сервисная книжка."),"evidence",object());
    assertEquals("Продаю Kia Rio. Есть сервисная книжка.",analyze(response,"Kia Rio. Есть сервисная книжка.").path("values").path("car.description").asText());
    assertEquals(response.path("values").path("car.description"),analyze(response,"Kia Rio в хорошем состоянии. Есть сервисная книжка.").path("values").path("car.description"));
  }
  @Test void minskUsesKufarCityRegionWithoutInventingDistrict(){
    String city=option("car.city",option("car.region","","Минская область"),"Минск");
    JsonNode result=new CarPreparationService(catalog).prepare(object("values",object("car.region",city),"platforms",List.of("kufar"))).path("platforms").get(0);
    assertEquals("7",result.path("values").path("kufar.region").path("value").asText());
    assertFalse(result.path("values").has("kufar.area"));
    assertTrue(result.path("issues").toString().contains("район"));
  }
  @Test void sellerNameHasAnOnlinerBindingAndPrivateSellerPrerequisite(){
    var job=new CarPreparationService(catalog).configuration(object("id","seller-name","revision",1,"card",object("values",object("car.seller_name","Илья"),"platforms",List.of("onliner")))).path("jobs").get(0);
    JsonNode name=list(job.path("controls")).stream().filter(c->text(c,"field").equals("onliner.sellerName")).findFirst().orElseThrow();
    assertEquals("Илья",text(name,"value"));assertTrue(name.path("binding").path("depends_on").toString().contains("onliner.sellerType"));
    assertTrue(list(job.path("controls")).stream().anyMatch(c->text(c,"field").equals("onliner.sellerType")&&text(c,"name").equals("частное лицо")));
  }
}
