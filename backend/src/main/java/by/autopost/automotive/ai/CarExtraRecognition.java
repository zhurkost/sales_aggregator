package by.autopost.automotive.ai;

import static by.autopost.shared.Json.*;
import by.autopost.automotive.application.*;
import by.autopost.shared.ApiException;
import com.fasterxml.jackson.databind.*;
import com.fasterxml.jackson.databind.node.*;
import java.util.*;

/** Recognizes only editable catalogue fields; never lets model output invent native values. */
final class CarExtraRecognition {
  private static final Set<String> AUTOMATIC=Set.of("av.condition_promotion","av.phone_country","kufar.price_mode","onliner.sellerType");
  private final Map<String,JsonNode> fields=new LinkedHashMap<>();
  CarExtraRecognition(CarCatalogService catalog){
    for(JsonNode f:catalog.editor().path("extras"))if(!AUTOMATIC.contains(text(f,"id"))&&Set.of("enum","multi_enum","boolean","number","integer","text").contains(text(f,"type")))fields.put(text(f,"id"),f);
  }
  ArrayNode promptFields(){
    ArrayNode result=array();for(JsonNode f:fields.values()){
      ObjectNode item=object("id",text(f,"id"),"name",text(f,"name"),"type",text(f,"type"));
      if(Set.of("enum","multi_enum").contains(text(f,"type")))item.set("options",f.path("options"));
      for(String bound:List.of("min","max"))if(f.path("validation").has(bound))item.set(bound,f.path("validation").path(bound));
      result.add(item);
    }return result;
  }
  ObjectNode accept(ObjectNode reply,String original,ObjectNode evidence,ArrayNode warnings){
    ObjectNode extras=object();if(!reply.path("values").isObject())return extras;
    ObjectNode values=(ObjectNode)reply.path("values");String source=CarCatalogService.normalize(original);
    List<String> ids=new ArrayList<>();values.fieldNames().forEachRemaining(ids::add);
    for(String id:ids){
      if(id.startsWith("car."))continue;
      JsonNode value=values.remove(id),field=fields.get(id);String quote=reply.path("evidence").path(id).asText("");
      try{
        String normalized=CarCatalogService.normalize(quote);
        if(field==null||normalized.isBlank()||!source.contains(normalized))throw new ApiException(400,"Нет подтверждения в исходном тексте.");
        JsonNode valid=CarExtraFields.validate(field,value);
        if(valid.isArray()&&valid.isEmpty()||valid.isTextual()&&valid.asText().isBlank())continue;
        String platform=text(field,"platform");if(!extras.has(platform))extras.set(platform,object());
        ((ObjectNode)extras.path(platform)).set(id,valid);evidence.put(id,quote);
      }catch(ApiException invalid){warnings.add("Не принято дополнительное поле «"+(field==null?id:text(field,"name"))+"»: требуется допустимое значение и цитата из вашего текста.");}
    }
    if(extras.path("onliner").has("onliner.power")&&!extras.path("onliner").has("onliner.powerUnit")){
      ((ObjectNode)extras.path("onliner")).remove("onliner.power");evidence.remove("onliner.power");
      warnings.add("Мощность Onliner не заполнена: ИИ не подтвердил единицу мощности.");
      if(extras.path("onliner").isEmpty())extras.remove("onliner");
    }
    return extras;
  }
  static final String RULES="""
    Дополнительные поля с префиксами kufar., onliner., av., abw. заполняй по тому же исходному
    описанию пользователя, отдельным фактом для каждой площадки, где есть подходящее поле.
    Не ограничивайся упоминанием оборудования в car.description: выставляй соответствующие поля.
    Не придумывай отсутствующие поля площадки. Используй только переданные списки и коды.
    Для каждого дополнительного факта evidence — точная непустая цитата из описания пользователя,
    а не результат фото, догадка по модели или комплектации. При отсутствии сведений поле пропускай.
    boolean: true при явном наличии, false только при явном отрицании. Отсутствие упоминания не false.
    multi_enum: один массив всех подтверждённых кодов для поля, без повторов. Не возвращай строку
    вместо массива и не перечисляй альтернативы как установленное оборудование.
    Например «есть Bluetooth и USB»: onliner.bluetooth=true, onliner.usb=true,
    kufar.cars_aux=true, av.options содержит варианты Bluetooth и USB из переданного списка.
    «Подогрев передних сидений» не подтверждает подогрев задних; «камера заднего вида» не камера 360.
    «ABS» подтверждает объединённый флаг Kufar ABS / ESP / ASR, но не отдельные ESP или ASR других площадок.
    Для объединённых положительных флагов достаточно одного подтверждённого компонента; false
    допустим только когда отрицаются все компоненты. Не добавляй пакеты оборудования по марке/году.
    «Обмен не интересует»: kufar.possible_exchange=false, onliner.exchange=false,
    av.exchange_options — вариант «не интересует». «Торг после осмотра» — соответствующий вариант Kufar.
    Для ABW используй только реально перечисленные поля (состояние, наличие, email); списка оборудования
    там нет. Не подменяй состояние автомобиля утверждением «в наличии».
    Мощность и единицу мощности возвращай вместе по тексту (л.с. или кВт), без догадок и конвертации.
    Для контактов, обмена, торга, гарантии, НДС, таможни, состояния и регистрации нужны явные сведения.
    Не выбирай платное продвижение и не меняй автоматически управляемые поля.
    """;
}
