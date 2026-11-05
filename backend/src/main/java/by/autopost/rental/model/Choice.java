package by.autopost.rental.model;

/**
 * One option of an enum: its name on the form, its code and when the form offers it.
 *
 * @param code the native code; null when the schema does not give one
 */
public record Choice(String id, String name, Value code, Condition when) {}
