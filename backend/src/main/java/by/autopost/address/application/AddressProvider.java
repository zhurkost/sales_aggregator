package by.autopost.address.application;

import com.fasterxml.jackson.databind.JsonNode;

/** Address lookup port, independent of HTTP and provider credentials. */
public interface AddressProvider {
  boolean configured();

  JsonNode fetch(String query, int count);
}
