package by.autopost.automotive.application;
import com.fasterxml.jackson.databind.JsonNode;
/** Read-only versioned catalogue port; application services never access files. */
public interface CarReference { JsonNode data(); }
