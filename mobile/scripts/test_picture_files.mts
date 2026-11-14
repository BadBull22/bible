// The helpers behind "Pictures from the computer". Run: node --experimental-strip-types mobile/scripts/test_computer_pictures.mts
import assert from "node:assert/strict";
import { countText, isVideo, savedText, shareMime, sizeText, titleOf } from "../src/pictureFiles.ts";

const pic = { id: "1", name: "John 3-16 Square 1080x1080.png", mime: "image/png", size: 1500000, modified: 1 };
const vid = { id: "2", name: "Week.mp4", mime: "video/mp4", size: 9000, modified: 2 };
assert.equal(isVideo(vid), true);
assert.equal(isVideo(pic), false);
assert.equal(titleOf(pic.name), "John 3-16 Square 1080x1080");
assert.equal(titleOf("noending"), "noending");
assert.equal(sizeText(1500000), "1.4 MB");
assert.equal(sizeText(820 * 1024), "820 KB");
assert.equal(sizeText(10), "1 KB");
assert.equal(sizeText(0), "");
assert.equal(shareMime([pic, pic]), "image/*");
assert.equal(shareMime([vid]), "video/*");
assert.equal(shareMime([pic, vid]), "*/*");
assert.equal(shareMime([]), "*/*");
assert.equal(countText([pic, pic, vid]), "2 pictures and 1 video");
assert.equal(countText([pic]), "1 picture");
assert.equal(countText([]), "");
assert.equal(savedText(2, 1, "Pictures/Bible Concordance"), "Saved 2 to Pictures/Bible Concordance; 1 was already saved.");
assert.equal(savedText(0, 3, "x"), "3 were already saved.");
assert.equal(savedText(0, 0, "x"), "Nothing to save.");
console.log("computer pictures: all checks passed");
