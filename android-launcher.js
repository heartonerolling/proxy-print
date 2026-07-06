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
    // Android Chrome のモバイル表示では、実際の40枚リストの前に
    // 「カード種類の一覧」のようなユニーク画像ブロックが出ることがある。
    // ここではまだ slice(0, 40) せず、後段でその前置きブロックを落とす。
    return Array.from(document.querySelectorAll('img'))
      .filter((img) => {
        const src = getImageSrc(img);
        if (!isKaNabellCardUrl(src) || !looksLikeCardByShape(img)) return false;
        if (!isVisible(img) && !img.naturalWidth) return false;
        return true;
      })
      .sort(sortByPagePosition);
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
      .sort(sortByPagePosition);
  }

  function normalizeCardUrlForCompare(url) {
    return String(toLargeImageUrl(url || ''))
      .replace(/[?#].*$/, '')
      .toLowerCase();
  }

  function buildDeckFromFrequencyIfPossible(urls) {
    // Android Chrome のモバイル表示では、同じカードが
    // 「種類一覧」「本当のデッキリスト」「別表示用の隠しリスト」などで重複してDOMに出ることがある。
    // その場合、単純に上から40枚を取ると、PCでは正しいのにスマホだけ枚数が崩れる。
    // 対策として、URLごとの出現回数から「各カードに共通で混ざっている余分な表示回数」を推定し、
    // count - extra を実際の投入枚数として復元する。
    if (!Array.isArray(urls) || urls.length <= MAIN_DECK_COUNT) return urls;

    const groups = [];
    const map = new Map();

    urls.forEach((url, index) => {
      const key = normalizeCardUrlForCompare(url);
      if (!key) return;
      if (!map.has(key)) {
        const item = { key, url, count: 0, firstIndex: index };
        map.set(key, item);
        groups.push(item);
      }
      map.get(key).count += 1;
    });

    if (groups.length === 0) return urls;

    // 40枚デッキに対して、ユニーク枚数が多すぎる/少なすぎる場合はこの補正を使わない。
    // DMのデッキならだいたい 6〜30種類程度に収まる想定。
    if (groups.length < 4 || groups.length > 32) return urls;

    let best = null;

    // extra は「各カードにつき何枚ぶん、デッキ外の表示が混ざっているか」。
    // よくあるのは1だが、スマホDOMでは2以上になる可能性もあるため候補を試す。
    for (let extra = 1; extra <= 8; extra++) {
      const rebuilt = [];
      for (const g of groups) {
        const n = Math.max(0, g.count - extra);
        for (let i = 0; i < n; i++) rebuilt.push(g.url);
      }

      const len = rebuilt.length;
      const score = Math.abs(len - MAIN_DECK_COUNT);

      if (len < 30 || len > 55) continue;

      if (!best || score < best.score || (score === best.score && extra < best.extra)) {
        best = { extra, rebuilt, score, len };
      }
    }

    // 40枚にかなり近い場合だけ採用。遠い場合は従来処理に戻す。
    if (best && best.score <= 3 && best.rebuilt.length >= MAIN_DECK_COUNT) {
      setStatus(
        `Android Chrome v1.2 fallback補正: DOM内${urls.length}枚 / 種類${groups.length} / 余分表示${best.extra}枚ぶんを除外\n` +
        '40枚リストを復元してA4ページへ送ります。'
      );
      return best.rebuilt.slice(0, MAIN_DECK_COUNT);
    }

    return urls;
  }

  function stripDeckMakerMobileIntroUrls(urls) {
    // 旧補正：スマホ表示で [A,B,C,D,...,J,A,A,A,A,B,B,B...] のように、
    // 最初にカード種類の一覧が混ざり、その後ろに本当の40枚リストが来るケースを補正する。
    if (!isDeckMaker()) return urls;
    if (!Array.isArray(urls) || urls.length <= MAIN_DECK_COUNT) return urls;

    const keys = urls.map(normalizeCardUrlForCompare);
    const first = keys[0];
    const repeatStart = keys.findIndex((key, index) => index > 0 && key === first);

    if (repeatStart < 6 || repeatStart > 30) return urls;
    if (urls.length - repeatStart < MAIN_DECK_COUNT) return urls;

    const prefix = keys.slice(0, repeatStart);
    const uniquePrefixCount = new Set(prefix).size;
    if (uniquePrefixCount / repeatStart < 0.75) return urls;

    const prefixSet = new Set(prefix);
    const nextWindow = keys.slice(repeatStart, repeatStart + Math.min(22, keys.length - repeatStart));
    const prefixHits = nextWindow.filter((key) => prefixSet.has(key)).length;
    if (prefixHits < 6) return urls;

    return urls.slice(repeatStart);
  }


  function getCardImgsFrom(root, mainTop = null) {
    const imgs = Array.from(root.querySelectorAll ? root.querySelectorAll('img') : []);
    return imgs.filter((img) => {
      const src = getImageSrc(img);
      if (!isKaNabellCardUrl(src) || !looksLikeCardByShape(img)) return false;
      if (mainTop !== null) {
        const top = img.getBoundingClientRect().top + window.scrollY;
        if (top < mainTop - 5) return false;
      }
      // display:none の隠しリストは除外。ただし遅延画像でnaturalWidthが未確定でも、表示寸法があれば採用。
      const style = getComputedStyle(img);
      if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;
      const r = img.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    });
  }

  function clusterCount(values, tolerance) {
    const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
    const clusters = [];
    for (const v of sorted) {
      const last = clusters[clusters.length - 1];
      if (!last || Math.abs(last.center - v) > tolerance) {
        clusters.push({ center: v, n: 1 });
      } else {
        last.center = (last.center * last.n + v) / (last.n + 1);
        last.n += 1;
      }
    }
    return clusters.length;
  }

  function scoreVisualDeckBlock(root, imgs) {
    const sorted = imgs.slice().sort(sortByPagePosition);
    if (sorted.length < MAIN_DECK_COUNT) return null;

    const first40 = sorted.slice(0, MAIN_DECK_COUNT);
    const rects = first40.map((img) => img.getBoundingClientRect());
    const tops = rects.map((r) => r.top + window.scrollY);
    const lefts = rects.map((r) => r.left + window.scrollX);
    const widths = rects.map((r) => r.width).filter((v) => v > 0);
    const heights = rects.map((r) => r.height).filter((v) => v > 0);
    const avgW = widths.reduce((a, b) => a + b, 0) / Math.max(1, widths.length);
    const avgH = heights.reduce((a, b) => a + b, 0) / Math.max(1, heights.length);
    const cols = clusterCount(lefts, Math.max(12, avgW * 0.35));
    const rows = clusterCount(tops, Math.max(12, avgH * 0.35));
    const rootRect = root.getBoundingClientRect ? root.getBoundingClientRect() : { width: 9999, height: 9999, top: 9999 };
    const count = sorted.length;

    // 実デッキのブロックはだいたい 3〜5列、複数行、40枚前後。
    if (cols < 2 || cols > 6 || rows < 7) return null;

    let score = 0;
    score += Math.abs(count - MAIN_DECK_COUNT) * 6;
    score += Math.abs(cols - 3) * 18;
    score += Math.abs(rows - 14) * 1.2;
    score += Math.max(0, count - 60) * 3;

    // なるべく狭いブロックを優先。ページ全体の巨大コンテナを避ける。
    const area = Math.max(1, rootRect.width * rootRect.height);
    score += Math.log(area) * 4;

    // 実デッキはメイン見出し直後に出やすいので、上にある候補をやや優先。
    const minTop = Math.min(...tops);
    score += Math.max(0, minTop) / 1800;

    return { root, imgs: sorted, score, count, cols, rows, area, minTop };
  }

  function collectFromBestVisualBlock() {
    const mainTop = isGachiMatome() ? findGachiMainHeaderTop() : null;
    const baseImgs = getCardImgsFrom(document, mainTop);
    if (baseImgs.length < MAIN_DECK_COUNT) return null;

    const roots = new Set();
    for (const img of baseImgs) {
      let el = img.parentElement;
      let depth = 0;
      while (el && el !== document.body && el !== document.documentElement && depth < 10) {
        roots.add(el);
        el = el.parentElement;
        depth++;
      }
    }

    const candidates = [];
    for (const root of roots) {
      const imgs = getCardImgsFrom(root, mainTop);
      if (imgs.length < MAIN_DECK_COUNT || imgs.length > 140) continue;
      const scored = scoreVisualDeckBlock(root, imgs);
      if (scored) candidates.push(scored);
    }

    candidates.sort((a, b) => a.score - b.score);
    const best = candidates[0];
    if (!best) return null;

    // ページ全体を拾っているだけの弱い候補なら採用しない。
    if (best.count > 80 && candidates.some((c) => c.count <= 55)) {
      const tighter = candidates.find((c) => c.count <= 55);
      if (tighter) {
        const urls = tighter.imgs.slice(0, MAIN_DECK_COUNT).map(getImageSrc).filter(Boolean).map(toLargeImageUrl);
        setStatus(`Android Chrome v1.3: 実デッキ候補ブロックを使用\n候補${tighter.count}枚 / ${tighter.cols}列 / ${tighter.rows}行`);
        return urls;
      }
    }

    const urls = best.imgs.slice(0, MAIN_DECK_COUNT).map(getImageSrc).filter(Boolean).map(toLargeImageUrl);
    setStatus(`Android Chrome v1.3: 実デッキ候補ブロックを使用\n候補${best.count}枚 / ${best.cols}列 / ${best.rows}行`);
    return urls;
  }

  function collectLargeUrls() {
    // v1.3: スマホDOMでは同じカードが複数ブロックに重複して出るため、
    // ページ全体の頻度から復元すると順番・枚数が壊れることがある。
    // まず「40枚前後のカード画像を含む実デッキの表示ブロック」をDOM上から探して、その中だけを使う。
    const byBlock = collectFromBestVisualBlock();
    if (byBlock && byBlock.length >= MAIN_DECK_COUNT) {
      return byBlock.slice(0, MAIN_DECK_COUNT);
    }

    const imgs = isGachiMatome() ? collectGachiMatomeImages() : isDeckMaker() ? collectDeckMakerImages() : [];
    let urls = imgs.map(getImageSrc).filter(Boolean).map(toLargeImageUrl);

    // ブロック検出が失敗したときだけ、旧補正へフォールバック。
    urls = stripDeckMakerMobileIntroUrls(urls);
    return urls.slice(0, MAIN_DECK_COUNT);
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
    console.log('[Deck → GitHub A4 Android bookmarklet v1.3]', text);
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
