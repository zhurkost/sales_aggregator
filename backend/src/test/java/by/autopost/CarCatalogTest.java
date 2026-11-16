package by.autopost;
import static org.junit.jupiter.api.Assertions.*;
import static by.autopost.shared.Json.*;
import by.autopost.automotive.application.*;
import by.autopost.automotive.ai.CarAiService;
import by.autopost.ai.AiGateway;
import by.autopost.shared.ApiException;
import com.fasterxml.jackson.databind.*;
import com.fasterxml.jackson.databind.node.*;
import java.nio.file.*;
import java.util.*;
import org.junit.jupiter.api.Test;

class CarCatalogTest {
  static final JsonNode DATA=read();
  static JsonNode read(){try{return MAPPER.readTree(Files.readString(Path.of("../data/automotive/cars_used_sale/runtime.json")));}catch(Exception e){throw new RuntimeException(e);}}
  final CarCatalogService catalog=new CarCatalogService(()->DATA);
  final CarPreparationService service=new CarPreparationService(catalog);
  String option(String field,String parent,String name){return list(catalog.options(field,parent,name,0).path("items")).stream().filter(o->text(o,"name").equalsIgnoreCase(name)).findFirst().orElseThrow().path("id").asText();}
  @Test void generationsRequireMappingsOnEveryPlatformAndHiddenIdsCannotBeSelected(){
    for(JsonNode n:DATA.path("nodes"))if(text(n,"field").equals("car.generation")){
      boolean complete=list(DATA.path("platforms")).stream().allMatch(p->DATA.path("mappings").path(text(p,"id")).path("nodes").has(text(n,"id")));
      assertEquals(complete,catalog.selectable(n),text(n,"name"));
    }
    String kia=option("car.brand","","Kia"),rio=option("car.model",kia,"Rio");
    var options=catalog.options("car.generation",rio,"",0);
    assertEquals(8,options.path("total").asInt());assertEquals(8,options.path("items").size());
    assertTrue(catalog.options("car.generation",rio,"Global market",0).path("items").isEmpty());
    assertEquals(8,catalog.options("car.generation",rio,"",999).path("offset").asInt());
    String hidden=java.util.stream.StreamSupport.stream(DATA.path("nodes").spliterator(),false).filter(n->text(n,"parentId").equals(rio)&&text(n,"name").equals("IV (Global market)")).findFirst().orElseThrow().path("id").asText();
    assertThrows(ApiException.class,()->catalog.selection(hidden));
    assertThrows(ApiException.class,()->catalog.validateValues(object("car.brand",hidden)));
  }
  @Test void generationRecognitionUsesUniqueNamesWithoutParenthesesOnlyAsFallback(){
    String kia=option("car.brand","","Kia"),rio=option("car.model",kia,"Rio");
    for(var sample:List.of(List.of("IV (FB)","IV"),List.of("IV Рестайлинг (Global market)","IV Рестайлинг"),List.of("(FB) Рестайлинг","IV Рестайлинг"),List.of("X-Line",""),List.of("Unknown (FB)",""))){
      AiGateway gateway=new AiGateway(){public String model(){return "test";}public ObjectNode serverJson(String i,String p,String s){return object("values",object(),"vehicle",object("brand","Kia","model","Rio","generation",sample.get(0)),"evidence",object("car.brand",s,"car.model",s,"car.generation",s));}};
      var result=new CarAiService(catalog,gateway).analyze("test",object("description","Kia Rio "+sample.get(0)));
      assertEquals(sample.get(1).isEmpty()?rio:option("car.generation",rio,sample.get(1)),result.path("values").path("car.brand").asText(),sample.get(0));
    }
    ObjectNode ambiguous=DATA.deepCopy();
    String third=option("car.generation",rio,"III");
    ((ArrayNode)ambiguous.path("nodes").path(third).path("aliases")).add("IV");
    AiGateway gateway=new AiGateway(){public String model(){return "test";}public ObjectNode serverJson(String i,String p,String s){return object("values",object(),"vehicle",object("brand","Kia","model","Rio","generation","IV (unknown)"),"evidence",object("car.brand",s,"car.model",s,"car.generation",s));}};
    var result=new CarAiService(new CarCatalogService(()->ambiguous),gateway).analyze("test",object("description","Kia Rio IV (unknown)"));
    assertEquals(rio,result.path("values").path("car.brand").asText());assertFalse(result.path("warnings").isEmpty());
  }
  @Test void dependentChoicesAreScopedAndRootStoresTheWholeKnownPath(){
    String kia=option("car.brand","","Kia"),rio=option("car.model",kia,"Rio");
    assertEquals(2,catalog.path(rio).size());assertEquals(kia,text(catalog.path(rio).get(0),"id"));
    assertThrows(ApiException.class,()->catalog.options("car.generation",kia,"",0));
    assertThrows(ApiException.class,()->catalog.validateValues(object("car.region",rio)));
    assertThrows(ApiException.class,()->catalog.validateValues(object("car.model",rio)));
    assertEquals(rio,catalog.validateValues(object("car.brand",rio)).path("car.brand").asText());
  }
  @Test void preparedValuesUseNativeCodesAndMissingGenerationNeverSelectsFirst(){
    String kia=option("car.brand","","Kia"),rio=option("car.model",kia,"Rio"),byn=option("car.currency","","BYN");
    var result=service.prepare(object("values",object("car.brand",rio,"car.price",24500,"car.currency",byn,"car.mileage",100000),"platforms",List.of("kufar","onliner","av","abw"),"extras",object()));
    assertEquals(4,result.path("platforms").size());
    for(JsonNode p:result.path("platforms")){assertFalse(p.path("values").toString().contains("generation"));}
    var onliner=result.path("platforms").get(1).path("values");
    assertEquals(32,onliner.path("onliner.manufacturer").path("value").asInt());assertEquals(884,onliner.path("onliner.model").path("value").asInt());
    assertEquals("byn",result.path("platforms").get(3).path("values").path("abw.currency").path("value").asText());
  }
  @Test void publicationNeverIncludesNextOrSubmitActions(){
    var result=service.configuration(object("id","car-test","revision",1,"card",object("values",object(),"platforms",List.of("av","abw"))));
    for(JsonNode job:result.path("jobs")){assertEquals("cars-v1",text(job,"contract"));for(String key:List.of("setup","next","submit"))assertTrue(job.path(key).isEmpty());}
  }
  @Test void aiCannotInventIdsOrSupplyUnsupportedFacts(){
    AiGateway gateway=new AiGateway(){public String model(){return "test";}public ObjectNode serverJson(String identity,String prompt,String source){return object("values",object("car.brand","invented","car.price",5000),"evidence",object("car.brand","Badge"));}};
    var result=new CarAiService(catalog,gateway).analyze("actor",object("description","Проверка"));
    assertEquals(object("car.description","Проверка"),result.path("values"));assertFalse(result.path("warnings").isEmpty());
  }
  @Test void geometryAndFlatVariantsStaySeparate(){
    assertEquals(6,DATA.path("mappings").path("abw").path("nodes").findValuesAsText("name").stream().filter(n->n.endsWith("область")).count());
    String brand=option("car.brand","","Kia");assertFalse(catalog.options("car.model",brand,"",0).path("items").isEmpty());
    assertTrue(catalog.options("car.transmission","","Робот",0).path("items").size()>0);
  }
  @Test void unitsPhoneAndCurrencyOrderAreExplicit(){
    String currency=option("car.currency","","BYN");
    var card=object("values",object("car.engine_capacity",1.6,"car.price",10000,"car.currency",currency,"car.phone","+375 (29) 123-45-67"),"platforms",List.of("av"));
    var values=service.prepare(card).path("platforms").get(0).path("values");
    assertEquals(1600,values.path("av.engine_capacity").path("value").asInt());
    assertEquals("291234567",values.path("av.phone_number").path("value").asText());
    assertEquals(1,values.path("av.phone_country").path("value").asInt());
    var job=service.configuration(object("id","units","revision",1,"card",card)).path("jobs").get(0);
    JsonNode price=list(job.path("controls")).stream().filter(c->text(c,"field").equals("av.price_amount")).findFirst().orElseThrow();
    assertTrue(has(price.path("binding").path("depends_on"),"av.price_currency"));
    ((ObjectNode)card.path("values")).put("car.engine_capacity",1.2345);
    assertFalse(service.prepare(card).path("platforms").get(0).path("values").has("av.engine_capacity"));
  }
  @Test void mergedBmwModelResolvesTheNativeBranchOfEachGeneration(){
    String bmw=option("car.brand","","BMW"),two=option("car.model",bmw,"2 серия");
    String f22=option("car.generation",two,"F22 / F23"),g42=option("car.generation",two,"G42");
    String first=service.prepare(object("values",object("car.brand",f22),"platforms",List.of("kufar"))).path("platforms").get(0).path("values").path("kufar.cars_model_v2").path("value").asText();
    String second=service.prepare(object("values",object("car.brand",g42),"platforms",List.of("kufar"))).path("platforms").get(0).path("values").path("kufar.cars_model_v2").path("value").asText();
    assertTrue(first.endsWith("model_2er"));assertTrue(second.endsWith("model_2serija"));
  }
  @Test void oldCommonIdsRedirectAndAliasesAreSearchable(){
    String bmw=option("car.brand","","BMW"),three=option("car.model",bmw,"3 серия");
    assertEquals(three,text(catalog.options("car.model",bmw,"3 series",0).path("items").get(0),"id"));
    List<Map.Entry<String,JsonNode>> redirects=new ArrayList<>();DATA.path("identityAliases").fields().forEachRemaining(redirects::add);
    String old=redirects.stream().filter(e->e.getValue().asText().equals(three)).findFirst().orElseThrow().getKey();
    assertEquals(three,catalog.validateValues(object("car.brand",old)).path("car.brand").asText());
    assertEquals(three,text(catalog.path(old).get(1),"id"));
  }
  @Test void oneCompactRequestResolvesNamesAndAliasesLocallyAndMapsToEveryPlatform(){
    String kia=option("car.brand","","Kia"),rio=option("car.model",kia,"Rio"),generation=option("car.generation",rio,"IV Рестайлинг");
    List<String> prompts=new ArrayList<>();
    AiGateway gateway=new AiGateway(){public String model(){return "test";}public ObjectNode serverJson(String identity,String prompt,String source){
      prompts.add(prompt);
      return object("values",object(),"vehicle",object("brand","Kia","model","Rio","generation","(FB) Рестайлинг"),"evidence",object("car.brand","Kia","car.model","Rio","car.generation","FB рестайлинг"));
    }};
    JsonNode result=new CarAiService(catalog,gateway).analyze("test",object("description","Kia Rio FB рестайлинг"));
    assertEquals(generation,result.path("values").path("car.brand").asText());
    assertEquals(1,prompts.size());assertFalse(prompts.get(0).contains("car.option."));assertFalse(prompts.get(0).contains(kia));
    assertTrue(prompts.get(0).contains("[\"drive:Задний\",\"Задний\"]"));
    for(JsonNode platform:service.prepare(object("values",result.path("values"),"platforms",List.of("kufar","onliner","av","abw"))).path("platforms")){
      String field=DATA.path("mappings").path(text(platform,"platform")).path("fields").path("car.generation").asText();
      assertTrue(platform.path("values").has(field));
    }
  }
  @Test void aiCannotChooseGenerationFromAnotherModel(){
    String kia=option("car.brand","","Kia"),rio=option("car.model",kia,"Rio");
    AiGateway gateway=new AiGateway(){public String model(){return "test";}public ObjectNode serverJson(String identity,String prompt,String source){
      return object("values",object(),"vehicle",object("brand","Kia","model","Rio","generation","unknown-generation"),"evidence",object("car.brand","Kia","car.model","Rio","car.generation","unknown"));
    }};
    JsonNode result=new CarAiService(catalog,gateway).analyze("test",object("description","Kia Rio"));
    assertEquals(rio,result.path("values").path("car.brand").asText());assertFalse(result.path("warnings").isEmpty());
  }
  @Test void generationNamesMayIncludeTheAlreadyMatchedBrandAndModel(){
    String kia=option("car.brand","","Kia"),rio=option("car.model",kia,"Rio"),expected=option("car.generation",rio,"IV Рестайлинг");
    for(String generation:List.of("Rio IV рестайлинг","Kia Rio IV рестайлинг")){
      AiGateway gateway=new AiGateway(){public String model(){return "test";}public ObjectNode serverJson(String i,String p,String s){return object("facts",List.of(object("field","car.brand","value","Kia","evidence",s),object("field","car.model","value","Kia Rio","evidence",s),object("field","car.generation","value",generation,"evidence",s)));}};
      var result=new CarAiService(catalog,gateway).analyze("test",object("description","Kia Rio IV рестайлинг"));
      assertEquals(expected,result.path("values").path("car.brand").asText());assertTrue(result.path("warnings").isEmpty());
    }
  }
  @Test void inferredGenerationUsesHiddenPhotoHintAndRequiresReview(){
    String bmw=option("car.brand","","BMW"),seven=option("car.model",bmw,"7 серия"),expected=option("car.generation",seven,"VI");
    AiGateway gateway=new AiGateway(){public String model(){return "test";}public ObjectNode serverJson(String i,String p,String s){
      assertTrue(s.contains("Форма фар соответствует G11/G12"));
      return object("facts",List.of(object("field","car.brand","value","BMW","evidence","BMW"),object("field","car.model","value","7 серия","evidence","7 серия"),object("field","car.generation","value","VI (G11/G12)","evidence","Форма фар и 2018 год","inferred",true)));
    }};
    var result=new CarAiService(catalog,gateway).analyze("test",object("description","BMW 7 серия 2018 года","photoAnalysis",object("generationHint","Форма фар соответствует G11/G12")));
    assertEquals(expected,result.path("values").path("car.brand").asText());assertTrue(result.path("evidence").path("car.generation").asText().contains("Проверьте"));
    assertFalse(result.path("warnings").isEmpty());assertFalse(result.path("values").path("car.description").asText().contains("Форма фар"));
  }
  @Test void abbreviatedBodyCodeCanSuggestSpecificGenerationOnlyInsideTheSelectedModel(){
    String bmw=option("car.brand","","BMW"),seven=option("car.model",bmw,"7 серия"),expected=option("car.generation",seven,"G12 (Long)");
    for(String model:List.of("7 серия","3 серия")){
      AiGateway gateway=new AiGateway(){public String model(){return "test";}public ObjectNode serverJson(String i,String p,String s){return object("values",object(),"vehicle",object("brand","BMW","model",model,"generation","G12"),"evidence",object("car.brand","BMW","car.model",model,"car.generation","Код G12"));}};
      var result=new CarAiService(catalog,gateway).analyze("test",object("description","BMW "+model+" G12"));
      assertEquals(model.equals("7 серия")?expected:option("car.model",bmw,model),result.path("values").path("car.brand").asText());assertFalse(result.path("warnings").isEmpty());
    }
  }
  @Test void bodyCodeMayBePartOfAGroupedOrParenthesizedGenerationButNotAnotherCode(){
    for(var sample:List.of(List.of("BMW","2 серия","F22","F22 / F23"),List.of("Audi","A2","8Z","I (8Z)"),List.of("BMW","7 серия","G1",""))){
      String brand=option("car.brand","",sample.get(0)),model=option("car.model",brand,sample.get(1));
      AiGateway gateway=new AiGateway(){public String model(){return "test";}public ObjectNode serverJson(String i,String p,String s){return object("values",object(),"vehicle",object("brand",sample.get(0),"model",sample.get(1),"generation",sample.get(2)),"evidence",object("car.brand",s,"car.model",s,"car.generation",s));}};
      var result=new CarAiService(catalog,gateway).analyze("test",object("description",String.join(" ",sample)));
      assertEquals(sample.get(3).isEmpty()?model:option("car.generation",model,sample.get(3)),result.path("values").path("car.brand").asText());
    }
  }
  @Test void preciseGenerationUsesBroaderSiteOptionsWithoutChangingTheCommonSelection(){
    String bmw=option("car.brand","","BMW"),seven=option("car.model",bmw,"7 серия");
    String specific=option("car.generation",seven,"G12 (Long)"),broad=option("car.generation",seven,"VI");
    var prepared=service.prepare(object("values",object("car.brand",specific),"platforms",List.of("kufar","onliner","av","abw")));
    for(JsonNode p:prepared.path("platforms")){
      String platform=text(p,"platform"),field=DATA.path("mappings").path(platform).path("fields").path("car.generation").asText();
      String expected=platform.equals("av")?"G12 (Long)":platform.equals("onliner")?"(G11/G12)":"VI (G11/G12)";
      assertEquals(expected,p.path("values").path(field).path("name").asText());
    }
    assertEquals(specific,catalog.validateValues(object("car.brand",specific)).path("car.brand").asText());
    AiGateway gateway=new AiGateway(){public String model(){return "test";}public ObjectNode serverJson(String i,String p,String s){return object("values",object(),"vehicle",object("brand","BMW","model","7 серия","generation","VI"),"evidence",object("car.brand",s,"car.model",s,"car.generation",s));}};
    var result=new CarAiService(catalog,gateway).analyze("test",object("description","BMW 7 серия VI"));
    assertEquals(broad,result.path("values").path("car.brand").asText());
  }
  @Test void flatChoicesMapBroadColoursAndCompoundTransmissionAndHybridControls(){
    String silver=option("car.color","","Серебристый"),robot=option("car.transmission","","Робот"),hybrid=option("car.engine","","Дизель (гибрид)");
    JsonNode result=service.prepare(object("values",object("car.color",silver,"car.transmission",robot,"car.engine",hybrid),"platforms",List.of("kufar","onliner","abw")));
    JsonNode kufar=result.path("platforms").get(0).path("values"),onliner=result.path("platforms").get(1).path("values"),abw=result.path("platforms").get(2).path("values");
    assertEquals("Серый / серебристый",kufar.path("kufar.cars_color").path("name").asText());
    assertEquals("серебристый",onliner.path("onliner.color").path("name").asText());
    assertEquals("1",kufar.path("kufar.cars_gearbox").path("value").asText());
    assertEquals("5",kufar.path("kufar.cars_autogearbox").path("value").asText());
    assertEquals("diesel",onliner.path("onliner.engineType").path("value").asText());
    assertTrue(onliner.path("onliner.hybrid").path("value").asBoolean());
    assertEquals("гибрид",abw.path("abw.engine").path("name").asText());
  }
  @Test void retiredModelNamedGenerationRetainsOnlyModelAndRealGenerationKeepsNativeMapping(){
    String audi=option("car.brand","","Audi"),a2=option("car.model",audi,"A2"),gen=option("car.generation",a2,"I (8Z)");
    String legacy="car.option.8848b514-cfcf-4292-b15c-d57708072809";
    assertEquals(a2,catalog.validateValues(object("car.brand",legacy)).path("car.brand").asText());
    JsonNode modelOnly=service.prepare(object("values",object("car.brand",legacy),"platforms",List.of("kufar"))).path("platforms").get(0).path("values");
    assertFalse(modelOnly.has("kufar.cars_gen_v2"));
    JsonNode known=service.prepare(object("values",object("car.brand",gen),"platforms",List.of("kufar"))).path("platforms").get(0).path("values");
    assertEquals("A2",known.path("kufar.cars_gen_v2").path("name").asText());
  }
}
