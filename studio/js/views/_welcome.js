// First-run guidance for a workspace with nothing in it yet (a new product
// such as Mawadda): what to do first, in order, with links.

import { store, href } from "../store.js";
import { h } from "../ui.js";

/** True while the open workspace has no reels, posts or connections. */
export function isNewWorkspace() {
  return !store.reels.size && !store.posts.size && !store.connections.size;
}

/** A "start here" card, or null once the workspace has content. */
export function welcomeCard() {
  if (!isNewWorkspace()) return null;
  const brand = store.brand();
  const ig = store.copy("handles", {})?.instagram;
  const owner = store.isOwner();
  return h("section.card.welcome.stack", { style: { marginBottom: "18px" } },
    h("h2", { style: { margin: 0 } }, `Welcome to ${store.copy("studio_name", `${brand} Studio`)}`),
    h("p", { style: { margin: 0 } },
      `This is ${brand}'s own space: its videos, posts, accounts and numbers are kept apart from every other product in Studio.`),
    h("ol",
      h("li", h("strong", `Connect ${brand}'s Instagram`), ig && !store.copy("handles_are_samples") ? ` (${ig})` : "",
        owner ? ". Then YouTube, TikTok and the App Store when you are ready. " : ". The owner does this once. ",
        h("a", { href: href("connections") }, "Open Connections")),
      h("li", h("strong", "Plan videos"), ": planned videos arrive from the content calendar and show on the ",
        h("a", { href: href("calendar") }, "Calendar"), " and in the ", h("a", { href: href("library") }, "Library"), "."),
      h("li", h("strong", "Launch the first post"), " from ", h("a", { href: href("launch") }, "Launch"),
        ". Nothing is ever published without a person confirming it."),
      owner ? h("li", h("strong", "Check the targets"), " and the team in ", h("a", { href: href("settings") }, "Settings"), ".") : null));
}
