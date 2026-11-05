package by.autopost.rental.application;

import by.autopost.rental.model.FormRecipe;
import by.autopost.rental.model.Value;
import com.fasterxml.jackson.annotation.JsonInclude;
import com.fasterxml.jackson.annotation.JsonUnwrapped;
import java.util.List;
import java.util.Map;

/**
 * {@code extension-config}: one job per chosen platform, compiled from the saved card with the
 * rules of {@code integrationVersion}, and the photos stored with the card.
 */
@JsonInclude(JsonInclude.Include.NON_NULL)
public record ExtensionLaunch(
    int format,
    String integrationVersion,
    List<Job> jobs,
    String id,
    Integer revision,
    List<RentalPhotoService.ExtensionPhoto> photos) {
  /**
   * A form recipe with the values of the card: only the controls that get a value, the names of
   * the fields the user enters by hand ({@code unbound}), whether the extension may submit itself
   * ({@code checksPassed}) and the publication record of this launch on this platform.
   */
  @JsonInclude(JsonInclude.Include.NON_NULL)
  public record Job(
      Integer format,
      String platform,
      String startUrl,
      List<FormRecipe.ReadyGuard> ready,
      List<Control> controls,
      List<FormRecipe.Step> setup,
      List<FormRecipe.Step> next,
      List<FormRecipe.Step> submit,
      List<String> unbound,
      boolean checksPassed,
      String publication) {
    Job withPublication(String id) {
      return new Job(
          format, platform, startUrl, ready, controls, setup, next, submit, unbound, checksPassed,
          id);
    }
  }

  /**
   * One control of the recipe with its value, the address context of a suggestion, the field name
   * and the names of its option codes.
   */
  @JsonInclude(JsonInclude.Include.NON_NULL)
  public record Control(
      @JsonUnwrapped FormRecipe.FormControl control,
      Value value,
      List<String> matchContext,
      String name,
      Map<String, String> labels) {}
}
