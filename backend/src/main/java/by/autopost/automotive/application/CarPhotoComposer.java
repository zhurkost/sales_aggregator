package by.autopost.automotive.application;
import com.fasterxml.jackson.databind.JsonNode;

/** Builds a bounded image for recognition; publication photos stay unchanged. */
public interface CarPhotoComposer {
  record Collage(String dataUrl,int photoCount,int byteSize,int width,int height) {}
  Collage compose(JsonNode images);
  /** One entire frame, without cropping or the thumbnail grid. */
  Collage composeSingle(JsonNode image);
}
