# Forumopolis — First Unread

Tampermonkey userscript for [Forumopolis](https://www.forumopolis.com/) forum **f=2** (vBulletin 3.8).

## Features

- **First Unread** link on each thread row (pagination area or after the title on single-page threads)
- **Favorites** — star threads into a separate table above the main list; favorited rows are hidden from the main list
- **Open unread** — opens first-unread URLs for all favorites in a tab group (requires [Tampermonkey Tabbed Group Extender](https://github.com/brperry/tampermonkey-tabbed-group-extender))
- Favorites sort by last-post activity, matching the forum’s natural order when threads are on the current page

## Install

1. Install [Tampermonkey](https://www.tampermonkey.net/) in your browser.
2. For grouped tab opening, install **Tampermonkey Tabbed Group Extender** from the link above.
3. Create a new userscript in Tampermonkey and paste the contents of `forumopolis-first-unread.user.js`, or install from the raw file on GitHub.

## Usage

Open `forumdisplay.php?f=2`. Use the checkbox on each thread to add or remove favorites. The favorites header includes **Open unread** to launch first-unread links in a background tab group.

Favorites are stored in `localStorage` under the key `fo-forum-favorites-f2`.

## Requirements

- Tampermonkey
- Optional: Tampermonkey Tabbed Group Extender (for tab-group open; falls back to `GM_openInTab` without it)
