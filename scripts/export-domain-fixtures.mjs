import { mkdirSync, writeFileSync } from "node:fs";
import { sanitizeListing, emptyListing } from "../lib/listing.ts";
import { categories } from "../lib/taxonomy.ts";
import { extensionRecipe } from "../lib/extension-config.ts";
import { getPlatforms } from "../lib/platforms.ts";
import {
  categoryFields,
  cleanAttributes,
  descriptionWithAttributes,
} from "../lib/attributes.ts";
const fixtures = categories.map((cat) => {
  const listing = sanitizeListing({
    ...emptyListing,
    taxonomyId: cat.id,
    category: cat.group,
    title: "Тестовый товар",
    description: "Описание продавца",
    brand: "Volkswagen",
    model: "Passat",
    year: "2018",
    price: "100",
    currency: "BYN",
    condition: "Б/у",
  });
  const attributes = {};
  for (const field of categoryFields(listing, attributes))
    if (field.options.length) attributes[field.key] = field.options[0][0];
  const input = {
    listing,
    attributes,
    categoryOverrides: {},
    platforms: getPlatforms(cat.group).map((p) => ({ id: p.id })),
  };
  return {
    input,
    recipe: extensionRecipe(input),
    attributes: cleanAttributes(listing, attributes),
    description: descriptionWithAttributes(listing, attributes),
  };
});
mkdirSync("backend/src/test/resources", { recursive: true });
writeFileSync(
  "backend/src/test/resources/domain-contracts.json",
  JSON.stringify(fixtures, null, 2) + "\n",
);
