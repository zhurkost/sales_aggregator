ONLINER — CARS_USED_SALE — RESEARCH ONLY

Run from the repository root (Node.js 22+, no Selenium/dependencies):
  node scripts/research/onliner-cars/collect.mjs
  node scripts/research/onliner-cars/geography.mjs
  node scripts/research/onliner-cars/normalize.mjs
  node scripts/research/onliner-cars/validate.mjs
  node --test scripts/research/onliner-cars/research.test.mjs

collect reads the public endpoints actually used by the creation form:
  GET https://ab.onliner.by/sdapi/ab.api/dictionaries
  GET .../manufacturers/{manufacturer_id}
  GET .../manufacturers/{manufacturer_id}/models/{model_id}
One model response contains ALL generations. No year query/loop/filter.
Generation year/images are stripped before caching. Native IDs/names retained.
Initial full run: 3007 requests, 233 makes, 2773 models, 6614 generations.
Sequential requests, minimum 600 ms between starts, retry/backoff on 429/503,
30-second timeout, abort on errors. No credentials or authenticated API required.

Cache/checkpoints: work/onliner-cars-used/ (ignored by Git).
To resume, run collect again. It validates and reuses SHA256-checked cache.
To refresh, choose a NEW directory with collect({directory:...}) and inspect
the new result before replacing artifacts. Never label stale cache a fresh crawl.
The default normalizer reads work/onliner-cars-used.
Geography collection is explicitly limited to Belarus: 6 regions, 155 cities.
Other countries remain in source dictionaries, outside this geographic scope.

Browser research used the user's authenticated Chrome, private-seller form:
tech -> exterior -> cost -> contacts, without final submission.
Sanitized DOM snapshots/tests in data/parsing/cars_used_sale/evidence/onliner-*.
No account cookies, passwords, telephone values or uploaded image URLs saved.
The synthetic PNG is a research fixture, not a vehicle advertisement.
Photo follow-up: PNG+JPEG batch and a later PNG were accepted (0 -> 2 -> 3).
See evidence/onliner-photo-review.json and photo-review.mjs. Accepted cards use
the primary class; the three initial secondary cards are placeholders. The
binding verifies CSS background-image, server load and remaining-capacity count.
This research verifier is not a production-extension implementation.
Phone follow-up: evidence/onliner-phone-review.json covers formatting, repeat,
1-5 rows, preserving the secondary number, optional phone in chat mode and
restoration. The binding fills ONLY the primary row; extra numbers stay manual.
Prepare a phone string containing digits and + without formatting separators.
No publication, SMS confirmation or account-setting change was performed.
Year follow-up: evidence/onliner-year-review.json covers both control types,
repeat and crossing the buttons/select boundary. year-review.mjs models exact
candidate resolution. No year ranges/lists are stored in the category tree.
The year binding depends on model; generation depends on model and year.
Mixed choose/native-option handling is specified in parsing_format_rule.txt;
production runtime support is still a separate integration task.

Normalization takes authoritative dictionary IDs, checks them against DOM option
labels/counts, builds Category[] and a separate one-record-per-field binding.
Only make/model/generation and country/region/city use childOptions.
Equipment lists are flat enum/multi_enum; no per-year generation trees.
No finalId, inferred cross-site IDs or automatic renaming of FB/QB to IV/III.

This does NOT change the production app/extension and does NOT perform stage B
(common/mapping). Read report_cars_used_sale_onliner.txt for readiness limits.
