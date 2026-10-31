package by.autopost;

final class ApiException extends RuntimeException {
  final int status;
  final String code;

  ApiException(int status, String message) {
    this(status, message, null);
  }

  ApiException(int status, String message, String code) {
    super(message);
    this.status = status;
    this.code = code;
  }
}
