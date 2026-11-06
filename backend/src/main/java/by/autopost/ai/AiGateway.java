package by.autopost.ai;

import com.fasterxml.jackson.databind.node.ObjectNode;

public interface AiGateway {
  String model();

  ObjectNode serverJson(String identity, String prompt, String source);
}
