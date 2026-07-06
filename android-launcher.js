(function () {
  'use strict';

  if (window.__PROXY_PRINT_ANDROID_CURRENT_VIEW_RUNNING__) {
    alert('A4プロキシ印刷 v1.4 はすでに実行中です。');
    return;
  }
  window.__PROXY_PRINT_ANDROID_CURRENT_VIEW_RUNNING__ = true;

  const VERSION = 'Android Chrome bookmarklet v1.4 current-view';
  const MAIN_DECK_COUNT = 40;
  const PRINT_PAGE_URL = 'https://heartonerolling.github.io/proxy-print/';
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  function isDeckMaker() {
    return location.hostname === 'deck-maker.com' || location.hostname.endsWith('.deck-maker.com');
  }

  function isGachiMatome() {
    return location.hostname === 'gachi-matome.com' || location.hostname.endsWith('.gachi-matome.com');
  }

  function textOf(el) {
    return (el?.innerText || el?.textContent || el?.value || el?.getAttribute?.('aria-label') || el?.getAttribute?.('title') || '').trim();
  }

  function getImageSrc(img) {
    const srcset = img.getAttribute('srcset') || img.getAttribute('data-srcset') || '';
    const firstSrcset = srcset ? srcset.split(',')[0]?.trim()?.split(/\s+/)?.[0] : '';
    return (
      img.currentSrc || img.src || img.getAttribute('data-src') || img.getAttribute('data-original') ||
      img.getAttribute('data-lazy-src') || img.getAttribute('data-url') || firstSrcset || ''
    );
  }

  function toLargeImageUrl(url) {
    return String(url)
      .replace('/img/s/card/', '/img/card/')
      .replace('/img/s/', '/img/');
  }

  function normalizeCardUrl(url) {
    return String(toLargeImageUrl(url || '')).replace(/[?#].*$/, '');
  }

  function isKaNabellCardUrl(url) {
    const lowered = String(url || '').toLowerCase();
    return lowered.includes('ka-nabell-card-images') &&
      (lowered.includes('/img/s/card/') || lowered.includes('/img/card/') || lowered.includes('/img/s/') || lowered.includes('/img/'));
  }

  function looksLikeCardByShape(img) {
    const r = img.getBoundingClientRect();
    const width = r.width || img.naturalWidth || Number(img.getAttribute('width')) || 0;
    const height = r.height || img.naturalHeight || Number(img.getAttribute('height')) || 0;
    if (width <= 0 || height <= 0) return true;
    const ratio = width / height;
    return ratio >= 0.50 && ratio <= 0.90;
  }

  function isActuallyDisplayed(img) {
    const style = getComputedStyle(img);
    if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;
    const r = img.getBoundingClientRect();
    return r.width > 12 && r.height > 18;
  }

  function sortByAbsolutePosition(a, b) {
    const ar = a.getBoundingClientRect();
    const br = b.getBoundingClientRect();
    const ay = ar.top + window.scrollY;
    const by = br.top + window.scrollY;
    const ax = ar.left + window.scrollX;
    const bx = br.left + window.scrollX;
    if (Math.abs(ay - by) > 10) return ay - by;
    return ax - bx;
  }

  function setStatus(text, isError = false) {
    console.log('[A4 proxy print ' + VERSION + ']', text);
    let box = document.getElementById('__proxy_print_android_current_view_status__');
    if (!box) {
      box = document.createElement('div');
      box.id = '__proxy_print_android_current_view_status__';
      Object.assign(box.style, {
        position: 'fixed', left: '12px', right: '12px', bottom: '18px', zIndex: '2147483647',
        padding: '12px', background: isError ? '#7f1d1d' : '#111827', color: '#fff', borderRadius: '12px',
        fontSize: '13px', lineHeight: '1.45', boxShadow: '0 4px 16px rgba(0,0,0,0.34)', whiteSpace: 'pre-wrap',
        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
      });
      document.body.appendChild(box);
    }
    box.style.background = isError ? '#7f1d1d' : '#111827';
    box.textContent = text;
  }

  async function warmImagesNearAnchor(anchorY) {
    const startX = window.scrollX;
    const startY = window.scrollY;
    const doc = document.documentElement;
    const pageHeight = Math.max(document.body.scrollHeight, doc.scrollHeight, document.body.offsetHeight, doc.offsetHeight);
    const maxY = Math.min(pageHeight - window.innerHeight, anchorY + 4200);
    const step = Math.max(420, Math.floor(window.innerHeight * 0.75));

    // v1.4ではページ全体を走査しない。現在位置から下だけを軽く読み込む。
    for (let y = startY, steps = 0; y <= maxY && steps < 16; y += step, steps++) {
      window.scrollTo(startX, y);
      await sleep(110);
    }
    window.scrollTo(startX, startY);
    await sleep(260);
  }

  function collectFromCurrentViewportAnchor(anchorY) {
    const candidates = Array.from(document.querySelectorAll('img'))
      .filter((img) => {
        const src = getImageSrc(img);
        if (!isKaNabellCardUrl(src)) return false;
        if (!looksLikeCardByShape(img)) return false;
        if (!isActuallyDisplayed(img)) return false;

        const r = img.getBoundingClientRect();
        const top = r.top + window.scrollY;
        const left = r.left + window.scrollX;

        // 現在見ている実デッキの先頭位置より上は全部捨てる。
        // ここでスマホDOM上の「種類一覧」「おすすめ」「別表示」などを避ける。
        if (top < anchorY - 80) return false;

        // 画面外の横長広告・極端な位置のものを除外。
        if (left < -20 || left > window.innerWidth + window.scrollX + 80) return false;

        return true;
      })
      .sort(sortByAbsolutePosition);

    const urls = [];
    for (const img of candidates) {
      const url = normalizeCardUrl(getImageSrc(img));
      if (!url) continue;
      urls.push(url);
      if (urls.length >= MAIN_DECK_COUNT) break;
    }

    return { urls, candidateCount: candidates.length };
  }

  function encodeBase64Url(text) {
    const b64 = btoa(unescape(encodeURIComponent(text)));
    return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
  }

  function makePrintPageUrl(urls) {
    const base = PRINT_PAGE_URL.replace(/#.*$/, '');
    const normalizedBase = base.endsWith('/') ? base : base + '/';
    return normalizedBase + '#data=' + encodeURIComponent('base64url:' + encodeBase64Url(urls.join('\n')));
  }

  async function main() {
    try {
      if (!isDeckMaker() && !isGachiMatome()) {
        alert('deckmaker または ガチまとめのデッキページで実行してください。');
        return;
      }

      const anchorY = window.scrollY + Math.max(0, Math.min(120, window.innerHeight * 0.18));

      setStatus(
        VERSION + '\n' +
        '現在の表示位置を基準にします。\n' +
        '実デッキの1枚目付近を画面上部に出して実行してください。\n' +
        'カード画像を読み込み中...'
      );

      await warmImagesNearAnchor(anchorY);
      const result = collectFromCurrentViewportAnchor(anchorY);
      let urls = result.urls;

      if (urls.length === 0) {
        setStatus(
          'カード画像が見つかりません。\n' +
          'メイン40枚の1枚目付近までスクロールしてから、もう一度A4プロキシ印刷を実行してください。',
          true
        );
        return;
      }

      if (urls.length < MAIN_DECK_COUNT) {
        const proceed = confirm(
          `${urls.length}枚だけ見つかりました。\n` +
          '実デッキの1枚目付近を画面上部に合わせてから再実行すると改善します。\n\n' +
          'この枚数でA4レイアウトを開きますか？'
        );
        if (!proceed) {
          setStatus('処理を中止しました。', true);
          return;
        }
      }

      urls = urls.slice(0, MAIN_DECK_COUNT);
      setStatus(
        VERSION + '\n' +
        `${urls.length}枚をA4レイアウトページへ送ります。\n` +
        `候補画像数: ${result.candidateCount}\n` +
        '現在位置基準モード'
      );
      await sleep(350);
      location.href = makePrintPageUrl(urls);
    } catch (e) {
      setStatus('処理に失敗しました: ' + (e && e.message ? e.message : String(e)), true);
    } finally {
      window.__PROXY_PRINT_ANDROID_CURRENT_VIEW_RUNNING__ = false;
    }
  }

  main();
})();
