(function () {
  'use strict';

  if (window.__PROXY_PRINT_ANDROID_LAUNCHER_RUNNING__) {
    alert('A4プロキシ印刷処理はすでに実行中です。');
    return;
  }
  window.__PROXY_PRINT_ANDROID_LAUNCHER_RUNNING__ = true;

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

  function isVisible(el) {
    if (!el) return false;
    const style = getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  }

  function getImageSrc(img) {
    return (
      img.currentSrc || img.src || img.getAttribute('data-src') || img.getAttribute('data-original') ||
      img.getAttribute('data-lazy-src') || img.getAttribute('data-url') ||
      img.getAttribute('srcset')?.split(',')?.[0]?.trim()?.split(/\s+/)?.[0] || ''
    );
  }

  function toLargeImageUrl(url) {
    return String(url).replace('/img/s/card/', '/img/card/').replace('/img/s/', '/img/');
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

  function sortByPagePosition(a, b) {
    const ar = a.getBoundingClientRect();
    const br = b.getBoundingClientRect();
    const ay = ar.top + window.scrollY;
    const by = br.top + window.scrollY;
    const ax = ar.left + window.scrollX;
    const bx = br.left + window.scrollX;
    if (Number.isFinite(ay) && Number.isFinite(by) && Math.abs(ay - by) > 10) return ay - by;
    if (Number.isFinite(ax) && Number.isFinite(bx) && Math.abs(ax - bx) > 10) return ax - bx;
    return 0;
  }

  async function warmLazyImages() {
    const startX = window.scrollX;
    const startY = window.scrollY;
    const doc = document.documentElement;
    const maxY = Math.max(document.body.scrollHeight, doc.scrollHeight, document.body.offsetHeight, doc.offsetHeight) - window.innerHeight;
    if (!Number.isFinite(maxY) || maxY <= 0) return;
    const step = Math.max(520, Math.floor(window.innerHeight * 0.85));
    for (let y = 0, steps = 0; y <= maxY && steps < 55; y += step, steps++) {
      window.scrollTo(0, y);
      await sleep(85);
    }
    window.scrollTo(startX, startY);
    await sleep(220);
  }

  function findGachiMainHeaderTop() {
    const els = Array.from(document.querySelectorAll('div, span, h1, h2, h3, p, strong'))
      .filter((el) => {
        const t = textOf(el).replace(/\s+/g, ' ');
        return t === 'メイン 40' || /メイン\s*40/.test(t);
      });
    if (els.length === 0) return null;
    els.sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top);
    return els[0].getBoundingClientRect().top + window.scrollY;
  }

  function collectDeckMakerImages() {
    return Array.from(document.querySelectorAll('img'))
      .filter((img) => {
        const src = getImageSrc(img);
        if (!isKaNabellCardUrl(src) || !looksLikeCardByShape(img)) return false;
        if (!isVisible(img) && !img.naturalWidth) return false;
        return true;
      })
      .sort(sortByPagePosition)
      .slice(0, MAIN_DECK_COUNT);
  }

  function collectGachiMatomeImages() {
    const mainTop = findGachiMainHeaderTop();
    return Array.from(document.querySelectorAll('img'))
      .filter((img) => {
        const src = getImageSrc(img);
        if (!isKaNabellCardUrl(src) || !looksLikeCardByShape(img)) return false;
        if (mainTop !== null) {
          const top = img.getBoundingClientRect().top + window.scrollY;
          if (top < mainTop - 5) return false;
        }
        if (!isVisible(img) && !img.naturalWidth) return false;
        return true;
      })
      .sort(sortByPagePosition)
      .slice(0, MAIN_DECK_COUNT);
  }

  function collectLargeUrls() {
    const imgs = isGachiMatome() ? collectGachiMatomeImages() : isDeckMaker() ? collectDeckMakerImages() : [];
    return imgs.map(getImageSrc).filter(Boolean).map(toLargeImageUrl);
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

  function setStatus(text, isError = false) {
    console.log('[Deck → GitHub A4 Android bookmarklet]', text);
    let box = document.getElementById('__proxy_print_android_bookmarklet_status__');
    if (!box) {
      box = document.createElement('div');
      box.id = '__proxy_print_android_bookmarklet_status__';
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

  async function main() {
    try {
      if (!isDeckMaker() && !isGachiMatome()) {
        alert('deckmaker または ガチまとめのデッキページで実行してください。');
        return;
      }

      setStatus('カード画像を読み込み中...\nページを自動スクロールします。');
      await warmLazyImages();
      const urls = collectLargeUrls();

      if (urls.length === 0) {
        setStatus('カード画像が見つかりません。\nメイン40枚が表示された状態で再実行してください。', true);
        return;
      }

      if (urls.length < MAIN_DECK_COUNT) {
        const proceed = confirm(`${urls.length}枚だけ見つかりました。\n見つかった枚数だけでA4レイアウトを開きますか？`);
        if (!proceed) {
          setStatus('処理を中止しました。\nデッキ部分までスクロールしてから再実行してください。', true);
          return;
        }
      }

      const targetUrl = makePrintPageUrl(urls.slice(0, MAIN_DECK_COUNT));
      setStatus(`${Math.min(urls.length, MAIN_DECK_COUNT)}枚をA4レイアウトページへ送ります。`);
      location.href = targetUrl;
    } catch (e) {
      setStatus('処理に失敗しました: ' + (e && e.message ? e.message : String(e)), true);
    } finally {
      window.__PROXY_PRINT_ANDROID_LAUNCHER_RUNNING__ = false;
    }
  }

  main();
})();
