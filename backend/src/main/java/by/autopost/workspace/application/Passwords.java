package by.autopost.workspace.application;

import java.nio.charset.StandardCharsets;
import java.util.HexFormat;
import org.bouncycastle.crypto.generators.SCrypt;

public final class Passwords {
  private Passwords() {}

  /** Keep the original Node scrypt parameters so existing accounts remain usable. */
  public static String derive(String password, String salt) {
    return HexFormat.of()
        .formatHex(
            SCrypt.generate(
                password.getBytes(StandardCharsets.UTF_8),
                salt.getBytes(StandardCharsets.UTF_8),
                16384,
                8,
                1,
                64));
  }
}
