// Hype Meter for YouTube: shows a video's Hype points on the watch page.
//
// Where the number comes from: YouTube's official API has no Hype data, and the
// desktop site only gets a video's leaderboard rank. YouTube's mobile website
// does get the exact total ("hypePointsEntity"), so this asks for the video the
// way the mobile website does and reads that one value.
//
// Safety:
//  - The only request goes to www.youtube.com, sent as the YouTube page itself.
//  - It's sent WITHOUT your cookies (credentials: "omit"), so it's anonymous and
//    never tied to your account.
//  - Nothing is stored or sent anywhere else. The pill is built with textContent,
//    never innerHTML, so nothing from the response can run as code.

(() => {
  "use strict";

  const PILL_ID = "hype-meter-pill";
  // Elements older versions put on the page. Reloading or updating the
  // extension doesn't remove them, so clean them up on start.
  const LEGACY_IDS = ["hype-meter-card"];
  const CACHE_MS = 5 * 60 * 1000; // re-check a video's points at most every 5 minutes
  const CACHE_MAX = 50;           // videos remembered per tab
  const cache = new Map(); // videoId -> { time, promise } (shared by early and normal lookups)
  let current = null; // { videoId, hype } for the video on screen
  let pending = null; // videoId whose pill is being placed right now
  // After clicking a video, YouTube keeps the OLD video's button row on screen
  // for a moment. This remembers that row's like count so the new video's pill
  // isn't placed next to the old video's numbers: { text, until }.
  let staleRow = null;
  const RANK_SEARCH_MS = 15000; // how long to look for the "#14 hyped" rank

  for (const id of [...LEGACY_IDS, PILL_ID]) document.getElementById(id)?.remove();

  const videoIdFromUrl = () =>
    location.pathname === "/watch" ? new URLSearchParams(location.search).get("v") : null;

  // ---------- Reading the Hype points out of YouTube's response ----------

  // Returns the JSON object that starts at text[start] ("{"), string-aware.
  function sliceObject(text, start) {
    let depth = 0, inString = false, escaped = false;
    for (let i = start; i < text.length; i++) {
      const c = text[i];
      if (inString) {
        if (escaped) escaped = false;
        else if (c === "\\") escaped = true;
        else if (c === '"') inString = false;
      } else if (c === '"') inString = true;
      else if (c === "{") depth++;
      else if (c === "}" && --depth === 0) return text.slice(start, i + 1);
    }
    return null;
  }

  // The entity's key is base64 that contains the video id, which confirms the
  // points belong to this video and not a recommended one.
  function keyMatchesVideo(key, videoId) {
    try {
      let b64 = decodeURIComponent(key).replace(/-/g, "+").replace(/_/g, "/");
      b64 += "=".repeat((4 - (b64.length % 4)) % 4);
      return atob(b64).includes(videoId);
    } catch {
      return false;
    }
  }

  function parseHype(text, videoId) {
    const marker = '"hypePointsEntity":';
    for (let at = text.indexOf(marker); at !== -1; at = text.indexOf(marker, at + 1)) {
      const raw = sliceObject(text, at + marker.length);
      if (!raw) continue;
      let entity;
      try { entity = JSON.parse(raw); } catch { continue; }
      if (!entity.key || !keyMatchesVideo(entity.key, videoId)) continue;
      const exact = entity.expandedRollToNumber || {};
      const compact = entity.compactRollToNumber || {};
      if (!exact.value && !compact.value) continue;
      return {
        compact: compact.text || exact.text,
        exact: exact.text || compact.text,
        label: entity.hypePointsFactoidLabel || "Hype points",
      };
    }
    return null; // not in Hype (e.g. big channel, or older than 7 days)
  }

  // YouTube's web and mobile-web clients share a version number. Use the one
  // the page itself is running, so it stays current; fall back if unavailable.
  function pageClientVersion() {
    try {
      const v = window.wrappedJSObject?.ytcfg?.get?.("INNERTUBE_CLIENT_VERSION");
      if (typeof v === "string" && /^2\.\d{8}\.\d{2}\.\d{2}$/.test(v)) return v;
    } catch { /* fall through */ }
    return "2.20260925.01.00";
  }

  async function requestHype(videoId) {
    // Firefox's content.fetch sends the request as the YouTube page (youtube.com
    // origin). YouTube rejects requests from an extension's own origin.
    const request = typeof content !== "undefined" && content.fetch ? content.fetch : fetch;
    const response = await request("https://www.youtube.com/youtubei/v1/next?prettyPrint=false", {
      method: "POST",
      credentials: "omit",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        context: {
          client: {
            // YouTube's mobile website: same Hype points as the Android app,
            // in a ~25 KB download instead of ~860 KB.
            clientName: "MWEB",
            clientVersion: pageClientVersion(),
            hl: document.documentElement?.lang || navigator.language?.split("-")[0] || "en",
          },
        },
        videoId,
      }),
    });
    if (!response.ok) throw new Error(`YouTube answered ${response.status}`);
    return parseHype(await response.text(), videoId);
  }

  // One shared lookup per video: an early lookup (started when you click a
  // video) and the normal one reuse the same request instead of making two.
  function fetchHype(videoId) {
    const hit = cache.get(videoId);
    if (hit && Date.now() - hit.time < CACHE_MS) return hit.promise;
    const promise = requestHype(videoId);
    cache.set(videoId, { time: Date.now(), promise });
    // Don't remember failures (but never delete a newer lookup for the same video).
    promise.catch(() => { if (cache.get(videoId)?.promise === promise) cache.delete(videoId); });
    if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value); // drop the oldest
    return promise;
  }

  // Starts a lookup early, without waiting for the page to switch.
  function prefetch(videoId) {
    if (videoId) fetchHype(videoId).catch(() => {});
  }

  // ---------- The pill ----------

  const SVG = "http://www.w3.org/2000/svg";

  function starIcon() {
    const svg = document.createElementNS(SVG, "svg");
    svg.setAttribute("viewBox", "0 0 48 48");
    // A built-in size, so the icon stays small even if the stylesheet is
    // missing (an unstyled SVG stretches to fill the whole page).
    svg.setAttribute("width", "24");
    svg.setAttribute("height", "24");
    svg.setAttribute("aria-hidden", "true");
    svg.classList.add("hype-meter__star");
    // Rainbow tail: three parallel curves sweeping up to the star.
    for (const [color, d] of [
      ["#35C3D3", "M6 46 C 8 34, 14 25, 24 19"],
      ["#FFD43B", "M3 42 C 5 31, 11 22, 21 16"],
      ["#3DBE6A", "M1 37 C 3 27, 9 19, 18 13"],
    ]) {
      const path = document.createElementNS(SVG, "path");
      path.setAttribute("d", d);
      path.setAttribute("fill", "none");
      path.setAttribute("stroke", color);
      path.setAttribute("stroke-width", "4.5");
      path.setAttribute("stroke-linecap", "round");
      svg.appendChild(path);
    }
    const star = document.createElementNS(SVG, "path");
    star.setAttribute("d", "M31 3 L35.1 11.3 L44.3 12.7 L37.7 19.1 L39.2 28.3 L31 24 L22.8 28.3 L24.3 19.1 L17.7 12.7 L26.9 11.3 Z");
    star.setAttribute("fill", "#F59A2F");
    star.setAttribute("stroke", "#FFD43B");
    star.setAttribute("stroke-width", "2");
    star.setAttribute("stroke-linejoin", "round");
    svg.appendChild(star);
    return svg;
  }

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text) node.textContent = text;
    return node;
  }

  // YouTube shows the rank as "#14 hyped", in the description line on the
  // current desktop layout and above the title on some others.
  function leaderboardRank() {
    const meta = document.querySelector("ytd-watch-metadata");
    if (!meta) return null;
    for (const node of [
      meta.querySelector("#info-container"),
      meta.querySelector("#info"),
      meta.querySelector("#super-title"),
      meta,
    ]) {
      const match = node && node.textContent.match(/#\s*(\d+)\s*hyped/i);
      if (match) return match[1];
    }
    return null;
  }

  function tooltip(hype) {
    const rank = leaderboardRank();
    return rank
      ? `${hype.exact} ${hype.label} · #${rank} on the Hype leaderboard`
      : `${hype.exact} ${hype.label}`;
  }

  function buildPill(hype) {
    // A <span>, not a <div>: Return YouTube Dislike finds the like/dislike
    // buttons as "the first <div> in YouTube's buttons menu", and a <div>
    // pill placed there broke it.
    const pill = el("span", "hype-meter");
    pill.id = PILL_ID;
    pill.setAttribute("role", "img");
    pill.title = tooltip(hype);
    pill.setAttribute("aria-label", pill.title);
    pill.appendChild(starIcon());
    pill.appendChild(el("span", "hype-meter__points", hype.compact));
    return pill;
  }

  // The like/dislike button YouTube draws in the actions row.
  function likeButton() {
    return document.querySelector(
      "ytd-watch-metadata segmented-like-dislike-button-view-model, " +
      "ytd-watch-metadata #segmented-like-dislike-button, " +
      "ytd-watch-metadata like-button-view-model"
    );
  }

  // Copies the like/dislike button's height, vertical position and background
  // onto the pill, so it matches whatever size and style YouTube currently uses
  // (buttons have been both 36 px and 40 px tall, some with a slight gradient).
  function matchLikeButton(pill, like) {
    // Measure YouTube's actual button, not its wrapper: Return YouTube Dislike
    // draws its rating bar inside the wrapper, which would make it taller.
    const button = like.querySelector("button") || like;
    const target = button.getBoundingClientRect();
    if (!target.height) return;
    const height = Math.round(target.height);
    pill.style.height = `${height}px`;
    pill.style.borderRadius = `${height / 2}px`;
    // Copy the background and text color, so it matches in both light and dark
    // mode, but not while you're hovering the like button (that would copy
    // its hover colors).
    if (button !== like && !button.matches(":hover")) {
      const s = getComputedStyle(button);
      pill.style.backgroundColor = s.backgroundColor;
      pill.style.backgroundImage = s.backgroundImage;
      pill.style.color = s.color;
    }
    // Line it up with the like button. Only for small offsets: a big one means
    // the row wrapped onto two lines (narrow window), and "correcting" that
    // would push the pill far out of place, so reset instead.
    const margin = parseFloat(pill.style.marginTop) || 0;
    const offset = target.top - pill.getBoundingClientRect().top;
    if (Math.abs(margin + offset) <= height / 2) {
      if (Math.abs(offset) >= 0.5) pill.style.marginTop = `${margin + offset}px`;
    } else {
      pill.style.marginTop = "";
    }
  }

  // Adds the rank to the tooltip once YouTube has drawn it, then stops looking.
  // Time-limited rather than count-limited: YouTube can change the page dozens
  // of times before it draws the rank. Not every video has a rank.
  function refreshTooltip(pill) {
    if (current.rankFound || Date.now() > current.rankDeadline) return;
    pill.title = tooltip(current.hype);
    pill.setAttribute("aria-label", pill.title);
    current.rankFound = pill.title.includes("leaderboard");
  }

  function likeCountText(like) {
    return (like.textContent || "").replace(/\s+/g, " ").trim();
  }

  // Re-measures and re-colors an existing pill (theme switch, window resize).
  function rematch() {
    const pill = document.getElementById(PILL_ID);
    const like = likeButton();
    if (pill && like) matchLikeButton(pill, like);
  }

  // Puts the pill just left of the like/dislike button. Returns true if placed.
  // Cheap when the pill is already there: no measuring, which would force the
  // browser to redo the page layout on every change while the page loads.
  function place() {
    if (!current || current.videoId !== videoIdFromUrl()) return false;
    const existing = document.getElementById(PILL_ID);
    if (existing) {
      refreshTooltip(existing);
      return true;
    }
    const like = likeButton();
    if (!like) return false;
    // Still the previous video's row (same like count as when you clicked)?
    // Wait for YouTube to swap in the new one, but never more than a few seconds.
    if (staleRow) {
      if (Date.now() < staleRow.until && likeCountText(like) === staleRow.text) return false;
      staleRow = null;
    }
    // Go just outside the buttons group that holds like/dislike, not inside
    // it: extensions like Return YouTube Dislike size their rating bar to that
    // group, and a pill inside it stretched their bar under the pill.
    // Only do that if the group's parent lays things out in a row; otherwise
    // fall back to sitting next to the like button inside the group.
    const group = like.closest("#top-level-buttons-computed");
    const parent = group && group.parentElement;
    const rowLayout = parent && /flex/.test(getComputedStyle(parent).display);
    const pill = buildPill(current.hype);
    if (group && rowLayout) {
      group.before(pill);
    } else {
      (like.closest("#top-level-buttons-computed > *") || like).before(pill);
    }
    matchLikeButton(pill, like);
    refreshTooltip(pill);
    return true;
  }

  // YouTube redraws the buttons row now and then (e.g. after liking), which
  // can remove the pill; put it back when that happens.
  let placeQueued = false;
  const observer = new MutationObserver(() => {
    if (placeQueued || !current) return;
    placeQueued = true;
    requestAnimationFrame(() => { placeQueued = false; place(); });
  });

  function clear() {
    current = null;
    observer.disconnect();
    document.getElementById(PILL_ID)?.remove();
  }

  async function update() {
    const videoId = videoIdFromUrl();
    if (!videoId) { pending = null; return clear(); }
    if (current && current.videoId === videoId && document.getElementById(PILL_ID)) return;
    if (pending === videoId) return; // already placing this video's pill
    clear();
    pending = videoId;

    let hype;
    try {
      hype = await fetchHype(videoId);
    } catch (e) {
      console.debug("[Hype Meter]", e);
      if (pending === videoId) pending = null;
      return;
    }
    // The user may have moved to another video while this was loading.
    if (!hype || videoIdFromUrl() !== videoId || pending !== videoId) {
      if (pending === videoId) pending = null;
      return;
    }

    current = { videoId, hype, rankFound: false, rankDeadline: Date.now() + RANK_SEARCH_MS };
    // Wait for YouTube to draw the like button (up to ~30 s: on a full reload
    // it can take several seconds), then keep watching.
    for (let i = 0; i < 120 && !place(); i++) {
      await new Promise((r) => setTimeout(r, 250));
      if (!current || current.videoId !== videoId) return;
    }
    if (pending === videoId) pending = null;
    const meta = document.querySelector("ytd-watch-metadata");
    if (meta) observer.observe(meta, { childList: true, subtree: true });
  }

  // Switching between light and dark mode: YouTube toggles the "dark"
  // attribute on <html>, and the like button's colors change with it. Wait a
  // frame for YouTube's new colors to apply, then re-match them.
  function watchTheme() {
    new MutationObserver(() => {
      if (current) requestAnimationFrame(() => requestAnimationFrame(rematch));
    }).observe(document.documentElement, { attributes: true, attributeFilter: ["dark"] });
  }
  // Normally <html> exists by now; wait for it just in case.
  if (document.documentElement) watchTheme();
  else document.addEventListener("DOMContentLoaded", watchTheme, { once: true });

  // The buttons can change size with the window (e.g. YouTube's compact layout).
  let resizeQueued = false;
  window.addEventListener("resize", () => {
    if (resizeQueued || !current) return;
    resizeQueued = true;
    setTimeout(() => { resizeQueued = false; rematch(); }, 200);
  });

  // Clicking a video: YouTube announces the navigation before it switches
  // pages, so start the lookup right away. By the time the new page draws its
  // buttons, the number is usually already here.
  document.addEventListener("yt-navigate-start", (event) => {
    const detail = event.detail || {};
    let videoId = detail.endpoint?.watchEndpoint?.videoId;
    if (!videoId && typeof detail.url === "string") {
      try {
        const url = new URL(detail.url, location.origin);
        if (url.pathname === "/watch") videoId = url.searchParams.get("v");
      } catch { /* not a video link */ }
    }
    prefetch(videoId);
    // Remember the current row's like count, so the next video's pill waits
    // until YouTube actually replaces this row (see place()).
    const like = videoId && likeButton();
    staleRow = like ? { text: likeCountText(like), until: Date.now() + 4000 } : null;
  });

  // YouTube changes videos without reloading the page.
  document.addEventListener("yt-navigate-finish", update);
  window.addEventListener("popstate", update);

  // Full page load: this runs once the page's initial load is done, so the
  // lookup never competes with YouTube's own first requests. That's still
  // early enough: timed in recordings, the number arrives within ~2 s, while
  // YouTube takes 3-5 s to draw the button row the pill sits in.
  update();
})();
