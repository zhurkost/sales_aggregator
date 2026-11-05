package by.autopost.rental.engine;

import java.util.ArrayList;
import java.util.List;
import java.util.function.UnaryOperator;

/** The remarks of one preparation, in order; one remark per field and code. */
public final class Issues {
  private final List<Issue> issues = new ArrayList<>();

  /** Adds the remark unless the field already has one with this code. */
  public void add(String field, String code, String message) {
    if (issues.stream().noneMatch(i -> i.field().equals(field) && i.code().equals(code)))
      issues.add(new Issue(field, null, code, message));
  }

  /** Adds a remark that names the part of the card to correct. */
  public void add(Issue issue) {
    issues.add(issue);
  }

  public boolean has(String field) {
    return issues.stream().anyMatch(i -> i.field().equals(field));
  }

  public void remove(String field) {
    issues.removeIf(i -> i.field().equals(field));
  }

  public void remove(String field, String code) {
    issues.removeIf(i -> i.field().equals(field) && i.code().equals(code));
  }

  public void replaceAll(UnaryOperator<Issue> change) {
    issues.replaceAll(change);
  }

  public boolean isEmpty() {
    return issues.isEmpty();
  }

  public List<Issue> list() {
    return List.copyOf(issues);
  }
}
