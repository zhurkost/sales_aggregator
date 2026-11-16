package by.autopost.automotive.infrastructure;

import by.autopost.automotive.application.CarPhotoComposer;
import by.autopost.shared.ApiException;
import com.fasterxml.jackson.databind.JsonNode;
import java.awt.*;
import java.awt.image.BufferedImage;
import java.io.*;
import java.util.Base64;
import javax.imageio.*;
import org.springframework.stereotype.Component;

@Component
public class JpegCarPhotoComposer implements CarPhotoComposer {
  public static final int MAX_BYTES=512_000;
  // Small bitmap numerals keep headless servers independent of native font libraries.
  private static final String[] DIGITS={"111101101101111","010110010010111","111001111100111","111001111001111","101101111001001","111100111001111","111100111101111","111001001001001","111101111101111","111101111001111"};
  @Override public Collage compose(JsonNode images){
    if(!images.isArray()||images.isEmpty())throw new ApiException(400,"Добавьте фотографии.");
    int count=images.size(),columns=4,rows=(count+columns-1)/columns;
    // Bound working memory by shrinking cells as the set grows, without dropping any photo.
    int cell=Math.max(1,Math.min(512,Math.min(65000/rows,(int)Math.sqrt(16_000_000.0/(columns*rows)))));
    int caption=Math.max(1,cell/16),padding=Math.max(1,cell/64);
    BufferedImage canvas=new BufferedImage(columns*cell,rows*cell,BufferedImage.TYPE_INT_RGB);
    Graphics2D g=canvas.createGraphics();g.setColor(Color.WHITE);g.fillRect(0,0,canvas.getWidth(),canvas.getHeight());
    g.setRenderingHint(RenderingHints.KEY_INTERPOLATION,RenderingHints.VALUE_INTERPOLATION_BICUBIC);
    try{
      for(int i=0;i<count;i++){
        BufferedImage photo=decode(images.get(i),cell);
        double scale=Math.min(Math.max(1,cell-2*padding)/(double)photo.getWidth(),Math.max(1,cell-caption-padding)/(double)photo.getHeight());
        int w=Math.max(1,(int)Math.round(photo.getWidth()*scale)),h=Math.max(1,(int)Math.round(photo.getHeight()*scale));
        g.drawImage(photo,(i%columns)*cell+(cell-w)/2,(i/columns)*cell+caption+(cell-caption-h)/2,w,h,null);photo.flush();
        drawNumber(g,i+1,(i%columns)*cell+padding,(i/columns)*cell+padding,Math.max(1,caption/7));
      }
    }finally{g.dispose();}
    return bounded(canvas,count);
  }
  private static void drawNumber(Graphics2D g,int number,int x,int y,int scale){
    g.setColor(Color.BLACK);
    for(char digit:Integer.toString(number).toCharArray()){
      String pixels=DIGITS[digit-'0'];
      for(int i=0;i<pixels.length();i++)if(pixels.charAt(i)=='1')g.fillRect(x+(i%3)*scale,y+(i/3)*scale,scale,scale);
      x+=4*scale;
    }
  }
  @Override public Collage composeSingle(JsonNode image){
    BufferedImage photo=decode(image,1600);
    double scale=Math.min(1,1600.0/Math.max(photo.getWidth(),photo.getHeight()));
    BufferedImage canvas=new BufferedImage(Math.max(1,(int)Math.round(photo.getWidth()*scale)),Math.max(1,(int)Math.round(photo.getHeight()*scale)),BufferedImage.TYPE_INT_RGB);
    Graphics2D g=canvas.createGraphics();
    try{g.setColor(Color.WHITE);g.fillRect(0,0,canvas.getWidth(),canvas.getHeight());g.setRenderingHint(RenderingHints.KEY_INTERPOLATION,RenderingHints.VALUE_INTERPOLATION_BICUBIC);g.drawImage(photo,0,0,canvas.getWidth(),canvas.getHeight(),null);}
    finally{g.dispose();photo.flush();}
    return bounded(canvas,1);
  }
  private Collage bounded(BufferedImage canvas,int count){
    try{
      for(int pass=0;pass<9;pass++){
        for(float quality:new float[]{.85f,.7f,.55f,.4f,.25f}){
          byte[] jpeg=encode(canvas,quality);
          if(jpeg.length<MAX_BYTES)return new Collage("data:image/jpeg;base64,"+Base64.getEncoder().encodeToString(jpeg),count,jpeg.length,canvas.getWidth(),canvas.getHeight());
        }
        BufferedImage smaller=new BufferedImage(Math.max(1,canvas.getWidth()*3/4),Math.max(1,canvas.getHeight()*3/4),BufferedImage.TYPE_INT_RGB);
        Graphics2D resized=smaller.createGraphics();resized.setRenderingHint(RenderingHints.KEY_INTERPOLATION,RenderingHints.VALUE_INTERPOLATION_BICUBIC);resized.drawImage(canvas,0,0,smaller.getWidth(),smaller.getHeight(),null);resized.dispose();canvas.flush();canvas=smaller;
      }
      throw new ApiException(400,"Не удалось уменьшить коллаж до 512 КБ.");
    }catch(IOException e){throw new ApiException(400,"Не удалось подготовить фотографии.");}
    finally{canvas.flush();}
  }
  private BufferedImage decode(JsonNode value,int maxDimension){
    String data=value.asText("");
    if(data.length()>1_000_000||!data.matches("data:image/(jpeg|png);base64,[A-Za-z0-9+/=]+"))throw new ApiException(400,"Некорректная фотография. Добавьте её заново.");
    try(var input=ImageIO.createImageInputStream(new ByteArrayInputStream(Base64.getDecoder().decode(data.substring(data.indexOf(',')+1))))){
      var readers=ImageIO.getImageReaders(input);if(!readers.hasNext())throw new IOException();
      var reader=readers.next();
      try{
        reader.setInput(input,true,true);int w=reader.getWidth(0),h=reader.getHeight(0);
        if(w<1||h<1||(long)w*h>16_000_000)throw new IOException();
        var param=reader.getDefaultReadParam();int sample=Math.max(1,Math.max(w,h)/maxDimension);param.setSourceSubsampling(sample,sample,0,0);
        BufferedImage image=reader.read(0,param);if(image==null)throw new IOException();return image;
      }finally{reader.dispose();}
    }catch(IOException|IllegalArgumentException e){throw new ApiException(400,"Не удалось прочитать фотографию. Добавьте её заново.");}
  }
  private byte[] encode(BufferedImage image,float quality)throws IOException{
    var writer=ImageIO.getImageWritersByFormatName("jpeg").next();var bytes=new ByteArrayOutputStream();
    try(var output=ImageIO.createImageOutputStream(bytes)){
      writer.setOutput(output);var param=writer.getDefaultWriteParam();param.setCompressionMode(ImageWriteParam.MODE_EXPLICIT);param.setCompressionQuality(quality);
      writer.write(null,new IIOImage(image,null,null),param);output.flush();return bytes.toByteArray();
    }finally{writer.dispose();}
  }
}
