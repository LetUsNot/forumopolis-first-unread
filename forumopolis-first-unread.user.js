// ==UserScript==
// @name         Forumopolis - First Unread Link
// @version      2.6
// @description  First Unread links, favorites table, and grouped unread opener on forum f=2
// @match        https://www.forumopolis.com/forumdisplay.php*
// @match        http://www.forumopolis.com/forumdisplay.php*
// @grant        GM_openInTab
// @grant        GM.openInTab
// @grant        unsafeWindow
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  const LINK_CLASS = 'fo-first-unread-link';
  const CHECKBOX_CLASS = 'fo-favorite-checkbox';
  const HIDDEN_MAIN_CLASS = 'fo-hidden-main-favorite';
  const OPEN_UNREAD_BTN_CLASS = 'fo-open-favorites-unread-btn';
  const FAVORITES_WRAP_ID = 'fo-favorites-wrap';
  const FAVORITES_TBODY_ID = 'fo-favorites-tbody';
  const STORAGE_KEY = 'fo-forum-favorites-f2';
  const TARGET_FORUM_ID = '2';
  const TAB_DELAY_MS = 200;
  const TMTGE_EVENT_OPEN = 'tampermonkey-tabbed-group-extender:open';
  const TMTGE_EVENT_CREATE_GROUP = 'tampermonkey-tabbed-group-extender:create-group';
  const TMTGE_EVENT_RESULT = 'tampermonkey-tabbed-group-extender:result';

  const GM_TAB_OPTIONS = {
    active: false,
    insert: true,
    setParent: true,
    loadInBackground: true,
  };

  function isTargetForum() {
    return new URLSearchParams(location.search).get('f') === TARGET_FORUM_ID;
  }

  function resolveUrl(href) {
    try {
      return new URL(href, location.href).href;
    } catch {
      return null;
    }
  }

  function getPageNumber(href) {
    const match = href.match(/[?&]page=(\d+)/i);
    return match ? parseInt(match[1], 10) : null;
  }

  function isMainThreadLink(anchor) {
    const href = anchor.getAttribute('href') || '';
    return (
      href.includes('showthread.php') &&
      !href.includes('goto=newpost') &&
      !href.includes('page=') &&
      !href.includes('do=whoposted')
    );
  }

  function getTitleLink(row) {
    const byId = row.querySelector('a[id^="thread_title_"][href*="showthread.php"]');
    if (byId) return byId;

    for (const anchor of row.querySelectorAll('a[href*="showthread.php"]')) {
      if (isMainThreadLink(anchor)) return anchor;
    }

    return null;
  }

  function getTitleCell(row) {
    const titleLink = getTitleLink(row);
    if (!titleLink) return null;

    for (const cell of row.cells) {
      if (cell.contains(titleLink)) return cell;
    }

    return titleLink.closest('td');
  }

  function getAttachmentIcon(row) {
    for (const img of row.querySelectorAll('img')) {
      const src = (img.getAttribute('src') || '').toLowerCase();
      const alt = (img.getAttribute('alt') || '').toLowerCase();

      if (
        src.includes('paperclip') ||
        src.includes('clip.gif') ||
        src.includes('clip.png') ||
        src.includes('attach') ||
        alt.includes('attachment') ||
        alt.includes('paperclip')
      ) {
        return img;
      }
    }

    return null;
  }

  function getMainListTable() {
    const row = document.querySelector('tbody[id^="threadbits"] tr[id^="thread_"]');
    return row?.closest('table') || null;
  }

  function getMainThreadRows() {
    const table = getMainListTable();
    if (table) {
      const rows = [...table.querySelectorAll('tbody[id^="threadbits"] tr[id^="thread_"]')];
      if (rows.length > 0) return rows;
    }

    return getThreadRows().filter((row) => !row.closest(`#${FAVORITES_WRAP_ID}`));
  }

  const CHECKBOX_SLOT_CLASS = 'fo-checkbox-slot';

  let paperclipSlotTemplate = null;

  function learnPaperclipSlotTemplate() {
    if (paperclipSlotTemplate) return paperclipSlotTemplate;

    for (const row of getMainThreadRows()) {
      const clip = getAttachmentIcon(row);
      if (!clip) continue;

      const anchor = clip.closest('a');
      const slot = anchor?.parentElement;
      const titleCell = getTitleCell(row);
      if (!slot || !titleCell?.contains(slot)) continue;

      paperclipSlotTemplate = {
        slotIndex: [...titleCell.children].indexOf(slot),
        tagName: slot.tagName,
        className: slot.className,
        inlineStyle: slot.getAttribute('style') || '',
      };
      return paperclipSlotTemplate;
    }

    return null;
  }

  function createMirrorCheckboxSlot(titleCell) {
    const template = learnPaperclipSlotTemplate();
    const slot = document.createElement(template?.tagName || 'div');
    slot.classList.add(CHECKBOX_SLOT_CLASS);

    if (template?.className) {
      template.className.split(/\s+/).filter(Boolean).forEach((cls) => slot.classList.add(cls));
    }
    if (template?.inlineStyle) {
      slot.setAttribute('style', template.inlineStyle);
    } else {
      slot.style.cssFloat = 'right';
    }

    const insertBefore = template && template.slotIndex >= 0
      ? titleCell.children[template.slotIndex] || null
      : titleCell.firstChild;
    titleCell.insertBefore(slot, insertBefore);
    return slot;
  }

  function getCheckboxSlot(row) {
    const clip = getAttachmentIcon(row);
    if (clip) {
      const anchor = clip.closest('a');
      return { slot: anchor?.parentElement || clip.parentElement, clip };
    }

    const titleCell = getTitleCell(row);
    if (!titleCell) return { slot: null, clip: null };

    let slot = titleCell.querySelector(`:scope > .${CHECKBOX_SLOT_CLASS}`);
    if (!slot) {
      slot = createMirrorCheckboxSlot(titleCell);
    }

    return { slot, clip: null };
  }

  function getCheckboxInsertPoint(row) {
    const { slot, clip } = getCheckboxSlot(row);
    if (!slot) return null;

    if (clip) {
      return { type: 'afterClip', node: clip };
    }

    return { type: 'append', parent: slot };
  }

  function insertAfterOutsideAnchor(node, element) {
    const anchor = node.closest('a');
    if (anchor?.parentNode && anchor.contains(node)) {
      anchor.after(element);
      return;
    }
    node.after(element);
  }

  function getThreadRows() {
    const rows = [...document.querySelectorAll('tr[id^="thread_"]')];
    if (rows.length > 0) return rows;

    const seen = new Set();
    const fallback = [];
    document.querySelectorAll('a[href*="showthread.php"]').forEach((anchor) => {
      if (!isMainThreadLink(anchor)) return;
      const row = anchor.closest('tr');
      if (row && !seen.has(row)) {
        seen.add(row);
        fallback.push(row);
      }
    });
    return fallback;
  }

  function getSampleThreadRow() {
    const table = getMainListTable();
    const row = table?.querySelector('tbody[id^="threadbits"] tr[id^="thread_"]');
    if (row) return row;
    return document.querySelector('tr[id^="thread_"]') || getThreadRows()[0] || null;
  }

  function getThreadId(row) {
    const rowMatch = row.id?.match(/^thread_(\d+)$/);
    if (rowMatch) return rowMatch[1];

    const href = getTitleLink(row)?.getAttribute('href') || '';
    const hrefMatch = href.match(/[?&]t=(\d+)/);
    return hrefMatch ? hrefMatch[1] : null;
  }

  function getThreadTitle(row) {
    const titleLink = getTitleLink(row);
    if (titleLink) {
      return titleLink.textContent.replace(/\s+/g, ' ').trim();
    }
    return `Thread ${getThreadId(row) || ''}`.trim();
  }

  function getThreadUrl(row) {
    const titleLink = getTitleLink(row);
    if (!titleLink) return null;
    return resolveUrl(titleLink.getAttribute('href'));
  }

  function getLastPostColumnIndex(sampleRow) {
    const table = getMainListTable();
    const headerRow = table ? findColumnHeaderRow(table, sampleRow || getSampleThreadRow()) : null;

    if (headerRow) {
      const cells = [...headerRow.querySelectorAll('td.thead, th.thead')];
      const idx = cells.findIndex((cell) => /last\s*post/i.test(cell.textContent));
      if (idx >= 0) return idx;
    }

    if (sampleRow?.cells?.length >= 4) {
      return sampleRow.cells.length - 3;
    }

    return 2;
  }

  function setHourFromMatch(date, match) {
    let hours = parseInt(match[1], 10);
    const minutes = parseInt(match[2], 10);
    const meridiem = (match[3] || '').toUpperCase();
    if (meridiem === 'PM' && hours < 12) hours += 12;
    if (meridiem === 'AM' && hours === 12) hours = 0;
    date.setHours(hours, minutes, 0, 0);
  }

  function extractTimeMatch(text) {
    return text.match(/(\d{1,2}):(\d{2})\s*(AM|PM)/i)
      || text.match(/(\d{1,2}):(\d{2})(am|pm)/i);
  }

  function parseTitleTimestamp(title) {
    if (!title) return NaN;
    let parsed = Date.parse(title);
    if (!Number.isNaN(parsed)) return parsed;
    return Date.parse(title.replace(/(\d:\d{2})(am|pm)/gi, '$1 $2'));
  }

  function getLastPostDisplayText(cell) {
    const dateLine = cell.querySelector('.smallfont > div:first-child')
      || cell.querySelector('.smallfont');
    if (dateLine) {
      const timeEl = dateLine.querySelector('.time, span.time');
      const datePart = dateLine.textContent
        .replace(timeEl?.textContent || '', '')
        .replace(/\s+/g, ' ')
        .trim();
      const timePart = timeEl?.textContent?.trim() || '';
      return `${datePart} ${timePart}`.trim();
    }

    return cell.textContent
      .replace(/\s*by\s+.*$/i, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function parseLastPostText(text) {
    const normalized = text.replace(/\s+/g, ' ').trim();
    if (!normalized) return 0;

    const now = new Date();
    const timeMatch = extractTimeMatch(normalized);

    if (/\btoday\b/i.test(normalized)) {
      const d = new Date(now);
      if (timeMatch) setHourFromMatch(d, timeMatch);
      return d.getTime();
    }

    if (/\byesterday\b/i.test(normalized)) {
      const d = new Date(now);
      d.setDate(d.getDate() - 1);
      if (timeMatch) setHourFromMatch(d, timeMatch);
      return d.getTime();
    }

    const slashDate = normalized.match(/(\d{1,2})-(\d{1,2})-(\d{4})/);
    if (slashDate) {
      const d = new Date(+slashDate[3], +slashDate[1] - 1, +slashDate[2]);
      if (timeMatch) setHourFromMatch(d, timeMatch);
      return d.getTime();
    }

    const longDate = normalized.match(/([A-Za-z]{3,9})\s+(\d{1,2}),?\s+(\d{4})/);
    if (longDate) {
      const parsed = Date.parse(`${longDate[1]} ${longDate[2]}, ${longDate[3]}`);
      if (!Number.isNaN(parsed)) {
        const d = new Date(parsed);
        if (timeMatch) setHourFromMatch(d, timeMatch);
        return d.getTime();
      }
    }

    const direct = Date.parse(normalized.replace(/(\d:\d{2})(am|pm)/gi, '$1 $2'));
    return Number.isNaN(direct) ? 0 : direct;
  }

  function getLastPostCell(row) {
    const idx = getLastPostColumnIndex(row);
    return row.cells[idx] || null;
  }

  function getLastPostTimestamp(row) {
    const cell = getLastPostCell(row);
    if (!cell) return 0;

    for (const el of cell.querySelectorAll('[title]')) {
      const parsed = parseTitleTimestamp(el.getAttribute('title') || '');
      if (!Number.isNaN(parsed)) return parsed;
    }

    return parseLastPostText(getLastPostDisplayText(cell));
  }

  function getMainThreadSortOrder() {
    const order = new Map();
    getMainThreadRows().forEach((row, index) => {
      const id = getThreadId(row);
      if (id) order.set(id, index);
    });
    return order;
  }

  function getThreadMeta(row) {
    const id = getThreadId(row);
    if (!id) return null;

    return {
      id,
      title: getThreadTitle(row),
      url: getThreadUrl(row),
      lastPostAt: getLastPostTimestamp(row),
    };
  }

  function loadFavorites() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return {};
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
      return {};
    }
  }

  function saveFavorites(favorites) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(favorites));
  }

  function isFavorite(threadId) {
    return Object.prototype.hasOwnProperty.call(loadFavorites(), threadId);
  }

  function addFavorite(meta) {
    if (!meta?.id) return;
    const favorites = loadFavorites();
    const existing = favorites[meta.id];
    favorites[meta.id] = {
      title: meta.title,
      url: meta.url,
      savedAt: existing?.savedAt || Date.now(),
      lastPostAt: meta.lastPostAt || existing?.lastPostAt || 0,
    };
    saveFavorites(favorites);
  }

  function getSortedFavoriteEntries() {
    const favorites = loadFavorites();
    const mainRows = getMainThreadRows();
    const rowsById = new Map(mainRows.map((row) => [getThreadId(row), row]));
    const mainOrder = getMainThreadSortOrder();
    let changed = false;

    const entries = Object.entries(favorites).map(([threadId, favorite]) => {
      const liveTs = rowsById.has(threadId) ? getLastPostTimestamp(rowsById.get(threadId)) : 0;
      if (liveTs > 0 && liveTs !== favorite.lastPostAt) {
        favorite.lastPostAt = liveTs;
        changed = true;
      }
      return [threadId, favorite];
    });

    if (changed) saveFavorites(favorites);

    return entries.sort(([idA, a], [idB, b]) => {
      const aIdx = mainOrder.get(idA);
      const bIdx = mainOrder.get(idB);
      const aOnPage = aIdx !== undefined;
      const bOnPage = bIdx !== undefined;

      if (aOnPage && bOnPage) return aIdx - bIdx;

      const aKey = a.lastPostAt || 0;
      const bKey = b.lastPostAt || 0;
      if (aKey !== bKey) return bKey - aKey;

      if (aOnPage !== bOnPage) return aOnPage ? -1 : 1;
      return (b.savedAt || 0) - (a.savedAt || 0);
    });
  }

  function removeFavorite(threadId) {
    const favorites = loadFavorites();
    delete favorites[threadId];
    saveFavorites(favorites);
  }

  function getFirstUnreadAnchor(row) {
    const byId = row.querySelector('a[id^="thread_gotonew_"][href*="goto=newpost"]');
    if (byId) return byId;

    const byHref = row.querySelector('a[href*="goto=newpost"][href*="showthread.php"]');
    if (byHref) return byHref;

    for (const img of row.querySelectorAll('img[alt]')) {
      const alt = (img.getAttribute('alt') || '').trim().toLowerCase();
      if (alt !== 'go to first new post' && alt !== 'go to first unread post') continue;

      const anchor = img.closest('a[href*="showthread.php"]');
      if (anchor) return anchor;
    }

    return null;
  }

  function getFirstUnreadUrl(threadId, row) {
    if (row) {
      const anchor = getFirstUnreadAnchor(row);
      if (anchor) return resolveUrl(anchor.getAttribute('href'));
    }
    return resolveUrl(`showthread.php?goto=newpost&t=${threadId}`);
  }

  function getLastPageLink(row) {
    let lastLink = null;
    let maxPage = 0;

    for (const anchor of row.querySelectorAll('a[href*="showthread.php"][href*="page="]')) {
      const page = getPageNumber(anchor.getAttribute('href') || '');
      if (page === null || Number.isNaN(page) || page <= maxPage) continue;

      maxPage = page;
      lastLink = anchor;
    }

    return lastLink;
  }

  function getInsertionAnchor(row) {
    const lastPageLink = getLastPageLink(row);
    if (lastPageLink) return lastPageLink;

    const titleLink = getTitleLink(row);
    if (titleLink) return titleLink;

    for (const anchor of row.querySelectorAll('a[href*="showthread.php"]')) {
      if (isMainThreadLink(anchor)) return anchor;
    }

    return null;
  }

  function appendFirstUnreadLink(row, insertionAnchor) {
    if (!insertionAnchor || insertionAnchor.parentElement?.querySelector(`.${LINK_CLASS}`)) return;

    const unreadAnchor = row ? getFirstUnreadAnchor(row) : null;
    if (!unreadAnchor) return;

    const unreadUrl = resolveUrl(unreadAnchor.getAttribute('href'));
    if (!unreadUrl) return;

    const link = document.createElement('a');
    link.className = LINK_CLASS;
    link.href = unreadUrl;
    link.textContent = 'First Unread';
    link.rel = unreadAnchor.getAttribute('rel') || 'nofollow';
    link.title = 'Go to first unread post in this thread';

    insertionAnchor.after(document.createTextNode(', '), link);
  }

  function injectFirstUnreadLink(row) {
    if (row.querySelector(`.${LINK_CLASS}`)) return;
    appendFirstUnreadLink(row, getInsertionAnchor(row));
  }

  function getBridgeRoot() {
    return typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;
  }

  async function openWithTabbedGroupExtender(urls, options = {}) {
    const opts = { active: false, delayMs: TAB_DELAY_MS, insert: true, group: true, ...options };
    const bridgeRoot = getBridgeRoot();
    const bridgeDoc = bridgeRoot.document || document;

    if (typeof bridgeRoot.TampermonkeyTabbedGroupExtender?.open === 'function') {
      return bridgeRoot.TampermonkeyTabbedGroupExtender.open(urls, opts);
    }

    return new Promise((resolve, reject) => {
      const requestId = 'tmtge-' + Date.now() + '-' + Math.random().toString(36).slice(2);
      const onResult = (event) => {
        if (event.detail?.requestId !== requestId) return;
        bridgeDoc.removeEventListener(TMTGE_EVENT_RESULT, onResult, true);
        if (event.detail.ok) resolve(event.detail);
        else reject(new Error(event.detail.error || 'TampermonkeyTabbedGroupExtender failed'));
      };
      bridgeDoc.addEventListener(TMTGE_EVENT_RESULT, onResult, true);
      bridgeDoc.dispatchEvent(new CustomEvent(TMTGE_EVENT_OPEN, {
        detail: { urls, options: opts, requestId },
      }));
      setTimeout(() => {
        bridgeDoc.removeEventListener(TMTGE_EVENT_RESULT, onResult, true);
        reject(new Error('Tampermonkey Tabbed Group Extender not installed or not responding'));
      }, 10000);
    });
  }

  async function createTabGroup(options = {}) {
    const bridgeRoot = getBridgeRoot();
    const bridgeDoc = bridgeRoot.document || document;

    if (typeof bridgeRoot.TampermonkeyTabbedGroupExtender?.createGroup === 'function') {
      return bridgeRoot.TampermonkeyTabbedGroupExtender.createGroup(options);
    }

    return new Promise((resolve, reject) => {
      const requestId = 'tmtge-' + Date.now() + '-' + Math.random().toString(36).slice(2);
      const onResult = (event) => {
        if (event.detail?.requestId !== requestId) return;
        bridgeDoc.removeEventListener(TMTGE_EVENT_RESULT, onResult, true);
        if (event.detail.ok) resolve(event.detail);
        else reject(new Error(event.detail.error || 'createGroup failed'));
      };
      bridgeDoc.addEventListener(TMTGE_EVENT_RESULT, onResult, true);
      bridgeDoc.dispatchEvent(new CustomEvent(TMTGE_EVENT_CREATE_GROUP, {
        detail: { options, requestId },
      }));
      setTimeout(() => {
        bridgeDoc.removeEventListener(TMTGE_EVENT_RESULT, onResult, true);
        reject(new Error('Tampermonkey Tabbed Group Extender not installed or not responding'));
      }, 10000);
    });
  }

  function openTab(url) {
    if (typeof GM !== 'undefined' && typeof GM.openInTab === 'function') {
      GM.openInTab(url, GM_TAB_OPTIONS);
      return;
    }
    if (typeof GM_openInTab === 'function') {
      GM_openInTab(url, GM_TAB_OPTIONS);
      return;
    }
    window.open(url, '_blank', 'noopener,noreferrer');
  }

  function collectFavoriteUnreadUrls() {
    const favorites = loadFavorites();
    const rowsById = new Map(getMainThreadRows().map((row) => [getThreadId(row), row]));

    return Object.keys(favorites)
      .map((threadId) => getFirstUnreadUrl(threadId, rowsById.get(threadId)))
      .filter(Boolean);
  }

  async function openAllFavoritesUnread(btn) {
    const urls = collectFavoriteUnreadUrls();
    if (urls.length === 0) {
      btn.textContent = 'No favorites';
      setTimeout(() => { btn.textContent = 'Open unread'; }, 2000);
      return;
    }

    const label = 'Open unread';
    btn.disabled = true;
    btn.textContent = `Opening ${urls.length}...`;

    try {
      await createTabGroup();
      await openWithTabbedGroupExtender(urls);
      btn.textContent = label;
      btn.disabled = false;
    } catch (error) {
      console.warn('[Forumopolis favorites] Tab group extender unavailable; falling back to GM.openInTab.', error);
      urls.forEach((url, index) => {
        setTimeout(() => {
          openTab(url);
          if (index === urls.length - 1) {
            btn.textContent = label;
            btn.disabled = false;
          }
        }, index * TAB_DELAY_MS);
      });
    }
  }

  function setFavoriteChecked(threadId, checked) {
    document.querySelectorAll(`.${CHECKBOX_CLASS}[data-thread-id="${threadId}"]`).forEach((cb) => {
      cb.checked = checked;
    });
  }

  function onFavoriteToggle(threadId, checked, meta) {
    if (checked) {
      if (meta) addFavorite(meta);
    } else {
      removeFavorite(threadId);
    }
    renderFavoritesTable();
    setFavoriteChecked(threadId, checked);
    hideFavoritedMainRows();
    if (!checked) {
      const row = getMainThreadRows().find((r) => getThreadId(r) === threadId);
      if (row) injectFavoriteCheckbox(row);
    }
  }

  function createFavoriteCheckbox(threadId, checked, metaProvider) {
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.className = CHECKBOX_CLASS;
    cb.dataset.threadId = threadId;
    cb.checked = checked;
    cb.title = checked ? 'Remove from favorites' : 'Favorite this thread';
    cb.addEventListener('mousedown', (e) => e.stopPropagation());
    cb.addEventListener('click', (e) => e.stopPropagation());
    cb.addEventListener('change', (e) => {
      e.stopPropagation();
      const meta = typeof metaProvider === 'function' ? metaProvider() : metaProvider;
      onFavoriteToggle(threadId, cb.checked, meta);
    });
    return cb;
  }

  function normalizeClonedRow(row) {
    row.style.removeProperty('display');
    row.classList.remove(HIDDEN_MAIN_CLASS);
  }

  function placeFavoriteCheckbox(row, threadId, checked, metaProvider) {
    row.querySelectorAll(`.${CHECKBOX_CLASS}[data-thread-id="${threadId}"]`).forEach((el) => el.remove());

    const point = getCheckboxInsertPoint(row);
    if (!point) return;

    const cb = createFavoriteCheckbox(threadId, checked, metaProvider);

    if (point.type === 'afterClip') {
      insertAfterOutsideAnchor(point.node, cb);
      return;
    }

    if (point.type === 'append') {
      point.parent.appendChild(cb);
    }
  }

  function injectFavoriteCheckbox(row) {
    const threadId = getThreadId(row);
    if (!threadId) return;
    placeFavoriteCheckbox(row, threadId, isFavorite(threadId), () => getThreadMeta(row));
  }

  function hideFavoritedMainRows() {
    const favoriteIds = new Set(Object.keys(loadFavorites()));

    getMainThreadRows().forEach((row) => {
      const threadId = getThreadId(row);
      if (threadId && favoriteIds.has(threadId)) {
        row.classList.add(HIDDEN_MAIN_CLASS);
      } else {
        row.classList.remove(HIDDEN_MAIN_CLASS);
      }
    });
  }

  function getTitleCellIndex(sampleRow) {
    const titleLink = getTitleLink(sampleRow);
    if (titleLink) {
      for (let i = 0; i < sampleRow.cells.length; i++) {
        if (sampleRow.cells[i].contains(titleLink)) return i;
      }
    }

    return sampleRow.cells.length > 1 ? 1 : 0;
  }

  function getThreadListContext() {
    const sampleRow = getSampleThreadRow();
    const table = getMainListTable() || sampleRow?.closest('table');
    if (!sampleRow || !table) return null;

    const threadbitsTbody =
      sampleRow.closest('tbody[id^="threadbits"]') ||
      (sampleRow.parentElement?.tagName === 'TBODY' ? sampleRow.parentElement : null);

    let sectionCatRow = null;
    let headerRow = null;
    let insertBefore = threadbitsTbody || sampleRow;

    let node = insertBefore?.previousElementSibling;
    while (node) {
      if (node.matches('tr') && node.querySelector('td.thead, th.thead')) {
        headerRow = node;
        node = node.previousElementSibling;
        continue;
      }
      if (node.matches('tr') && node.querySelector('td.tcat, th.tcat')) {
        sectionCatRow = node;
        insertBefore = node;
        break;
      }
      node = node.previousElementSibling;
    }

    if (!headerRow) {
      headerRow = findColumnHeaderRow(table, sampleRow);
    }

    return {
      table,
      threadbitsTbody,
      insertBefore,
      sectionCatRow,
      headerRow,
      sampleRow,
    };
  }

  function findColumnHeaderRow(table, sampleRow) {
    const directRows = [
      ...table.querySelectorAll(':scope > tbody > tr'),
      ...table.querySelectorAll(':scope > tr'),
    ];

    const headerFromDirect = directRows.find((tr) => tr.querySelector('td.thead, th.thead'));
    if (headerFromDirect) return headerFromDirect;

    if (sampleRow) {
      let sibling = sampleRow.previousElementSibling;
      while (sibling) {
        if (sibling.matches('tr') && sibling.querySelector('td.thead, th.thead')) {
          return sibling;
        }
        sibling = sibling.previousElementSibling;
      }
    }

    return null;
  }

  function removeFavoritesSection() {
    document.getElementById(FAVORITES_WRAP_ID)?.remove();
  }

  function cloneTableShell(sourceTable) {
    const table = document.createElement('table');
    for (const attr of sourceTable.attributes) {
      table.setAttribute(attr.name, attr.value);
    }
    return table;
  }

  function insertFavoritesTable(favTable, sourceTable) {
    const wrap = document.createElement('div');
    wrap.id = FAVORITES_WRAP_ID;
    wrap.className = 'fo-favorites-wrap';
    wrap.appendChild(favTable);

    if (sourceTable?.parentNode) {
      sourceTable.parentNode.insertBefore(wrap, sourceTable);
      return;
    }

    document.body.insertBefore(wrap, document.body.firstChild);
  }

  function stripDuplicateIds(root) {
    root.querySelectorAll('[id]').forEach((el) => el.removeAttribute('id'));
  }

  function clearInjectedElements(root) {
    root.querySelectorAll(`.${CHECKBOX_CLASS}, .${LINK_CLASS}`).forEach((el) => el.remove());
  }

  function ensureFavoriteRowControls(row, threadId, favorite, sourceRow) {
    clearInjectedElements(row);
    placeFavoriteCheckbox(row, threadId, true, {
      id: threadId,
      title: favorite.title,
      url: favorite.url,
    });

    if (sourceRow && getFirstUnreadAnchor(sourceRow)) {
      appendFirstUnreadLink(sourceRow, getInsertionAnchor(row));
    }
  }

  function buildFavoriteTitleCell(td, threadId, favorite, sourceRow) {
    const row = td.closest('tr');
    const titleLink = getTitleLink(row);

    if (titleLink) {
      titleLink.href = favorite.url || resolveUrl(`showthread.php?t=${threadId}`);
      titleLink.textContent = favorite.title || `Thread ${threadId}`;
      ensureFavoriteRowControls(row, threadId, favorite, sourceRow);
      return;
    }

    td.innerHTML = '';

    const link = document.createElement('a');
    link.href = favorite.url || resolveUrl(`showthread.php?t=${threadId}`);
    link.textContent = favorite.title || `Thread ${threadId}`;
    td.appendChild(link);

    ensureFavoriteRowControls(row, threadId, favorite, sourceRow);
  }

  function buildFavoriteRow(sampleRow, titleCellIndex, threadId, favorite, liveRow) {
    const sourceRow = liveRow || getMainThreadRows().find((row) => getThreadId(row) === threadId);

    if (sourceRow) {
      const row = sourceRow.cloneNode(true);
      row.removeAttribute('id');
      row.id = `fo_favorite_${threadId}`;
      stripDuplicateIds(row);
      normalizeClonedRow(row);
      ensureFavoriteRowControls(row, threadId, favorite, sourceRow);
      return row;
    }

    const row = sampleRow.cloneNode(true);
    row.removeAttribute('id');
    row.id = `fo_favorite_${threadId}`;
    stripDuplicateIds(row);
    normalizeClonedRow(row);
    clearInjectedElements(row);

    [...row.cells].forEach((td, index) => {
      if (index === titleCellIndex) {
        buildFavoriteTitleCell(td, threadId, favorite, null);
      } else {
        td.innerHTML = '&nbsp;';
      }
    });

    return row;
  }

  function cloneSectionCatRow(sectionCatRow) {
    const catRow = sectionCatRow.cloneNode(true);
    stripDuplicateIds(catRow);

    const catCell = catRow.querySelector('td.tcat, th.tcat') || catRow.cells[0];
    if (catCell) {
      catCell.innerHTML = 'Favorites';
    }

    return catRow;
  }

  function createSectionCatRow(colCount, sectionCatRow) {
    if (sectionCatRow) {
      return cloneSectionCatRow(sectionCatRow);
    }

    const catRow = document.createElement('tr');
    const catCell = document.createElement('td');
    catCell.className = 'tcat';
    catCell.colSpan = colCount;
    catCell.textContent = 'Favorites';
    catRow.appendChild(catCell);

    return catRow;
  }

  function enhanceFavoritesHeader(favHeader) {
    const cells = [...favHeader.querySelectorAll('td.thead, th.thead')];
    const threadCell =
      cells.find((cell) => /\bthread\b/i.test(cell.textContent)) ||
      cells[1] ||
      cells[0];

    if (!threadCell || threadCell.querySelector(`.${OPEN_UNREAD_BTN_CLASS}`)) return;

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = OPEN_UNREAD_BTN_CLASS;
    btn.textContent = 'Open unread';
    btn.title = 'Group this forum tab and open first unread for each favorite';
    btn.addEventListener('click', () => openAllFavoritesUnread(btn));

    threadCell.insertBefore(btn, threadCell.firstChild);
  }

  function renderFavoritesTable() {
    removeFavoritesSection();

    const entries = getSortedFavoriteEntries();
    if (entries.length === 0) return;

    const context = getThreadListContext();
    if (!context?.table || !context.sampleRow?.cells?.length) return;

    const { table: sourceTable, sectionCatRow, headerRow, sampleRow } = context;
    const titleCellIndex = getTitleCellIndex(sampleRow);
    const colCount = sampleRow.cells.length;
    const rowsById = new Map(getMainThreadRows().map((row) => [getThreadId(row), row]));

    const favTable = cloneTableShell(sourceTable);
    favTable.appendChild(createSectionCatRow(colCount, sectionCatRow));

    if (headerRow) {
      const favHeader = headerRow.cloneNode(true);
      stripDuplicateIds(favHeader);
      enhanceFavoritesHeader(favHeader);
      favTable.appendChild(favHeader);
    }

    const tbody = document.createElement('tbody');
    tbody.id = FAVORITES_TBODY_ID;

    entries.forEach(([threadId, favorite]) => {
      tbody.appendChild(
        buildFavoriteRow(sampleRow, titleCellIndex, threadId, favorite, rowsById.get(threadId))
      );
    });

    favTable.appendChild(tbody);
    insertFavoritesTable(favTable, sourceTable);
  }

  function injectStyles() {
    const style = document.createElement('style');
    style.textContent = `
      .${CHECKBOX_CLASS} {
        display: inline;
        width: 13px;
        height: 13px;
        margin: 0 0 0 4px;
        padding: 0;
        vertical-align: middle;
        cursor: pointer;
        position: relative;
        z-index: 1;
      }
      .${CHECKBOX_SLOT_CLASS} {
        float: right;
      }
      table.tborder tbody[id^="threadbits"] tr.${HIDDEN_MAIN_CLASS} {
        display: none !important;
      }
      .fo-favorites-wrap {
        margin: 0 0 12px;
      }
      .${OPEN_UNREAD_BTN_CLASS} {
        display: inline;
        margin-right: 8px;
        padding: 1px 6px;
        font: inherit;
        line-height: inherit;
        vertical-align: middle;
        cursor: pointer;
      }
    `;
    document.head.appendChild(style);
  }

  function processThreadRows() {
    getMainThreadRows().forEach((row) => {
      injectFavoriteCheckbox(row);
      injectFirstUnreadLink(row);
    });
  }

  if (!isTargetForum()) return;

  injectStyles();
  processThreadRows();
  renderFavoritesTable();
  hideFavoritedMainRows();
})();
