package by.autopost.rental.model;

import com.fasterxml.jackson.annotation.JsonProperty;
import java.util.ArrayList;
import java.util.List;

/**
 * One native field prepared from the card. {@code transfer: "manual"} with {@code
 * manual_reason}: the form has no element for it and the user enters it on the platform.
 */
public record MappingRule(
    @JsonProperty("common_option_id") String commonOptionId,
    @JsonProperty("platform_option_id") String platformOptionId,
    Conversion conversion,
    @JsonProperty("editor_group") String editorGroup,
    @JsonProperty("editor_group_name") String editorGroupName,
    String transfer,
    @JsonProperty("manual_reason") String manualReason) {
  public MappingRule {
    commonOptionId = commonOptionId == null ? "" : commonOptionId;
    platformOptionId = platformOptionId == null ? "" : platformOptionId;
    if (conversion == null)
      throw new IllegalArgumentException("неподдерживаемое преобразование у " + platformOptionId);
    editorGroup = editorGroup == null ? "" : editorGroup;
    editorGroupName = editorGroupName == null ? "" : editorGroupName;
  }

  /** The card fields the value is prepared from. */
  public List<String> sources() {
    List<String> ids = new ArrayList<>();
    if (!commonOptionId.isBlank()) ids.add(commonOptionId);
    if (conversion instanceof Conversion.MultiLookup list)
      for (var member : list.members()) ids.add(member.commonOptionId());
    return ids;
  }

  public boolean manual() {
    return transfer != null || manualReason != null;
  }
}
