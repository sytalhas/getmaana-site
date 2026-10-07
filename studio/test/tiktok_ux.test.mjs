// node --test studio/test/
import test from "node:test";
import assert from "node:assert/strict";
import { emptyUx, disclosurePrompt, declaration, privacyChoices, uxProblems, toOptions } from "../js/tiktok_ux.js";

const creator = {
  direct_post: true, audited: true, can_post: true, creator_nickname: "Maana",
  privacy_level_options: ["PUBLIC_TO_EVERYONE", "MUTUAL_FOLLOW_FRIENDS", "SELF_ONLY"], comment_disabled: false, duet_disabled: false,
  stitch_disabled: true, max_video_post_duration_sec: 60,
};

test("nothing is chosen or on by default, and privacy must be picked", () => {
  const ux = emptyUx();
  assert.equal(ux.privacy_level, "");
  assert.ok(!ux.allow_comment && !ux.allow_duet && !ux.allow_stitch && !ux.disclose);
  assert.deepEqual(uxProblems(ux, creator), ["Choose who can see this post."]);
  assert.deepEqual(uxProblems({ ...ux, privacy_level: "PUBLIC_TO_EVERYONE" }, creator), []);
  assert.deepEqual(uxProblems({ ...ux, privacy_level: "FOLLOWER_OF_CREATOR" }, creator), ["That privacy option is not available for this account."]);
});

test("disclosure: on needs a choice; the label prompt and the declaration follow TikTok's wording", () => {
  const base = { ...emptyUx(), privacy_level: "PUBLIC_TO_EVERYONE", disclose: true };
  assert.match(uxProblems(base, creator)[0], /Your brand, Branded content or both/);
  assert.equal(disclosurePrompt({ ...base, brand_organic: true }, "photo"), 'Your photo will be labeled as "Promotional content".');
  assert.equal(disclosurePrompt({ ...base, branded_content: true }), 'Your video will be labeled as "Paid partnership".');
  assert.equal(disclosurePrompt({ ...base, brand_organic: true, branded_content: true }), 'Your video will be labeled as "Paid partnership".');
  assert.equal(disclosurePrompt({ ...base, disclose: false }), null);
  assert.equal(declaration({ ...base, brand_organic: true }), "By posting, you agree to TikTok's Music Usage Confirmation.");
  assert.equal(declaration({ ...base, branded_content: true }), "By posting, you agree to TikTok's Branded Content Policy and Music Usage Confirmation.");
});

test("branded content cannot be private: Only me is greyed out, and the pair is refused", () => {
  const ux = { ...emptyUx(), disclose: true, branded_content: true };
  assert.equal(privacyChoices(creator, ux).find((o) => o.value === "SELF_ONLY").disabled, true);
  assert.equal(privacyChoices(creator, emptyUx()).find((o) => o.value === "SELF_ONLY").disabled, false);
  assert.ok(uxProblems({ ...ux, privacy_level: "SELF_ONLY" }, creator).includes("Visibility for branded content can't be private."));
});

test("an account that cannot post stops the screen; a video over the account's limit is refused", () => {
  assert.match(uxProblems(emptyUx(), { ...creator, can_post: false, message: "Too many posts today." })[0], /cannot post right now/);
  const ux = { ...emptyUx(), privacy_level: "SELF_ONLY" };
  assert.match(uxProblems(ux, creator, { kind: "video", durationS: 75 })[0], /at most 60 s/);
  assert.deepEqual(uxProblems(ux, creator, { kind: "photo", durationS: 75 }), []);
});

test("stored options: interactions the account disables stay off; photos carry comments only", () => {
  const ux = { ...emptyUx(), privacy_level: "PUBLIC_TO_EVERYONE", allow_comment: true, allow_duet: true, allow_stitch: true, disclose: true, brand_organic: true };
  assert.deepEqual(toOptions(ux, creator, "video"), {
    privacy_level: "PUBLIC_TO_EVERYONE", allow_comment: true, allow_duet: true, allow_stitch: false, disclose: true,
    brand_organic: true, branded_content: false, declaration: "By posting, you agree to TikTok's Music Usage Confirmation.", creator: "Maana",
  });
  const photo = toOptions(ux, creator, "photo");
  assert.ok(!("allow_duet" in photo) && !("allow_stitch" in photo));
});
