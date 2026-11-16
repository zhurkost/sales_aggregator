package by.autopost.diagnostics;
import static by.autopost.shared.Json.*;
import by.autopost.ai.*;
import by.autopost.ai.infrastructure.HttpAiGateway;
import by.autopost.automotive.ai.CarAiService;
import by.autopost.automotive.ai.CarPhotoRecognitionService;
import by.autopost.automotive.infrastructure.JpegCarPhotoComposer;
import by.autopost.automotive.application.CarCatalogService;
import com.fasterxml.jackson.databind.*;
import com.fasterxml.jackson.databind.node.*;
import java.nio.file.*;
import java.util.*;

/** Opt-in live AI diagnostic. Uses synthetic cases, no database or marketplace access. */
public class CarAiChainProbe {
 public static void main(String[] args)throws Exception{
  JsonNode runtime=MAPPER.readTree(CarAiChainProbe.class.getResourceAsStream("/automotive/cars_used_sale/runtime.json"));
  var catalog=new CarCatalogService(()->runtime);
  var transport=new HttpAiGateway(System.getenv().getOrDefault("AI_API_KEY",""),System.getenv().getOrDefault("AI_PROVIDER","openrouter"),System.getenv().getOrDefault("AI_MODEL","recorded"),System.getenv().getOrDefault("AI_VISION_MODEL","google/gemini-2.5-flash"));
  ArrayNode report=array();
  for(JsonNode test:MAPPER.readTree(Files.readString(Path.of(args[0])))){
   ObjectNode input=test.path("input").deepCopy(),row=object("id",text(test,"id"));report.add(row);
   AiGateway capture=new AiGateway(){public String model(){return transport.model();}public String visionModel(){return transport.visionModel();}public ObjectNode serverJson(String i,String p,String s){row.put("prompt",p);row.put("source",s);ObjectNode raw=args.length>2&&args[2].equals("replay")?(ObjectNode)test.path("raw"):transport.serverJson(i,p,s);row.set("raw",raw);return raw;}public ObjectNode serverJson(String i,String p,String s,List<String> images){row.put("photoPrompt",p);row.put("outgoingImageCount",images.size());var raw=transport.serverJson(i,p,s,images);row.set("photoRaw",raw);return raw;}};
   try{
    if(input.has("images")){var photo=new CarPhotoRecognitionService(new JpegCarPhotoComposer(),catalog,capture).recognize("chain-probe",input);row.set("photo",photo);input.remove("images");input.put("recognizedText",text(photo,"text"));input.set("photoAnalysis",photo);}
    row.set("input",input);var result=new CarAiService(catalog,capture).analyze("chain-probe",input);row.set("result",result);ObjectNode names=object();result.path("values").fields().forEachRemaining(e->{JsonNode node=catalog.node(e.getValue().asText());names.set(e.getKey(),node.isMissingNode()?e.getValue():node.path("name"));});row.set("names",names);System.out.println(text(test,"id")+": "+result.path("values").size()+" values, "+result.path("candidates").size()+" filters");}
   catch(Exception e){row.put("error",e.getMessage());System.out.println(text(test,"id")+": error");}
   Files.writeString(Path.of(args[1]),MAPPER.writerWithDefaultPrettyPrinter().writeValueAsString(report));
  }
 }
}
