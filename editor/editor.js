/* /editor/editor.js
 * Simple visual editor for a static site, backed by the GitHub REST API.
 *
 * Security note: the "password" here is cosmetic — anyone reading this JS
 * can see it. Real security is the GitHub token, stored in localStorage on
 * the user's machine. This will be replaced by Supabase auth later.
 */
(function () {
  'use strict';

  const PASSWORD = 'Lionsden20134';
  const REPO_OWNER = 'DenFCS';
  const REPO_NAME = 'website';
  const BRANCH = 'main';
  const STAGING_HTML_PATH = 'stagingsite/index.html';
  const STAGING_IMG_PATH_PREFIX = 'stagingsite/';
  const PAT_KEY = 'denfcs_editor_pat';
  const AUTH_KEY = 'denfcs_editor_unlocked';

  // ---------- State ----------
  const state = {
    // filename -> { dataUrl, mime, bytes (Uint8Array) } for images changed in this session
    pendingImages: new Map(),
    // set of element identifiers that have been textually edited
    textDirtyCount: 0,
    frameReady: false,
    iframeDoc: null,
    originalHtml: '',
  };

  // ---------- Elements ----------
  const $ = s => document.querySelector(s);
  const gate = $('#gate');
  const gateForm = $('#gate-form');
  const gateInput = $('#gate-input');
  const gateErr = $('#gate-err');
  const app = $('#app');
  const frame = $('#frame');
  const statusEl = $('#status');
  const dirtyCountEl = $('#dirty-count');
  const toast = $('#toast');

  // ---------- Gate ----------
  function unlock() {
    gate.hidden = true;
    app.hidden = false;
    loadStagingIntoFrame();
  }

  if (sessionStorage.getItem(AUTH_KEY) === '1') {
    unlock();
  }

  gateForm.addEventListener('submit', (e) => {
    e.preventDefault();
    if (gateInput.value === PASSWORD) {
      sessionStorage.setItem(AUTH_KEY, '1');
      unlock();
    } else {
      gateErr.textContent = 'Incorrect password';
      gateInput.select();
    }
  });

  // ---------- Load staging HTML into iframe ----------
  async function loadStagingIntoFrame() {
    setStatus('loading staging…');
    try {
      // Cachebust to always get latest
      const res = await fetch('/stagingsite/index.html?ts=' + Date.now(), { cache: 'no-store' });
      let html = await res.text();
      state.originalHtml = html;

      // Strip banner + base so the editor sees a "clean" page with relative urls
      html = html
        .replace(/<!-- staging-banner-start -->[\s\S]*?<!-- staging-banner-end -->\s*/g, '')
        .replace(/<!-- staging-base-start -->[\s\S]*?<!-- staging-base-end -->\s*/g, '');

      // Write into iframe. Use srcdoc so we can inject fresh instrumentation.
      frame.srcdoc = html;
      frame.onload = () => {
        state.iframeDoc = frame.contentDocument;
        // Ensure relative URLs resolve from site root (since iframe is /editor/)
        if (!state.iframeDoc.querySelector('base')) {
          const base = state.iframeDoc.createElement('base');
          base.href = '/';
          state.iframeDoc.head.insertBefore(base, state.iframeDoc.head.firstChild);
        }
        instrumentIframe();
        state.frameReady = true;
        setStatus('ready');
      };
    } catch (err) {
      setStatus('load failed');
      showToast('Failed to load staging: ' + err.message, true);
    }
  }

  // ---------- Instrument iframe: make text + images editable ----------
  const INJECTED_CSS = `
    [data-edit-text] { outline: 2px solid transparent; transition: outline-color .15s; cursor: text; }
    [data-edit-text]:hover { outline-color: rgba(200,168,78,0.6); }
    [data-edit-text][contenteditable="true"] { outline-color: #C8A84E; background: rgba(200,168,78,0.08); }
    img[data-edit-img] { outline: 2px solid transparent; transition: outline-color .15s; cursor: pointer; }
    img[data-edit-img]:hover { outline-color: rgba(200,168,78,0.9); outline-offset: 2px; }
    .editor-image-pending { outline: 2px solid #C8A84E !important; outline-offset: 2px; }
  `;

  // Heuristic: elements whose text content should be editable.
  // We target "leaf-ish" text nodes: headings, paragraphs, list items, spans with direct text.
  const TEXT_TAGS = new Set(['H1','H2','H3','H4','H5','H6','P','LI','SPAN','EM','STRONG','A','BUTTON','SMALL','BLOCKQUOTE','FIGCAPTION','DIV']);

  function instrumentIframe() {
    const doc = state.iframeDoc;

    const style = doc.createElement('style');
    style.textContent = INJECTED_CSS;
    doc.head.appendChild(style);

    // Block iframe scripts from navigating away while editing
    doc.addEventListener('click', (e) => {
      const a = e.target.closest && e.target.closest('a');
      if (a && !a.hasAttribute('data-edit-text')) {
        e.preventDefault();
      }
    }, true);

    // Mark text nodes
    doc.querySelectorAll('body *').forEach((el) => {
      if (!TEXT_TAGS.has(el.tagName)) return;
      if (el.querySelector('*')) {
        // Has children — only mark if direct text child exists
        const hasDirectText = Array.from(el.childNodes).some(n => n.nodeType === 3 && n.nodeValue.trim().length);
        if (!hasDirectText) return;
        // Mark only the text-only children via a narrower strategy — actually simpler:
        // if hasDirectText, skip full-element editing (would lose children)
        return;
      }
      const txt = (el.textContent || '').trim();
      if (!txt) return;
      if (el.closest('script,style,noscript')) return;
      el.setAttribute('data-edit-text', '1');
      el.setAttribute('data-orig-text', el.textContent);
      el.addEventListener('click', onTextClick);
      el.addEventListener('blur', onTextBlur, true);
      el.addEventListener('input', onTextInput);
      el.addEventListener('keydown', onTextKeydown);
    });

    // Mark images
    doc.querySelectorAll('img').forEach((img) => {
      img.setAttribute('data-edit-img', '1');
      img.setAttribute('data-orig-src', img.getAttribute('src') || '');
      img.addEventListener('click', onImageClick);
    });

    updateDirtyCount();
  }

  function onTextClick(e) {
    const el = e.currentTarget;
    if (el.getAttribute('contenteditable') !== 'true') {
      el.setAttribute('contenteditable', 'true');
      el.focus();
      // Place caret where clicked (default behavior)
    }
  }
  function onTextInput(e) {
    updateDirtyCount();
  }
  function onTextKeydown(e) {
    // Enter in single-line-ish containers → blur
    if (e.key === 'Enter' && !e.shiftKey && e.currentTarget.tagName !== 'P') {
      e.preventDefault();
      e.currentTarget.blur();
    }
    if (e.key === 'Escape') {
      e.currentTarget.textContent = e.currentTarget.getAttribute('data-orig-text');
      e.currentTarget.blur();
      updateDirtyCount();
    }
  }
  function onTextBlur(e) {
    e.currentTarget.removeAttribute('contenteditable');
    updateDirtyCount();
  }

  function isTextDirty(el) {
    return (el.textContent || '') !== (el.getAttribute('data-orig-text') || '');
  }

  function updateDirtyCount() {
    const doc = state.iframeDoc;
    if (!doc) return;
    const txtDirty = Array.from(doc.querySelectorAll('[data-edit-text]')).filter(isTextDirty).length;
    const imgDirty = state.pendingImages.size;
    const total = txtDirty + imgDirty;
    dirtyCountEl.textContent = total;
    dirtyCountEl.classList.toggle('dirty', total > 0);
  }

  // ---------- Image replacement ----------
  function onImageClick(e) {
    e.preventDefault();
    e.stopPropagation();
    const img = e.currentTarget;
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.onchange = () => {
      const file = input.files[0];
      if (!file) return;
      handleImageFile(img, file);
    };
    input.click();
  }

  async function handleImageFile(imgEl, file) {
    const origWidth = imgEl.naturalWidth;
    const origHeight = imgEl.naturalHeight;

    // Load the new file as an image
    const newImg = await fileToImage(file);

    if (newImg.naturalWidth === origWidth && newImg.naturalHeight === origHeight) {
      // Exact match — no crop needed, use as-is
      const dataUrl = await fileToDataURL(file);
      applyImageReplacement(imgEl, file, dataUrl);
      return;
    }

    // Different dims — open crop/reposition modal
    openCropModal({
      imgEl,
      file,
      newImg,
      targetW: origWidth,
      targetH: origHeight,
    });
  }

  function fileToImage(file) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = url;
    });
  }
  function fileToDataURL(file) {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result);
      r.onerror = reject;
      r.readAsDataURL(file);
    });
  }

  // ---------- Crop modal ----------
  const cropModal = $('#crop-modal');
  const cropFrame = $('#crop-frame');
  const cropImgEl = $('#crop-img');
  const cropInfo = $('#crop-info');
  const cropZoom = $('#crop-zoom');
  let cropState = null;

  function openCropModal(ctx) {
    const { imgEl, file, newImg, targetW, targetH } = ctx;
    cropInfo.textContent =
      `Original slot: ${targetW}×${targetH}px · ` +
      `Uploaded: ${newImg.naturalWidth}×${newImg.naturalHeight}px. ` +
      `Drag + zoom to frame the shot.`;

    // Size the visible frame to max 480×? while preserving target aspect
    const maxW = 480;
    const scale = Math.min(1, maxW / targetW);
    const fw = Math.round(targetW * scale);
    const fh = Math.round(targetH * scale);
    cropFrame.style.width = fw + 'px';
    cropFrame.style.height = fh + 'px';

    // The natural image fits inside with initial "cover" behavior
    cropImgEl.src = newImg.src;

    // Compute the min zoom such that the image still fully covers the frame
    const coverZoom = Math.max(fw / newImg.naturalWidth, fh / newImg.naturalHeight);
    cropZoom.min = Math.round(coverZoom * 100);
    cropZoom.max = Math.round(coverZoom * 400);
    cropZoom.value = cropZoom.min;

    cropState = {
      ctx, fw, fh, scale,
      zoom: coverZoom,    // visible-scale zoom (what the slider shows / 100)
      coverZoom,
      tx: 0, ty: 0,       // translation in frame coords
      dragging: false, sx: 0, sy: 0,
      naturalW: newImg.naturalWidth, naturalH: newImg.naturalHeight,
    };
    // Center image
    const dispW = cropState.naturalW * cropState.zoom;
    const dispH = cropState.naturalH * cropState.zoom;
    cropState.tx = (fw - dispW) / 2;
    cropState.ty = (fh - dispH) / 2;
    applyCropTransform();
    cropModal.hidden = false;
  }

  function applyCropTransform() {
    const s = cropState;
    cropImgEl.style.transform = `translate(${s.tx}px, ${s.ty}px) scale(${s.zoom})`;
    cropImgEl.style.width = s.naturalW + 'px';
    cropImgEl.style.height = s.naturalH + 'px';
  }

  function clampTranslation() {
    const s = cropState;
    const dispW = s.naturalW * s.zoom;
    const dispH = s.naturalH * s.zoom;
    const minX = s.fw - dispW;
    const minY = s.fh - dispH;
    s.tx = Math.min(0, Math.max(minX, s.tx));
    s.ty = Math.min(0, Math.max(minY, s.ty));
  }

  cropZoom.addEventListener('input', () => {
    const s = cropState; if (!s) return;
    const prevZoom = s.zoom;
    s.zoom = Number(cropZoom.value) / 100;
    // Zoom relative to frame center
    const cx = s.fw / 2, cy = s.fh / 2;
    const ratio = s.zoom / prevZoom;
    s.tx = cx - (cx - s.tx) * ratio;
    s.ty = cy - (cy - s.ty) * ratio;
    clampTranslation();
    applyCropTransform();
  });

  cropFrame.addEventListener('mousedown', (e) => {
    const s = cropState; if (!s) return;
    s.dragging = true;
    s.sx = e.clientX - s.tx;
    s.sy = e.clientY - s.ty;
  });
  window.addEventListener('mousemove', (e) => {
    const s = cropState; if (!s || !s.dragging) return;
    s.tx = e.clientX - s.sx;
    s.ty = e.clientY - s.sy;
    clampTranslation();
    applyCropTransform();
  });
  window.addEventListener('mouseup', () => {
    if (cropState) cropState.dragging = false;
  });

  $('#crop-cancel').addEventListener('click', () => {
    cropModal.hidden = true;
    cropState = null;
  });
  $('#crop-ok').addEventListener('click', async () => {
    const s = cropState;
    if (!s) return;
    // Render to an offscreen canvas at the TARGET dims (original image slot size).
    // Compute source rect in natural coords:
    // visible frame shows the region: src.x = -s.tx / s.zoom, src.y = -s.ty / s.zoom
    // src size = s.fw / s.zoom × s.fh / s.zoom
    const srcX = -s.tx / s.zoom;
    const srcY = -s.ty / s.zoom;
    const srcW = s.fw / s.zoom;
    const srcH = s.fh / s.zoom;

    const { imgEl, file, targetW, targetH } = s.ctx;
    const canvas = document.createElement('canvas');
    canvas.width = targetW;
    canvas.height = targetH;
    const ctx = canvas.getContext('2d');
    const image = new Image();
    image.src = cropImgEl.src;
    await new Promise(r => image.onload = r);
    ctx.drawImage(image, srcX, srcY, srcW, srcH, 0, 0, targetW, targetH);

    // Output to blob in same format as original file (fallback jpeg)
    const outMime = file.type && file.type.startsWith('image/') ? file.type : 'image/jpeg';
    canvas.toBlob(async (blob) => {
      const dataUrl = await blobToDataURL(blob);
      applyImageReplacement(imgEl, blob, dataUrl);
      cropModal.hidden = true;
      cropState = null;
    }, outMime, 0.92);
  });

  function blobToDataURL(blob) {
    return new Promise((resolve, reject) => {
      const r = new FileReader(); r.onload = () => resolve(r.result); r.onerror = reject; r.readAsDataURL(blob);
    });
  }

  function applyImageReplacement(imgEl, blobOrFile, dataUrl) {
    // Decide a filename to write to repo. Keep the original filename so all refs still work.
    const origSrc = imgEl.getAttribute('data-orig-src');
    const fname = origSrc.split('/').pop().split('?')[0];
    // Store pending bytes
    blobToUint8(blobOrFile).then(bytes => {
      state.pendingImages.set(fname, {
        mime: blobOrFile.type || 'image/jpeg',
        bytes,
      });
      imgEl.src = dataUrl;
      imgEl.classList.add('editor-image-pending');
      updateDirtyCount();
    });
  }
  function blobToUint8(blob) {
    return blob.arrayBuffer().then(buf => new Uint8Array(buf));
  }

  // ---------- Toolbar actions ----------
  $('#btn-reset').addEventListener('click', async () => {
    if (!confirm('Discard all unsaved edits and reload from staging?')) return;
    state.pendingImages.clear();
    state.textDirtyCount = 0;
    await loadStagingIntoFrame();
    showToast('Reset to current staging');
  });

  $('#btn-preview').addEventListener('click', () => {
    window.open('/stagingsite/', '_blank');
  });

  $('#btn-push').addEventListener('click', () => pushToStaging());

  // ---------- Push to Staging ----------
  async function pushToStaging() {
    if (!state.frameReady) return;
    const pat = await ensurePat();
    if (!pat) return;

    const doc = state.iframeDoc;

    // Rebuild HTML: take original staging HTML, then apply text edits to the DOM inside.
    // Simplest: use a parser on state.originalHtml, then patch.
    const parser = new DOMParser();
    const cleanSource = state.originalHtml
      .replace(/<!-- staging-banner-start -->[\s\S]*?<!-- staging-banner-end -->\s*/g, '')
      .replace(/<!-- staging-base-start -->[\s\S]*?<!-- staging-base-end -->\s*/g, '');
    const srcDoc = parser.parseFromString(cleanSource, 'text/html');

    // Apply text edits. We locate matching elements by a deterministic indexed selector:
    // "<tag>:nth-of-type across body", same as in the iframe. Simpler: enumerate all
    // text-marked elements in iframe and in srcDoc using matching tree positions.
    const applyTextEdits = () => {
      const edited = Array.from(doc.querySelectorAll('[data-edit-text]')).filter(isTextDirty);
      if (!edited.length) return 0;
      // Build a map: path → newText
      const patches = edited.map(el => ({
        path: buildPath(el, doc.body),
        newText: el.textContent,
      }));
      let applied = 0;
      for (const p of patches) {
        const target = resolvePath(srcDoc.body, p.path);
        if (target) { target.textContent = p.newText; applied++; }
      }
      return applied;
    };

    setStatus('pushing…');
    try {
      const textApplied = applyTextEdits();

      // Serialize: take the srcDoc back to string, then reinsert staging markers.
      let outHtml = '<!DOCTYPE html>\n' + srcDoc.documentElement.outerHTML;
      // Reinsert the base tag + banner hook exactly where they were originally,
      // so "Push to Staging" keeps staging-only machinery alive.
      outHtml = outHtml.replace(
        /<meta name="viewport"[^>]*>/,
        (m) => m + '\n  <!-- staging-base-start --><base href="/"><!-- staging-base-end -->'
      );
      outHtml = outHtml.replace(
        /<\/body>/,
        '  <!-- staging-banner-start -->\n  <script src="/stagingsite/banner.js" defer><\/script>\n  <!-- staging-banner-end -->\n</body>'
      );

      // Push images first
      let imgCount = 0;
      for (const [fname, { mime, bytes }] of state.pendingImages) {
        const stagingFile = STAGING_IMG_PATH_PREFIX + fname;
        setStatus(`uploading ${fname}…`);
        await putFile(stagingFile, bytes, `Editor: replace ${fname}`);
        imgCount++;
      }

      // Then push HTML
      setStatus('uploading index.html…');
      await putFileText(STAGING_HTML_PATH, outHtml, `Editor: update staging (${textApplied} text, ${imgCount} image)`);

      state.pendingImages.clear();
      state.originalHtml = outHtml;
      Array.from(doc.querySelectorAll('[data-edit-text]')).forEach(el => {
        el.setAttribute('data-orig-text', el.textContent);
      });
      doc.querySelectorAll('img.editor-image-pending').forEach(i => i.classList.remove('editor-image-pending'));
      updateDirtyCount();

      setStatus('pushed ✓');
      showToast('Pushed to staging. Opening preview…');
      setTimeout(() => window.open('/stagingsite/?ts=' + Date.now(), '_blank'), 600);
    } catch (err) {
      setStatus('push failed');
      showToast('Push failed: ' + err.message, true);
    }
  }

  // ---------- GitHub API ----------
  async function gh(path, opts = {}) {
    const pat = await ensurePat(); if (!pat) throw new Error('No token');
    const res = await fetch(`https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}${path}`, {
      ...opts,
      headers: {
        'Authorization': `token ${pat}`,
        'Accept': 'application/vnd.github.v3+json',
        ...(opts.headers || {}),
      },
    });
    if (!res.ok) {
      let msg;
      try { msg = (await res.json()).message; } catch { msg = await res.text(); }
      throw new Error(`GitHub API ${res.status}: ${msg}`);
    }
    return res.json();
  }
  async function getFileSha(path) {
    try {
      const j = await gh(`/contents/${encodeURIComponent(path).replace(/%2F/g,'/')}?ref=${BRANCH}`);
      return j.sha;
    } catch (e) { return null; }
  }
  async function putFile(path, bytes, message) {
    const sha = await getFileSha(path);
    const b64 = bytesToBase64(bytes);
    await gh(`/contents/${encodeURIComponent(path).replace(/%2F/g,'/')}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message, content: b64, branch: BRANCH, ...(sha ? { sha } : {}) }),
    });
  }
  async function putFileText(path, text, message) {
    const sha = await getFileSha(path);
    const b64 = utf8ToBase64(text);
    await gh(`/contents/${encodeURIComponent(path).replace(/%2F/g,'/')}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message, content: b64, branch: BRANCH, ...(sha ? { sha } : {}) }),
    });
  }
  function bytesToBase64(bytes) {
    // Chunked to avoid call-stack limits on large images
    let bin = ''; const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) {
      bin += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
    }
    return btoa(bin);
  }
  function utf8ToBase64(s) { return btoa(unescape(encodeURIComponent(s))); }

  // ---------- PAT flow ----------
  async function ensurePat() {
    let pat = localStorage.getItem(PAT_KEY);
    if (pat) return pat;
    return new Promise(resolve => {
      const modal = $('#pat-modal');
      const input = $('#pat-input');
      input.value = '';
      modal.hidden = false;
      input.focus();
      $('#pat-cancel').onclick = () => { modal.hidden = true; resolve(null); };
      $('#pat-save').onclick = () => {
        const v = input.value.trim();
        if (!v.startsWith('ghp_') && !v.startsWith('github_pat_')) {
          alert('That does not look like a GitHub token. Should start with ghp_ or github_pat_.');
          return;
        }
        localStorage.setItem(PAT_KEY, v);
        modal.hidden = true;
        resolve(v);
      };
    });
  }

  // ---------- Path utilities: stable element addressing ----------
  // For each edited element, build a path like [{tag:'DIV', idx:2}, {tag:'P', idx:0}, ...]
  function buildPath(el, root) {
    const path = [];
    let cur = el;
    while (cur && cur !== root) {
      const parent = cur.parentElement;
      if (!parent) break;
      const sibs = Array.from(parent.children).filter(c => c.tagName === cur.tagName);
      const idx = sibs.indexOf(cur);
      path.unshift({ tag: cur.tagName, idx });
      cur = parent;
    }
    return path;
  }
  function resolvePath(root, path) {
    let cur = root;
    for (const step of path) {
      const kids = Array.from(cur.children).filter(c => c.tagName === step.tag);
      cur = kids[step.idx];
      if (!cur) return null;
    }
    return cur;
  }

  // ---------- UI helpers ----------
  function setStatus(s) { statusEl.textContent = s; }
  function showToast(msg, isErr) {
    toast.textContent = msg;
    toast.className = 'toast' + (isErr ? ' err' : '');
    toast.hidden = false;
    clearTimeout(showToast._t);
    showToast._t = setTimeout(() => toast.hidden = true, 4000);
  }
})();
