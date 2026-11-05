package by.autopost.rental.application;

import by.autopost.rental.catalog.ReferenceRepository;
import by.autopost.rental.catalog.ReferenceSnapshot;
import by.autopost.rental.engine.CardChecks;
import by.autopost.rental.engine.CardTransfer;
import by.autopost.rental.engine.Issue;
import by.autopost.rental.engine.PreparationEngine;
import by.autopost.rental.engine.PreparationEngine.Preparation;
import by.autopost.rental.model.Card;
import by.autopost.rental.model.Condition.Truth;
import by.autopost.rental.model.FieldDef;
import by.autopost.rental.model.FieldType;
import by.autopost.rental.model.Schema;
import by.autopost.shared.ApiException;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import org.springframework.stereotype.Service;

/** Application boundary of the reference bundle: the editor, the check and the launch of a card. */
@Service
public class RentalCatalog {
  private final ReferenceRepository references;

  public RentalCatalog(ReferenceRepository references) {
    this.references = references;
  }

  /** The bundle of this release, for the AI and the commands. */
  public ReferenceSnapshot reference() {
    return references.snapshot();
  }

  public EditorSchema editor() {
    return EditorSchema.of(references.snapshot());
  }

  /** Version of the card model the editor shows; a card stores the one it was edited under. */
  public String cardVersion() {
    return references.snapshot().cardVersion();
  }

  /** Version of the plans and recipes; a launch keeps the one it was compiled with. */
  public String integrationVersion() {
    return references.snapshot().integrationVersion();
  }

  /** The address of the platform's form, from its recipe. */
  public String formUrl(String platform) {
    return references.snapshot().form(platform).startUrl();
  }

  /**
   * «Обновить поля карточки»: a card of the current model keeps its data and is checked against
   * the current rules from now on; this is the card version it gets. Older cards are converted only
   * by --migrate-rental-drafts.
   */
  public String acceptRules(Card card) {
    Cards.requireCurrent(card);
    return references.snapshot().cardVersion();
  }

  /** The check of a card that has {@code photos} photos stored with it. */
  public CardCheck prepare(Card card, int photos) {
    var checked = check(references.snapshot(), card, photos);
    return new CardCheck(checked.stream().map(Checked::check).toList());
  }

  /** The jobs of a launch of a saved card. */
  public ExtensionLaunch browser(Card card, int photos) {
    ReferenceSnapshot snapshot = references.snapshot();
    return new RentalBrowserPreparation().compile(snapshot, check(snapshot, card, photos), card);
  }

  /**
   * The card fields the editor shows: a field is shown when no platform maps it, or when a native
   * field it fills on a chosen platform applies with the card's values (or is still unknown). The
   * same preparation decides it as the check, for any card version.
   */
  public FieldStates fields(Card card) {
    Cards.requireCurrent(card);
    ReferenceSnapshot snapshot = references.snapshot();
    var values = CardChecks.values(card, snapshot.card());
    Map<String, Preparation> chosen = new HashMap<>();
    for (String platform : new LinkedHashSet<>(card.platforms()))
      if (snapshot.platforms().contains(platform))
        chosen.put(
            platform,
            new PreparationEngine()
                .prepare(
                    snapshot.schema(platform), snapshot.plan(platform), values, card.address()));
    List<FieldStates.FieldState> states = new ArrayList<>();
    for (var group : snapshot.cardGroups())
      for (var field : group.options()) {
        if (field.type() == FieldType.CHOICE) continue;
        boolean mapped = false, visible = false, required = false, transferred = false;
        for (String platform : snapshot.platforms())
          for (var rule : snapshot.plan(platform).fields()) {
            if (!rule.sources().contains(field.id())) continue;
            mapped = true;
            var prepared = chosen.get(platform);
            if (prepared == null) continue;
            String target = rule.platformOptionId();
            Truth applies = prepared.applies().getOrDefault(target, Truth.YES);
            visible |= applies != Truth.NO;
            required |=
                applies == Truth.YES
                    && field.id().equals(rule.commonOptionId())
                    && snapshot.schema(platform).field(target).required();
            transferred |= snapshot.coverage(platform).needed().contains(target);
          }
        if (!mapped || visible)
          states.add(
              new FieldStates.FieldState(
                  field.id(),
                  required,
                  !mapped || transferred,
                  snapshot.card().choices(field.id())));
      }
    return new FieldStates(states);
  }

  /** The check of one platform and the preparation it was made from. */
  record Checked(CardCheck.PlatformCheck check, Preparation preparation) {}

  /**
   * Only the card model is compared: plans, schemas and browser recipes may change under an open
   * card, the card's values keep their meaning and are prepared with the current rules.
   */
  private List<Checked> check(ReferenceSnapshot snapshot, Card card, int photos) {
    if (!card.cardVersion().equals(snapshot.cardVersion()))
      throw new ApiException(409, "Правила обновились. Обновите поля карточки.");
    Cards.requireCurrent(card);
    var values = CardChecks.values(card, snapshot.card());
    var selected = card.platforms();
    if (selected.isEmpty() || selected.size() > snapshot.platforms().size())
      throw new ApiException(400, "Выберите доступные площадки.");
    List<Checked> output = new ArrayList<>();
    for (String platform : new LinkedHashSet<>(selected)) {
      var schema = snapshot.schema(platform);
      var plan = snapshot.plan(platform);
      var prepared = new PreparationEngine().prepare(schema, plan, values, card.address());
      var photoFields = photoFields(snapshot, platform);
      var issues =
          new ArrayList<>(
              CardChecks.annotate(
                  requirePhotos(prepared.issues(), schema, photoFields, photos), plan, card));
      // What the form receives and what the user enters there: the check shows both.
      var transfer =
          snapshot
              .coverage(platform)
              .transfer(prepared.values(), card.address(), schema, plan, values);
      var form = new ArrayList<CardTransfer.FormValue>();
      for (var value : transfer.form()) if (!photoFields.contains(value.field())) form.add(value);
      if (photos > 0)
        for (String field : photoFields)
          form.add(
              new CardTransfer.FormValue(field, schema.field(field).name(), photos + " фото"));
      // An automatic submission would publish the ad without the values entered by hand.
      if (!transfer.manual().isEmpty())
        issues.add(
            new Issue(
                "",
                "",
                "manual_fields",
                "Часть заполненных полей нужно ввести на площадке вручную — автоматическая"
                    + " подача выключена."));
      output.add(
          new Checked(
              new CardCheck.PlatformCheck(
                  platform,
                  prepared.values(),
                  List.copyOf(issues),
                  issues.isEmpty(),
                  form,
                  transfer.manual()),
              prepared));
    }
    return output;
  }

  /** The fields the extension puts the stored photos into: the recipe's file inputs. */
  private static List<String> photoFields(ReferenceSnapshot snapshot, String platform) {
    var fields = new ArrayList<String>();
    for (var control : snapshot.form(platform).controlList())
      if (control.action().equals("files")) fields.add(control.field());
    return fields;
  }

  /**
   * A photo field is filled from the photos stored with the card, not from the links in the card:
   * the plan's own «required» remark on it is replaced by this one. A platform whose schema
   * requires the field gets the remark when the card has no photo, instead of a launch without
   * photos.
   */
  private static List<Issue> requirePhotos(
      List<Issue> prepared, Schema schema, List<String> photoFields, int photos) {
    List<Issue> issues = new ArrayList<>(prepared);
    for (String field : photoFields) {
      issues.removeIf(i -> i.field().equals(field) && i.code().equals("required"));
      FieldDef definition = schema.field(field);
      if (photos == 0 && definition.required())
        issues.add(
            new Issue(
                field,
                "photos",
                "photos_required",
                "Добавьте фотографии квартиры: площадка не публикует объявление без фото."));
    }
    return issues;
  }
}
