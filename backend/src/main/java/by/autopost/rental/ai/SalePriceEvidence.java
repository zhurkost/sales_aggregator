package by.autopost.rental.ai;

import java.math.BigDecimal;
import java.util.regex.Pattern;

/** Checks the context of the quoted amount in the original sale listing. */
final class SalePriceEvidence {
  private static final Pattern NUMBER = Pattern.compile("(?<!\\d)\\d+(?: \\d{3})*(?:[.,]\\d+)?(?!\\d)");
  private static final String METRE = "(?:1\\s*)?(?:м[²2]|кв\\.?\\s*м|квадрат\\p{L}*)";
  private static final Pattern BEFORE = Pattern.compile(
      "(?:комисси[яию]|задаток|аванс|первоначальный взнос|ежемесячный плат[её]ж|(?:за|/)\\s*" + METRE + ")\\s*[:—–=\\-]?\\s*(?:от\\s*)?$");
  private static final Pattern AFTER = Pattern.compile(
      "^\\s*(?:(?:usd|byn|rub|eur|[$€]|доллар\\p{L}*|руб\\p{L}*\\.?)\\s*)?(?:[/]\\s*" + METRE + "|за\\s+" + METRE + "|в месяц|/\\s*мес|ежемесячно)");

  static boolean supports(String source, String quote, String amount) {
    String text = RentalAiPolicy.normalized(source), fragment = RentalAiPolicy.normalized(quote);
    BigDecimal expected = new BigDecimal(amount);
    if (expected.signum() <= 0 || fragment.isEmpty()) return false;
    // Check the complete token in the source; the model may quote just "1 700 USD".
    var matcher = NUMBER.matcher(text);
    while (matcher.find()) {
      if (new BigDecimal(matcher.group().replace(" ", "").replace(',', '.')).compareTo(expected) != 0) continue;
      int offset = text.indexOf(fragment, Math.max(0, matcher.end() - fragment.length()));
      if (offset < 0 || offset > matcher.start()) continue;
      String before = text.substring(Math.max(0, matcher.start() - 80), matcher.start());
      String after = text.substring(matcher.end(), Math.min(text.length(), matcher.end() + 80));
      if (!BEFORE.matcher(before).find() && !AFTER.matcher(after).find()) return true;
    }
    return false;
  }

  private SalePriceEvidence() {}
}
