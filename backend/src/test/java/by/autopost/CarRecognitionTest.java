package by.autopost;

import static org.junit.jupiter.api.Assertions.*;
import static by.autopost.shared.Json.*;
import by.autopost.ai.AiGateway;
import by.autopost.automotive.ai.*;
import by.autopost.automotive.application.*;
import by.autopost.automotive.infrastructure.JpegCarPhotoComposer;
import by.autopost.shared.ApiException;
import com.fasterxml.jackson.databind.*;
import com.fasterxml.jackson.databind.node.*;
import java.awt.Color;
import java.awt.image.BufferedImage;
import java.io.*;
import java.util.*;
import javax.imageio.ImageIO;
import org.junit.jupiter.api.Test;

class CarRecognitionTest {
  final CarCatalogService catalog=new CarCatalogService(()->CarCatalogTest.DATA);
  @Test void yearDropdownIsDescendingAndRetainsNumericCardValues(){
    var result=catalog.options("car.year","","",0);var years=result.path("items");
    assertEquals(String.valueOf(CarCatalogService.maxYear()),text(years.get(0),"id"));
    assertEquals(String.valueOf(CarCatalogService.MIN_YEAR),text(years.get(years.size()-1),"id"));
    for(int i=1;i<years.size();i++)assertEquals(years.get(i-1).path("id").asInt()-1,years.get(i).path("id").asInt());
    assertEquals(2020,catalog.validateValues(object("car.year",2020)).path("car.year").asInt());
    assertEquals("select",text(list(catalog.editor().path("fields")).stream().filter(f->text(f,"id").equals("car.year")).findFirst().orElseThrow(),"control"));
  }
  @Test void yearCandidatesUseCompactRangeAndSurviveBothAiSteps(){
    var policy=new CarCandidatePolicy(catalog);var codes=new CarPromptOptions();var fields=codes.compact(policy.fields());
    JsonNode year=list(fields).stream().filter(f->text(f,"id").equals("car.year")).findFirst().orElseThrow();
    assertFalse(year.has("options"));assertEquals(CarCatalogService.maxYear(),year.path("max").asInt());
    var warnings=array();var photo=policy.validate(codes.decode(object("candidates",object("car.year",List.of(2019,2020)),"candidateEvidence",object("car.year","Годы выпуска поколения"))),warnings);
    assertEquals(List.of("2019","2020"),list(photo.path("candidates").path("car.year")).stream().map(JsonNode::asText).toList());
    assertEquals(photo.path("candidates"),codes.encodeCandidates(photo).path("candidates"));assertTrue(warnings.isEmpty());
    assertFalse(policy.validate(object("candidates",object("car.year",List.of(2020,CarCatalogService.maxYear()+1)),"candidateEvidence",object("car.year","Годы")),warnings).path("candidates").has("car.year"));
    AiGateway ai=new AiGateway(){public String model(){return "test";}public ObjectNode serverJson(String i,String p,String s){return object("facts",List.of(object("field","car.year","value",2020,"evidence","2020 года")));}};
    var result=new CarAiService(catalog,ai).analyze("test",object("description","Автомобиль 2020 года","photoAnalysis",photo));
    assertEquals(2020,result.path("values").path("car.year").asInt());assertEquals(array(List.of("2020")),result.path("candidates").path("car.year"));
  }
  String photo(Color color)throws Exception{
    BufferedImage image=new BufferedImage(200,100,BufferedImage.TYPE_INT_RGB);
    var g=image.createGraphics();g.setColor(color);g.fillRect(0,0,200,100);g.dispose();
    var output=new ByteArrayOutputStream();ImageIO.write(image,"png",output);image.flush();
    return "data:image/png;base64,"+Base64.getEncoder().encodeToString(output.toByteArray());
  }
  JsonNode options(String prompt){return parse(prompt.substring(prompt.lastIndexOf("Поля: ")+6));}
  String code(JsonNode fields,String field,int index){return list(fields).stream().filter(f->text(f,"id").equals(field)).findFirst().orElseThrow().path("options").get(index).get(0).asText();}
  List<JsonNode> nodes(String field){List<JsonNode> result=new ArrayList<>();catalog.data().path("nodes").forEach(n->{if(text(n,"field").equals(field))result.add(n);});return result;}

  @Test void collageUsesAllPhotosInFourColumnsAndHasBoundedJpegBytes()throws Exception{
    Color[] colors={Color.RED,Color.GREEN,Color.BLUE,Color.YELLOW,Color.CYAN,Color.MAGENTA};
    ArrayNode inputs=array();for(Color color:colors)inputs.add(photo(color));inputs.add(photo(Color.BLACK));
    var collage=new JpegCarPhotoComposer().compose(inputs);
    byte[] bytes=Base64.getDecoder().decode(collage.dataUrl().split(",",2)[1]);
    assertEquals(7,collage.photoCount());assertEquals(bytes.length,collage.byteSize());assertTrue(bytes.length<512_000);
    BufferedImage result=ImageIO.read(new ByteArrayInputStream(bytes));assertEquals(2048,result.getWidth());assertEquals(1024,result.getHeight());
    for(int i=0;i<6;i++){
      Color actual=new Color(result.getRGB(i%4*512+256,i/4*512+256));
      assertTrue(Math.abs(actual.getRed()-colors[i].getRed())<10);assertTrue(Math.abs(actual.getGreen()-colors[i].getGreen())<10);assertTrue(Math.abs(actual.getBlue()-colors[i].getBlue())<10);
    }
    assertEquals(Color.WHITE.getRGB(),result.getRGB(256,20));result.flush();
  }

  @Test void noisyCollageStillFitsTheHardSizeLimit()throws Exception{
    BufferedImage image=new BufferedImage(512,512,BufferedImage.TYPE_INT_RGB);Random random=new Random(7);
    for(int y=0;y<512;y++)for(int x=0;x<512;x++)image.setRGB(x,y,random.nextInt(0x1000000));
    var bytes=new ByteArrayOutputStream();ImageIO.write(image,"jpeg",bytes);image.flush();
    String data="data:image/jpeg;base64,"+Base64.getEncoder().encodeToString(bytes.toByteArray());
    var result=new JpegCarPhotoComposer().compose(array(Collections.nCopies(12,data)));
    assertTrue(result.byteSize()<512_000);assertEquals(12,result.photoCount());
  }

  @Test void malformedPhotosAreRejectedBeforeCallingAi(){
    AiGateway ai=new AiGateway(){public String model(){return "test";}public ObjectNode serverJson(String i,String p,String s){throw new AssertionError("AI must not be called");}};
    var service=new CarPhotoRecognitionService(new JpegCarPhotoComposer(),catalog,ai);
    for(JsonNode images:List.of(array(),array(List.of("https://example.com/photo.jpg")),array(List.of("data:image/png;base64,AAAA")),array(Collections.nCopies(13,"invalid"))))
      assertThrows(ApiException.class,()->service.recognize("test",object("images",images)));
  }

  @Test void photoRecognitionUsesOneImageOneCallAndOnlyValidatedCompactCandidates()throws Exception{
    int[] calls={0};
    AiGateway ai=new AiGateway(){
      public String model(){return "test";}
      public ObjectNode serverJson(String i,String p,String s){throw new AssertionError("Image call required");}
      public ObjectNode serverJson(String i,String p,String s,List<String> images){
        calls[0]++;assertEquals(1,images.size());assertTrue(images.get(0).startsWith("data:image/jpeg;base64,"));assertFalse(p.contains("car.option."));assertFalse(p.contains("parentId"));
        JsonNode fields=parse(p.substring(p.lastIndexOf("справочника: ")+13));
        return object("text","Продаётся Kia Rio в кузове седан. Коробка передач по фото не определяется.","candidates",object("car.transmission",List.of(code(fields,"car.transmission",0),code(fields,"car.transmission",1)),"car.engine",List.of(code(fields,"car.engine",0),"invented")),"candidateEvidence",object("car.transmission","У модели несколько вариантов","car.engine","Варианты двигателя"),"detailRequests",object("single",array(),"groups",array()));
      }
    };
    var result=new CarPhotoRecognitionService(new JpegCarPhotoComposer(),catalog,ai).recognize("test",object("images",List.of(photo(Color.RED))));
    assertEquals(1,calls[0]);assertEquals(2,result.path("candidates").path("car.transmission").size());
    assertFalse(result.path("candidates").has("car.engine"));assertFalse(result.path("warnings").isEmpty());
    assertEquals("Продаётся Kia Rio в кузове седан. Коробка передач по фото не определяется.",text(result,"text"));assertFalse(result.has("values"));
  }

  @Test void bothTextsAreSentOnceAndAmbiguousChoicesDoNotFillOneValue(){
    int[] calls={0};
    AiGateway ai=new AiGateway(){public String model(){return "test";}public ObjectNode serverJson(String i,String p,String s){
      calls[0]++;assertTrue(s.contains("Пробег 60000 км"));assertTrue(s.contains("Возможно механика или автомат"));assertFalse(p.contains("car.option."));
      JsonNode fields=options(p);String first=code(fields,"car.transmission",0),second=code(fields,"car.transmission",1);
      return object("values",object("car.mileage",60000,"car.transmission",first),"evidence",object("car.mileage","Пробег 60000 км","car.transmission","Гипотеза"),"candidates",object("car.transmission",List.of(first,second)),"candidateEvidence",object("car.transmission","Возможно механика или автомат"));
    }};
    var result=new CarAiService(catalog,ai).analyze("test",object("description","Пробег 60000 км","recognizedText","Возможно механика или автомат"));
    assertEquals(1,calls[0]);assertEquals(60000,result.path("values").path("car.mileage").asInt());assertFalse(result.path("values").has("car.transmission"));assertEquals(2,result.path("candidates").path("car.transmission").size());
  }

  @Test void filtersRejectForeignFieldsUnknownIdsAndMissingEvidence(){
    String engine=text(nodes("car.engine").get(0),"id"),body=text(nodes("car.body").get(0),"id");
    var warnings=array();var result=new CarCandidatePolicy(catalog).validate(object("candidates",object("car.body",List.of(body,engine),"car.engine",List.of(engine),"car.brand",List.of("anything")),"candidateEvidence",object("car.body","Mixed fields","car.brand","Not a flat field")),warnings);
    assertTrue(result.path("candidates").isEmpty());assertEquals(2,warnings.size());
  }
  @Test void factsCarryTheirEvidenceAndConfirmedChoicesRestrictTheirDropdown(){
    AiGateway ai=new AiGateway(){public String model(){return "test";}public ObjectNode serverJson(String i,String p,String s){
      String body=code(options(p),"car.body",0);
      return object("facts",List.of(object("field","car.body","value",body,"evidence","седан"),object("field","car.year","value",2021,"evidence","2021 года"),object("field","car.brand","value","Kia","evidence","Kia Rio"),object("field","car.model","value","Rio","evidence","Kia Rio")));
    }};
    var result=new CarAiService(catalog,ai).analyze("test",object("description","Kia Rio 2021 года, седан"));
    assertEquals(4,result.path("values").size());assertEquals("Kia Rio 2021 года, седан",result.path("values").path("car.description").asText());assertEquals(1,result.path("candidates").path("car.body").size());assertTrue(result.path("warnings").isEmpty());
  }
  @Test void hiddenPhotoCandidatesSurviveTextAnalysisWithoutBeingAddedToDescription(){
    String first=text(nodes("car.engine").get(0),"id"),second=text(nodes("car.engine").get(1),"id");
    AiGateway ai=new AiGateway(){public String model(){return "test";}public ObjectNode serverJson(String i,String p,String s){
      assertFalse(s.contains("car.option."));assertTrue(s.contains("Служебные варианты"));
      return object("facts",List.of(object("field","car.description","value","Продаётся седан.","evidence","Продаётся седан.")));
    }};
    var input=object("recognizedText","Продаётся седан.","photoAnalysis",object("candidates",object("car.engine",List.of(first,second)),"candidateEvidence",object("car.engine","Два варианта двигателя")));
    var result=new CarAiService(catalog,ai).analyze("test",input);
    assertEquals(2,result.path("candidates").path("car.engine").size());assertFalse(result.path("values").has("car.engine"));assertEquals("Продаётся седан.",result.path("values").path("car.description").asText());
  }
  @Test void missingDescriptionFallsBackToSourceTextsWithinFieldLimit(){
    AiGateway ai=new AiGateway(){public String model(){return "test";}public ObjectNode serverJson(String i,String p,String s){return object("facts",array());}};
    var service=new CarAiService(catalog,ai);
    assertEquals("Продаётся седан.",service.analyze("test",object("recognizedText","Продаётся седан.")).path("values").path("car.description").asText());
    var result=service.analyze("test",object("description","а".repeat(10000),"recognizedText","б".repeat(10000)));
    assertEquals(15000,result.path("values").path("car.description").asText().length());assertFalse(result.path("warnings").isEmpty());
  }
}
