import { mkdirSync, writeFileSync } from "node:fs";
import {
  emptyListing,
  fields,
  partFields,
  generalFields,
} from "../lib/listing.ts";
import {
  getPlatforms,
  statusLabel,
  remoteStatusLabel,
} from "../lib/platforms.ts";
import { classificationPrompt } from "../lib/taxonomy.ts";
import { systemPrompt } from "../lib/ai-prompt.ts";
import { identificationPrompt } from "../lib/price-identification.ts";
import { baseFieldKeys } from "../lib/field-rules.ts";
const groups = ["cars", "parts", "general"];
mkdirSync("backend/src/main/resources", { recursive: true });
writeFileSync(
  "backend/src/main/resources/domain.json",
  JSON.stringify(
    {
      emptyListing,
      fields,
      partFields,
      generalFields,
      baseFieldKeys,
      statusLabel,
      remoteStatusLabel,
      platforms: Object.fromEntries(groups.map((g) => [g, getPlatforms(g)])),
      prompts: {
        classify: classificationPrompt(),
        identify: identificationPrompt,
        ...Object.fromEntries(groups.map((g) => [g, systemPrompt(g)])),
      },
    },
    null,
    2,
  ) + "\n",
);
