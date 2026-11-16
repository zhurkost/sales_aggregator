package by.autopost;

import static by.autopost.shared.Json.*;
import static org.junit.jupiter.api.Assertions.*;
import by.autopost.ai.AiGateway;
import by.autopost.automotive.ai.CarPhotoRecognitionService;
import by.autopost.automotive.ai.CarAiService;
import by.autopost.automotive.application.CarCatalogService;
import by.autopost.automotive.infrastructure.JpegCarPhotoComposer;
import by.autopost.shared.ApiException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.awt.Color;
import java.awt.image.BufferedImage;
import java.io.*;
import java.util.*;
import javax.imageio.ImageIO;
import org.junit.jupiter.api.Test;

class CarPhotoWorkflowTest {
  final CarCatalogService catalog=new CarCatalogService(()->CarCatalogTest.DATA);
  String image(Color color)throws Exception{
    BufferedImage image=new BufferedImage(320,160,BufferedImage.TYPE_INT_RGB);var g=image.createGraphics();g.setColor(color);g.fillRect(0,0,320,160);g.dispose();
    var out=new ByteArrayOutputStream();ImageIO.write(image,"png",out);return "data:image/png;base64,"+Base64.getEncoder().encodeToString(out.toByteArray());
  }
  BufferedImage decoded(String url)throws Exception{return ImageIO.read(new ByteArrayInputStream(Base64.getDecoder().decode(url.split(",",2)[1])));}
  abstract class Vision implements AiGateway {
    public String model(){return "test";}
    public ObjectNode serverJson(String identity,String prompt,String source){throw new AssertionError("Expected image request");}
  }
  @Test void finalPassReadsOdometerFreshInsteadOfCopyingAnOverviewGuess()throws Exception{
    int[] calls={0};AiGateway ai=new Vision(){public ObjectNode serverJson(String i,String p,String s,List<String> a){
      if(++calls[0]==1)return object("text","BMW. Пробег 101905 км.","observations",List.of("Кожаный салон","Пробег: 101905 km"),"detailRequests",object("single",List.of(1),"groups",array()));
      assertFalse(s.contains("101905"));assertTrue(s.contains("Кожаный салон"));assertTrue(p.contains("закрыт"));
      return object("text","Продаётся BMW с кожаным салоном.","warnings",List.of("Пробег не читается: панель закрыта рулём."));
    }};
    var result=new CarPhotoRecognitionService(new JpegCarPhotoComposer(),catalog,ai).recognize("test",object("images",List.of(image(Color.BLUE))));
    assertFalse(text(result,"text").contains("101905"));assertEquals(2,calls[0]);
  }
  @Test void overviewThenRequestedWholeFramesAndGroupsReachOneFinalCall()throws Exception{
    var images=array(Collections.nCopies(8,image(Color.RED)));images.set(7,MAPPER.valueToTree(image(Color.BLUE)));int[] calls={0};
    AiGateway ai=new Vision(){public ObjectNode serverJson(String id,String prompt,String source,List<String> attachments){
      calls[0]++;assertFalse(prompt.contains("car.option."));
      for(String url:attachments)assertTrue(Base64.getDecoder().decode(url.split(",",2)[1]).length<512_000);
      if(calls[0]==1){
        assertEquals(1,attachments.size());assertTrue(source.contains("все 8"));assertTrue(prompt.contains("Этап 1"));
        return object("text","Предварительное описание","observations",List.of("Фото 2: кожаный салон"),"detailRequests",object("single",List.of(8),"groups",List.of(List.of(4,1))));
      }
      assertEquals(2,calls[0]);assertEquals(2,attachments.size());assertTrue(prompt.contains("Этап 2"));assertTrue(source.contains("кожаный салон"));
      JsonNode context=parse(source);assertEquals(array(List.of(8)),context.path("attachments").get(0).path("photos"));assertEquals(array(List.of(4,1)),context.path("attachments").get(1).path("photos"));
      try{var single=decoded(attachments.get(0));assertEquals(320,single.getWidth());assertEquals(160,single.getHeight());assertTrue(new Color(single.getRGB(160,80)).getBlue()>240);assertEquals(2048,decoded(attachments.get(1)).getWidth());}catch(Exception e){throw new AssertionError(e);}
      return object("text","Продаётся BMW с кожаным салоном.","observations",List.of("Фото 2: кожаный салон","Фото 8: шильдик BMW"),"candidates",object(),"warnings",array());
    }};
    var result=new CarPhotoRecognitionService(new JpegCarPhotoComposer(),catalog,ai).recognize("test",object("images",images));
    assertEquals(2,calls[0]);assertEquals(2,result.path("recognitionPasses").asInt());assertEquals(8,result.path("collage").path("photoCount").asInt());assertEquals(2,result.path("observations").size());assertEquals("Продаётся BMW с кожаным салоном.",text(result,"text"));
  }
  @Test void invalidSelectionGetsOnlyOneRepairAttemptAndNeverSendsAllOriginals()throws Exception{
    var photos=array(List.of(image(Color.RED),image(Color.BLUE)));
    for(JsonNode plan:List.of(object(),object("single",List.of(0),"groups",array()),object("single",List.of(3),"groups",array()),object("single",List.of(1.5),"groups",array()),object("single",array(),"groups",List.of(List.of(1))))){
      int[] calls={0};List<String> overview=new ArrayList<>();
      AiGateway ai=new Vision(){public ObjectNode serverJson(String i,String p,String s,List<String> a){
        calls[0]++;assertEquals(1,a.size());
        if(calls[0]==1){overview.addAll(a);return object("text","Черновик","detailRequests",plan);}
        assertEquals(2,calls[0]);assertEquals(overview,a);return (ObjectNode)plan;
      }};
      assertThrows(ApiException.class,()->new CarPhotoRecognitionService(new JpegCarPhotoComposer(),catalog,ai).recognize("test",object("images",photos)));assertEquals(2,calls[0]);
    }
  }
  @Test void invalidSeventhPhotoIsNotSilentlyIgnored()throws Exception{
    var photos=array(Collections.nCopies(6,image(Color.RED)));photos.add("invalid");
    AiGateway ai=new Vision(){public ObjectNode serverJson(String i,String p,String s,List<String> a){throw new AssertionError("All photos must be validated first");}};
    assertThrows(ApiException.class,()->new CarPhotoRecognitionService(new JpegCarPhotoComposer(),catalog,ai).recognize("test",object("images",photos)));
  }
  @Test void repairedSelectionSendsGenerationAndOdometerTogetherWithoutOtherOriginals()throws Exception{
    var photos=array(List.of(image(Color.RED),image(Color.BLUE),image(Color.GREEN),image(Color.YELLOW)));
    int[] calls={0};List<String> overview=new ArrayList<>();
    AiGateway ai=new Vision(){public ObjectNode serverJson(String i,String p,String s,List<String> a){
      calls[0]++;
      if(calls[0]==1){overview.addAll(a);return object("text","Черновик","detailRequests",object("single",array(),"groups",array()));}
      if(calls[0]==2){assertEquals(overview,a);return object("single",List.of(2,4),"groups",array());}
      assertEquals(3,calls[0]);assertEquals(2,a.size());
      var manifest=parse(s).path("attachments");assertEquals(array(List.of(2)),manifest.get(0).path("photos"));assertEquals(array(List.of(4)),manifest.get(1).path("photos"));
      return object("text","Продаётся Kia Rio.","generationHint","IV Рестайлинг","observations",List.of("Фото 4: одометр 60000 км"));
    }};
    var result=new CarPhotoRecognitionService(new JpegCarPhotoComposer(),catalog,ai).recognize("test",object("images",photos));
    assertEquals(3,calls[0]);assertEquals(3,result.path("recognitionPasses").asInt());assertEquals(2,result.path("detailImages").size());
    assertEquals("IV Рестайлинг",text(result,"generationHint"));assertEquals("Фото 4: одометр 60000 км",result.path("observations").get(0).asText());
  }
  @Test void duplicateStringAndOutOfRangeNumbersAreNormalizedWithoutExtraAiCall()throws Exception{
    var photos=array(Collections.nCopies(5,image(Color.RED)));int[] calls={0};
    AiGateway ai=new Vision(){public ObjectNode serverJson(String i,String p,String s,List<String> a){
      if(++calls[0]==1)return object("text","Черновик","detailRequests",object("single",List.of("2",2,0,99,1.5),"groups",List.of(List.of(2,3,3),List.of(4,5))));
      assertEquals(2,calls[0]);assertEquals(3,a.size());var manifest=parse(s).path("attachments");
      assertEquals(array(List.of(2)),manifest.get(0).path("photos"));assertEquals(array(List.of(3)),manifest.get(1).path("photos"));assertEquals("single",text(manifest.get(1),"kind"));assertEquals(array(List.of(4,5)),manifest.get(2).path("photos"));
      return object("text","Продаётся автомобиль.");
    }};
    var result=new CarPhotoRecognitionService(new JpegCarPhotoComposer(),catalog,ai).recognize("test",object("images",photos));
    assertEquals(2,calls[0]);assertEquals(2,result.path("recognitionPasses").asInt());assertFalse(result.path("warnings").isEmpty());
  }
  @Test void moreThanTwelvePhotosAreAllIncludedAndSingleFrameKeepsItsAspect()throws Exception{
    var composer=new JpegCarPhotoComposer();var result=composer.compose(array(Collections.nCopies(20,image(Color.RED))));
    assertEquals(20,result.photoCount());assertEquals(2048,result.width());assertEquals(2560,result.height());assertTrue(result.byteSize()<512_000);
    var single=composer.composeSingle(MAPPER.valueToTree(image(Color.BLUE)));assertEquals(2,single.width()/single.height());assertTrue(single.byteSize()<512_000);
  }
  @Test void finalFailureDoesNotReturnPreliminaryResultOrStartRetryLoop()throws Exception{
    int[] calls={0};AiGateway ai=new Vision(){public ObjectNode serverJson(String i,String p,String s,List<String> a){if(++calls[0]==1)return object("text","Черновик","detailRequests",object("single",List.of(1),"groups",array()));throw new ApiException(502,"Unavailable");}};
    var input=object("images",List.of(image(Color.RED)));
    assertThrows(ApiException.class,()->new CarPhotoRecognitionService(new JpegCarPhotoComposer(),catalog,ai).recognize("test",input));assertEquals(2,calls[0]);
  }
  @Test void finalObservationsReachFieldAnalysisWithoutLeakingIntoAdText(){
    AiGateway ai=new AiGateway(){
      public String model(){return "test";}
      public ObjectNode serverJson(String i,String p,String s){assertTrue(s.contains("Фото 8: одометр 186000 км"));return object("facts",List.of(object("field","car.mileage","value",186000,"evidence","Фото 8: одометр 186000 км")));}
    };
    var result=new CarAiService(catalog,ai).analyze("test",object("recognizedText","Продаётся BMW.","photoAnalysis",object("observations",List.of("Фото 8: одометр 186000 км"))));
    assertEquals(186000,result.path("values").path("car.mileage").asInt());assertEquals("Продаётся BMW.",result.path("values").path("car.description").asText());
  }
}
