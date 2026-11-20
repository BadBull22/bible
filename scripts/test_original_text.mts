// Hebrew and Greek words as text (which language, vowel points, the marks in the interlinear data). Run: node --no-warnings --experimental-strip-types scripts/test_original_text.mts
import assert from "node:assert/strict";
import { hasHebrewPoints, languageOf, speakable, tidyOriginal } from "../src/originalText.ts";

assert.equal(languageOf("ἀφίημι"), "grc");
assert.equal(languageOf("Ἰησοῦς"), "grc");
assert.equal(languageOf("אָהַב"), "he");
assert.equal(languageOf("love"), null);
assert.equal(languageOf(""), null);
assert.ok(hasHebrewPoints("אָהַב") && !hasHebrewPoints("אהב") && !hasHebrewPoints("ἀγάπη"));
// the interlinear's morpheme marks are not part of the word; the maqaf that joins two words is only a joint when said
assert.equal(tidyOriginal("ו/לֹא־\\"), "ולֹא־");
assert.equal(tidyOriginal("ἄφες"), "ἄφες");
assert.equal(speakable("ו/לֹא־\\"), "ולֹא");
assert.equal(speakable("עַל־פְּנֵי"), "עַל פְּנֵי", "a maqaf becomes a space");
console.log("original text: all passed");
