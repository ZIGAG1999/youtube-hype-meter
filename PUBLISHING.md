# Publishing on addons.mozilla.org (AMO)

Everything to paste into Mozilla's submission form, in the order the form asks.
The file to upload is `web-ext-artifacts/hype_meter_for_youtube-1.0.0.zip`.

## Steps

1. Go to https://addons.mozilla.org/developers/ and log in (or create a Mozilla account).
2. First time only: accept the **Firefox Add-on Distribution Agreement** and set a display name.
3. Click **Submit a New Add-on**.
4. **How to distribute:** choose **On this site** (gives it a public page on AMO).
5. **Upload Version:** click **Select a file…** and choose the package you built locally: `web-ext-artifacts/hype_meter_for_youtube-1.0.0.zip` (build it first with `npx web-ext build --ignore-files PUBLISHING.md .gitignore`; it isn't stored in this repo). Then click **Continue** and wait for Mozilla's automatic checks.
   - **Compatible platforms** (may appear after the upload): tick **Firefox** only. Untick **Firefox for Android** (it only works on desktop YouTube).
6. **Source code:** answer **No**. Nothing is minified or generated; the uploaded files are the source.
7. Fill in the listing with the text below, then **Submit Version**.
8. Mozilla reviews it (usually from a few hours to a few days). You'll get an email when it's approved or if they have questions.

## Listing fields

**Name**
```
Hype Meter for YouTube
```

**Summary** (max 250 characters)
```
See how many Hype points a YouTube video has, right on desktop. A small pill next to the like and dislike buttons shows YouTube's own Hype total, the same number the mobile app shows. No account, no tracking, no settings.
```

**Description**
```
YouTube's Hype feature only exists in the mobile app. On desktop you can see a video's leaderboard rank ("#14 hyped") but not how many Hype points it has. Hype Meter fills that in.

• A small pill next to the like and dislike buttons shows the video's Hype points, e.g. 1.3M.
• Hover it for the exact number and leaderboard rank, e.g. "1,359,350 Hype points · #14 on the Hype leaderboard".
• It matches YouTube's own buttons in size and color, in both light and dark mode.
• It only appears on videos that are in Hype (channels under 500K subscribers, videos from the last 7 days).

The number is YouTube's own Hype point total, not an estimate.

Privacy: the only thing it does is ask YouTube for the Hype points of the video you're watching. That request goes to youtube.com only, without your cookies, so it isn't tied to your account. Nothing is sent to the developer or anyone else, and nothing is stored.

Open source: https://github.com/ZIGAG1999/youtube-hype-meter
```

**This add-on is experimental:** leave unchecked (it's finished).

**This add-on requires payment, non-free services or software, or additional hardware:** leave unchecked.

**Categories:** Photos, Music & Videos

**Tags:** not on the submission form. Optional, and only addable later from the add-on's **Edit Product Page** (pick any that fit, e.g. youtube, video).

**Support email:** leave blank (it would be shown publicly; the support website covers it).

**Support website**
```
https://github.com/ZIGAG1999/youtube-hype-meter/issues
```

**License:** MIT License

**This add-on has a Privacy Policy:** check it, then paste this into the box that appears:
```
Hype Meter for YouTube does not collect, store, or share any personal data with the developer or any third party.

When you open a YouTube video, the extension sends that video's ID to YouTube (www.youtube.com) to look up its Hype points. The request is sent without your cookies, so YouTube cannot link it to your account. The result is kept in memory for up to 5 minutes and is never written to disk. No other data leaves your browser.
```

## Notes to reviewer

```
How the Hype number is obtained: YouTube's public Data API has no Hype data. YouTube's own mobile website (m.youtube.com) receives each video's Hype point total from YouTube's internal "youtubei/v1/next" endpoint, in an entity called "hypePointsEntity". This extension makes that same request for the video being watched (clientName "MWEB") and reads that one value.

- The request goes only to https://www.youtube.com/youtubei/v1/next, with credentials: "omit" (no cookies).
- It uses Firefox's content.fetch so the request is sent with the youtube.com origin; YouTube rejects this endpoint from a moz-extension:// origin.
- The response is parsed as JSON text; the pill is built with createElement/textContent only, no innerHTML.
- No permissions are requested. Data consent declares "browsingActivity" because the video ID is sent to YouTube.
- Nothing is minified; the submitted files are the full source. Repository: https://github.com/ZIGAG1999/youtube-hype-meter
```
