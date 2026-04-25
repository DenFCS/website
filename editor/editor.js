/* /editor/editor.js v=6
 * Visual editor for the DenFCS static site.
 * v6: multi-page support, button text+url editor (real pencil), mixed-content
 * heading wrapping so every word is editable, full-DOM save.
 */
(function () {
  'use strict';

  const PASSWORD = 'Lionsden20134';
  const REPO_OWNER = 'DenFCS';
  const REPO_NAME = 'website';
  const BRANCH = 'main';
  const PAT_KEY = 'denfcs_editor_pat';
  const AUTH_KEY = 'denfcs_editor_unlocked';

  /** Pages we know how to edit. Add more here as they're created. */
  const PAGES = [
    {
      id: 'home',
      label: 'Home (/)',
      stagingSrc: '/stagingsite/index.html',
      stagingPath: 'stagingsite/index.html',    // for GitHub API write
      prodPath: 'index.html',                    // where it lives on prod
      previewUrl: '/stagingsite/',
    },
    {
      id: 'summerprogram',
      label: 'Summer Program (/summerprogram/)',
      stagingSrc: '/stagingsite/summerprogram/index.html',
      stagingPath: 'stagingsite/summerprogram/index.html',
      prodPath: 'summerprogram/index.html',
      previewUrl: '/stagingsite/summerprogram/',
    },
  ];

  const state = {
    page: PAGES[0],
    pendingImages: new Map(),   // filename -> { mime, bytes }
    newImageCounter: 0,
    dirty: false,
    frameReady: false,
    iframeDoc: null,
    originalHtml: '',
  };

  const $ = s => document.querySelector(s);

  // ============================================================
  //  PASSWORD GATE
  // ============================================================
  const gate = $('#gate');
  const gateForm = $('#gate-form');
  const gateInput = $('#gate-input');
  const gateErr = $('#gate-err');
  const app = $('#app');

  function unlock() {
    gate.hidden = true;
    app.hidden = false;
    populatePagePicker();
    loadPageIntoFrame(state.page);
  }
  // Defer the auto-unlock until the rest of this IIFE finishes initializing
  // all the const declarations below (pagePicker, frame, statusEl, etc.).
  // Otherwise unlock() hits a temporal-dead-zone ReferenceError on refresh.
  if (sessionStorage.getItem(AUTH_KEY) === '1') setTimeout(unlock, 0);

  function tryUnlock() {
    const entered = (gateInput.value || '').trim();
    if (entered === PASSWORD) {
      sessionStorage.setItem(AUTH_KEY, '1');
      unlock(); return true;
    }
    gateErr.textContent = 'Incorrect password';
    gateInput.select(); return false;
  }
  gateForm.addEventListener('submit', e => { e.preventDefault(); tryUnlock(); });
  document.getElementById('gate-btn').addEventListener('click', e => { e.preventDefault(); tryUnlock(); });
  gateInput.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); tryUnlock(); } });

  // ============================================================
  //  PAGE PICKER
  // ============================================================
  const pagePicker = $('#page-picker');
  function populatePagePicker() {
    pagePicker.innerHTML = '';
    PAGES.forEach(p => {
      const opt = document.createElement('option');
      opt.value = p.id; opt.textContent = p.label;
      pagePicker.appendChild(opt);
    });
    pagePicker.value = state.page.id;
  }
  // When returning to the editor tab (e.g. after clicking Preview), some
  // browsers drop the iframe's srcdoc contents, leaving a blank canvas.
  // Detect that and silently re-load the current page.
  function reloadIfBlank() {
    if (!state.frameReady) return;
    try {
      const b = state.iframeDoc && state.iframeDoc.body;
      if (!b || b.children.length === 0) {
        // Blank — reload (unless user had unsaved changes we might wipe)
        if (state.dirty) { showToast('Canvas blanked. Your unsaved edits were lost — click Discard to reload.'); return; }
        loadPageIntoFrame(state.page);
      }
    } catch (err) {
      // iframe document detached → same remedy
      if (!state.dirty) loadPageIntoFrame(state.page);
    }
  }
  window.addEventListener('focus', reloadIfBlank);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) reloadIfBlank(); });

  pagePicker.addEventListener('change', async () => {
    const next = PAGES.find(p => p.id === pagePicker.value);
    if (!next || next.id === state.page.id) return;
    if (state.dirty) {
      if (!confirm('You have unsaved changes on ' + state.page.label + '. Switch pages and discard them?')) {
        pagePicker.value = state.page.id;
        return;
      }
    }
    state.pendingImages.clear();
    state.page = next;
    await loadPageIntoFrame(next);
  });

  // ============================================================
  //  LOAD PAGE
  // ============================================================
  const frame = $('#frame');
  const statusEl = $('#status');

  async function loadPageIntoFrame(page) {
    setStatus('loading ' + page.label + '…');
    try {
      const res = await fetch(page.stagingSrc + '?ts=' + Date.now(), { cache: 'no-store' });
      if (!res.ok) throw new Error(`${res.status}: ${page.stagingSrc}`);
      let html = await res.text();
      state.originalHtml = html;

      // Strip staging banner for the editing iframe (we re-add on save)
      html = html.replace(/<!-- staging-banner-start -->[\s\S]*?<!-- staging-banner-end -->\s*/g, '');
      if (!/<base\s/i.test(html)) {
        html = html.replace(/<head[^>]*>/i, m => m + '\n  <base href="/">');
      }

      frame.srcdoc = html;
      frame.onload = () => {
        state.iframeDoc = frame.contentDocument;
        instrumentIframe();
        state.frameReady = true;
        renderSectionsList();
        // Belt-and-suspenders: if site scripts in the iframe mutate the DOM
        // after onload fires, re-render the sections list a couple more times.
        setTimeout(() => renderSectionsList(), 400);
        setTimeout(() => renderSectionsList(), 1200);
        // Also watch for structural changes so the list stays in sync.
        if (state.bodyObserver) state.bodyObserver.disconnect();
        state.bodyObserver = new MutationObserver(() => {
          clearTimeout(state.bodyObserverDebounce);
          state.bodyObserverDebounce = setTimeout(renderSectionsList, 150);
        });
        state.bodyObserver.observe(state.iframeDoc.body, { childList: true });
        clearDirty();
        setStatus('ready (' + page.label + ')');
      };
    } catch (err) {
      setStatus('load failed');
      showToast('Failed to load ' + page.label + ': ' + err.message, true);
    }
  }

  // ============================================================
  //  IFRAME INSTRUMENTATION
  // ============================================================

  const INJECTED_CSS = `
    [data-edit-text] { outline: 2px solid transparent; transition: outline-color .15s; cursor: text; }
    [data-edit-text]:hover { outline-color: rgba(200,168,78,0.6); }
    [data-edit-text][contenteditable="true"] { outline-color: #C8A84E; background: rgba(200,168,78,0.08); }
    img[data-edit-img] { outline: 2px solid transparent; transition: outline-color .15s; cursor: pointer; }
    img[data-edit-img]:hover { outline-color: rgba(200,168,78,0.9); outline-offset: 2px; }
    .editor-image-pending { outline: 2px solid #C8A84E !important; outline-offset: 2px; }

    /* Floating pencil for link editor, injected into the iframe */
    .editor-link-pencil {
      position: absolute; z-index: 99999;
      background: #C8A84E; color: #0D0D0D;
      font: 700 11px/1 -apple-system, BlinkMacSystemFont, sans-serif;
      padding: 5px 7px; border: none; border-radius: 2px;
      cursor: pointer; letter-spacing: 0.1em; text-transform: uppercase;
      box-shadow: 0 2px 8px rgba(0,0,0,0.35);
      user-select: none;
    }
    .editor-link-pencil:hover { background: #E0C872; }

    /* Section label tag on hover */
    section[data-section]:hover::before,
    footer[data-section]:hover::before,
    nav[data-section]:hover::before,
    header[data-section]:hover::before {
      content: attr(data-section-label);
      position: absolute; top: 6px; left: 6px;
      background: rgba(13,13,13,0.9); color: #C8A84E;
      font: 600 10px/1 -apple-system, sans-serif; letter-spacing: 0.15em; text-transform: uppercase;
      padding: 4px 7px; border-radius: 2px;
      z-index: 9999; pointer-events: none;
      outline: 1px solid #C8A84E;
    }
    section[data-section], footer[data-section], nav[data-section], header[data-section] { position: relative; }
  `;

  // Elements that may contain raw text to make editable.
  // NOTE: A is intentionally INCLUDED — we want button text editable.
  const TEXT_TAGS = new Set([
    'H1','H2','H3','H4','H5','H6','P','LI','SPAN','EM','STRONG','SMALL',
    'BLOCKQUOTE','FIGCAPTION','DIV','BUTTON','A','LABEL','DT','DD','TD','TH','CAPTION'
  ]);

  function instrumentIframe() {
    const doc = state.iframeDoc;
    const existingStyle = doc.getElementById('editor-injected-style');
    if (existingStyle) existingStyle.remove();
    const style = doc.createElement('style');
    style.id = 'editor-injected-style';
    style.textContent = INJECTED_CSS;
    doc.head.appendChild(style);

    // Wrap raw text children of mixed-content elements in spans so they
    // can be edited word-group-by-word-group (e.g., the "What's" in
    // <h2>What's <em>Running Now.</em></h2>).
    wrapMixedContentTextNodes(doc.body);

    // Text-click-to-edit
    instrumentTexts(doc.body);
    // Image-click-to-replace
    instrumentImages(doc.body);
    // Link pencil
    instrumentLinks(doc.body);
    // Section labels
    instrumentSections(doc);

    // Global click prevention for any href navigation from within the editor.
    doc.addEventListener('click', blockNavigation, true);
  }

  function blockNavigation(e) {
    // If user clicked a pencil we injected, let it handle its own click.
    if (e.target.classList && e.target.classList.contains('editor-link-pencil')) return;
    const a = e.target.closest && e.target.closest('a');
    if (!a) return;
    // Prevent the iframe from navigating away.
    e.preventDefault();
  }

  function wrapMixedContentTextNodes(root) {
    // Walk every element; for each with >1 child nodes and a mix of
    // real text nodes + element children, wrap each text node.
    const walker = root.ownerDocument.createTreeWalker(root, NodeFilter.SHOW_ELEMENT, null);
    const toProcess = [];
    let cur = walker.currentNode;
    while (cur) {
      if (cur.childNodes.length > 1 && cur.tagName && TEXT_TAGS.has(cur.tagName)) {
        const hasEl = Array.from(cur.childNodes).some(n => n.nodeType === 1);
        const hasText = Array.from(cur.childNodes).some(n => n.nodeType === 3 && n.nodeValue.trim());
        if (hasEl && hasText) toProcess.push(cur);
      }
      cur = walker.nextNode();
    }
    toProcess.forEach(el => {
      Array.from(el.childNodes).forEach(n => {
        if (n.nodeType !== 3) return;
        if (!n.nodeValue.trim()) return;      // whitespace only — skip
        // Skip if already wrapped on a previous pass
        if (n.parentNode.getAttribute && n.parentNode.getAttribute('data-text-wrap') === '1') return;
        const span = root.ownerDocument.createElement('span');
        span.setAttribute('data-text-wrap', '1');
        span.textContent = n.nodeValue;
        n.parentNode.replaceChild(span, n);
      });
    });
  }

  function instrumentTexts(root) {
    root.querySelectorAll('*').forEach(el => {
      if (!TEXT_TAGS.has(el.tagName)) return;
      if (el.hasAttribute('data-edit-text')) return;
      if (el.closest('script,style,noscript')) return;
      if (el.querySelector('*')) {
        // Mixed-content: skip this element (children were wrapped to handle text)
        return;
      }
      const txt = (el.textContent || '').trim();
      if (!txt) return;
      el.setAttribute('data-edit-text', '1');
      el.addEventListener('click', onTextClick);
      el.addEventListener('blur', onTextBlur, true);
      el.addEventListener('input', markDirty);
      el.addEventListener('keydown', onTextKeydown);
    });
  }

  function instrumentImages(root) {
    root.querySelectorAll('img').forEach(img => {
      if (img.hasAttribute('data-edit-img')) return;
      img.setAttribute('data-edit-img', '1');
      img.addEventListener('click', onImageClick);
    });
  }

  function instrumentLinks(root) {
    root.querySelectorAll('a').forEach(a => {
      if (a.hasAttribute('data-edit-link')) return;
      a.setAttribute('data-edit-link', '1');
      a.addEventListener('mouseenter', showLinkPencil);
      a.addEventListener('mouseleave', maybeHideLinkPencil);
    });
  }

  function instrumentSections(doc) {
    let idx = 0;
    const all = doc.querySelectorAll('body > section, body > footer, body > nav, body > header');
    all.forEach(sec => {
      sec.setAttribute('data-section', String(idx++));
      sec.setAttribute('data-section-label', deriveSectionLabel(sec));
    });
  }
  function deriveSectionLabel(sec) {
    const h = sec.querySelector('h2, h1, h3');
    if (h && h.textContent.trim()) return h.textContent.trim().slice(0, 40);
    const e = sec.querySelector('.eyebrow');
    if (e && e.textContent.trim()) return e.textContent.trim().replace(/^—\s*|\s*—$/g, '').slice(0, 40);
    const c = (sec.className || '').split(/\s+/)[0];
    if (c) return c.replace(/[-_]/g, ' ');
    return sec.tagName.toLowerCase();
  }

  // -------- text edit callbacks --------
  function onTextClick(e) {
    const el = e.currentTarget;
    if (el.getAttribute('contenteditable') !== 'true') {
      el.setAttribute('contenteditable', 'true');
      // Place caret at click position — contenteditable handles this natively
      el.focus();
    }
  }
  function onTextKeydown(e) {
    if (e.key === 'Enter' && !e.shiftKey && e.currentTarget.tagName !== 'P') {
      e.preventDefault(); e.currentTarget.blur();
    }
    if (e.key === 'Escape') e.currentTarget.blur();
  }
  function onTextBlur(e) {
    e.currentTarget.removeAttribute('contenteditable');
    markDirty();
  }

  // -------- image edit callbacks --------
  function onImageClick(e) {
    e.preventDefault(); e.stopPropagation();
    const img = e.currentTarget;
    const input = document.createElement('input');
    input.type = 'file'; input.accept = 'image/*';
    input.onchange = () => { if (input.files[0]) handleImageFile(img, input.files[0]); };
    input.click();
  }
  async function handleImageFile(imgEl, file) {
    const origWidth = imgEl.naturalWidth || 0;
    const origHeight = imgEl.naturalHeight || 0;
    const newImg = await fileToImage(file);
    if (!origWidth || !origHeight ||
        (newImg.naturalWidth === origWidth && newImg.naturalHeight === origHeight)) {
      const dataUrl = await fileToDataURL(file);
      applyImageReplacement(imgEl, file, dataUrl); return;
    }
    openCropModal({ imgEl, file, newImg, targetW: origWidth, targetH: origHeight });
  }
  function fileToImage(file) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => resolve(img); img.onerror = reject; img.src = url;
    });
  }
  function fileToDataURL(file) {
    return new Promise((resolve, reject) => {
      const r = new FileReader(); r.onload = () => resolve(r.result); r.onerror = reject; r.readAsDataURL(file);
    });
  }

  function applyImageReplacement(imgEl, blobOrFile, dataUrl) {
    const origSrc = imgEl.getAttribute('src') || '';
    let fname = origSrc.split('/').pop().split('?')[0];
    if (!fname || fname.startsWith('data:') || fname.length === 0) {
      const ext = (blobOrFile.type || 'image/jpeg').split('/')[1] || 'jpg';
      fname = `uploaded-${Date.now()}-${++state.newImageCounter}.${ext}`;
      imgEl.setAttribute('src', fname);
    }
    blobToUint8(blobOrFile).then(bytes => {
      state.pendingImages.set(fname, { mime: blobOrFile.type || 'image/jpeg', bytes });
      imgEl.src = dataUrl;
      imgEl.classList.add('editor-image-pending');
      markDirty();
    });
  }
  function blobToUint8(blob) { return blob.arrayBuffer().then(buf => new Uint8Array(buf)); }

  // ============================================================
  //  LINK PENCIL  (appears on hover of any <a>)
  // ============================================================
  let linkPencilEl = null;
  let linkPencilTarget = null;
  let linkPencilHideTimer = null;

  function ensurePencil(doc) {
    if (linkPencilEl && linkPencilEl.ownerDocument === doc) return linkPencilEl;
    if (linkPencilEl && linkPencilEl.parentNode) linkPencilEl.parentNode.removeChild(linkPencilEl);
    linkPencilEl = doc.createElement('button');
    linkPencilEl.className = 'editor-link-pencil';
    linkPencilEl.textContent = '✎ Edit link';
    linkPencilEl.type = 'button';
    doc.body.appendChild(linkPencilEl);
    linkPencilEl.addEventListener('mouseenter', () => { if (linkPencilHideTimer) clearTimeout(linkPencilHideTimer); });
    linkPencilEl.addEventListener('mouseleave', maybeHideLinkPencil);
    linkPencilEl.addEventListener('click', (e) => {
      e.preventDefault(); e.stopPropagation();
      if (linkPencilTarget) openLinkEditor(linkPencilTarget);
    });
    return linkPencilEl;
  }

  function showLinkPencil(e) {
    const a = e.currentTarget;
    const doc = a.ownerDocument;
    ensurePencil(doc);
    if (linkPencilHideTimer) { clearTimeout(linkPencilHideTimer); linkPencilHideTimer = null; }
    linkPencilTarget = a;
    const rect = a.getBoundingClientRect();
    const win = doc.defaultView;
    const scrollY = win.scrollY || 0;
    const scrollX = win.scrollX || 0;
    linkPencilEl.style.top = (rect.top + scrollY - 24) + 'px';
    linkPencilEl.style.left = (rect.right + scrollX - 84) + 'px';
    linkPencilEl.style.display = 'inline-block';
  }
  function maybeHideLinkPencil() {
    if (linkPencilHideTimer) clearTimeout(linkPencilHideTimer);
    linkPencilHideTimer = setTimeout(() => {
      if (linkPencilEl) linkPencilEl.style.display = 'none';
      linkPencilTarget = null;
    }, 200);
  }

  // ============================================================
  //  LINK EDITOR MODAL
  // ============================================================
  const linkModal = $('#link-modal');
  const linkText = $('#link-text');
  const linkUrl = $('#link-url');
  let linkEditTarget = null;

  function openLinkEditor(a) {
    linkEditTarget = a;
    // Text: use the anchor's visible text content. Could include wrapped
    // spans; just use textContent for the dialog.
    linkText.value = (a.textContent || '').trim();
    linkUrl.value = a.getAttribute('href') || '';
    linkModal.hidden = false;
    // Hide the pencil while the modal is open
    if (linkPencilEl) linkPencilEl.style.display = 'none';
    linkUrl.focus(); linkUrl.select();
  }
  $('#link-cancel').addEventListener('click', () => { linkModal.hidden = true; linkEditTarget = null; });
  $('#link-save').addEventListener('click', () => {
    if (!linkEditTarget) return;
    const newText = (linkText.value || '').trim();
    const newUrl = (linkUrl.value || '').trim();
    if (newText) {
      // Replace text while preserving the element's structure:
      // easiest — set textContent. This wipes any child spans, which is
      // usually what the user wants for a button label.
      linkEditTarget.textContent = newText;
    }
    linkEditTarget.setAttribute('href', newUrl);
    if (newUrl.startsWith('#') || newUrl.startsWith('/')) linkEditTarget.removeAttribute('target');
    linkModal.hidden = true;
    linkEditTarget = null;
    markDirty();
    showToast('Button updated');
  });
  [linkText, linkUrl].forEach(el => el.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); $('#link-save').click(); }
    if (e.key === 'Escape') { e.preventDefault(); $('#link-cancel').click(); }
  }));

  // ============================================================
  //  CROP MODAL  (unchanged from v5)
  // ============================================================
  const cropModal = $('#crop-modal');
  const cropFrame = $('#crop-frame');
  const cropImgEl = $('#crop-img');
  const cropInfo = $('#crop-info');
  const cropZoom = $('#crop-zoom');
  let cropState = null;

  function openCropModal(ctx) {
    const { targetW, targetH, newImg } = ctx;
    cropInfo.textContent = `Original slot: ${targetW}×${targetH}px · Uploaded: ${newImg.naturalWidth}×${newImg.naturalHeight}px.`;
    const maxW = 480;
    const scale = Math.min(1, maxW / targetW);
    const fw = Math.round(targetW * scale);
    const fh = Math.round(targetH * scale);
    cropFrame.style.width = fw + 'px'; cropFrame.style.height = fh + 'px';
    cropImgEl.src = newImg.src;
    const coverZoom = Math.max(fw / newImg.naturalWidth, fh / newImg.naturalHeight);
    cropZoom.min = Math.round(coverZoom * 100);
    cropZoom.max = Math.round(coverZoom * 400);
    cropZoom.value = cropZoom.min;
    cropState = {
      ctx, fw, fh, zoom: coverZoom, coverZoom,
      tx: 0, ty: 0, dragging: false, sx: 0, sy: 0,
      naturalW: newImg.naturalWidth, naturalH: newImg.naturalHeight,
    };
    const dispW = cropState.naturalW * cropState.zoom;
    const dispH = cropState.naturalH * cropState.zoom;
    cropState.tx = (fw - dispW) / 2; cropState.ty = (fh - dispH) / 2;
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
    s.tx = Math.min(0, Math.max(s.fw - dispW, s.tx));
    s.ty = Math.min(0, Math.max(s.fh - dispH, s.ty));
  }
  cropZoom.addEventListener('input', () => {
    const s = cropState; if (!s) return;
    const prev = s.zoom; s.zoom = Number(cropZoom.value) / 100;
    const cx = s.fw / 2, cy = s.fh / 2, r = s.zoom / prev;
    s.tx = cx - (cx - s.tx) * r; s.ty = cy - (cy - s.ty) * r;
    clampTranslation(); applyCropTransform();
  });
  cropFrame.addEventListener('mousedown', e => {
    if (!cropState) return;
    cropState.dragging = true; cropState.sx = e.clientX - cropState.tx; cropState.sy = e.clientY - cropState.ty;
  });
  window.addEventListener('mousemove', e => {
    if (!cropState || !cropState.dragging) return;
    cropState.tx = e.clientX - cropState.sx; cropState.ty = e.clientY - cropState.sy;
    clampTranslation(); applyCropTransform();
  });
  window.addEventListener('mouseup', () => { if (cropState) cropState.dragging = false; });
  $('#crop-cancel').addEventListener('click', () => { cropModal.hidden = true; cropState = null; });
  $('#crop-ok').addEventListener('click', async () => {
    const s = cropState; if (!s) return;
    const srcX = -s.tx / s.zoom, srcY = -s.ty / s.zoom;
    const srcW = s.fw / s.zoom, srcH = s.fh / s.zoom;
    const { imgEl, file, targetW, targetH } = s.ctx;
    const canvas = document.createElement('canvas');
    canvas.width = targetW; canvas.height = targetH;
    const ctx = canvas.getContext('2d');
    const image = new Image(); image.src = cropImgEl.src;
    await new Promise(r => image.onload = r);
    ctx.drawImage(image, srcX, srcY, srcW, srcH, 0, 0, targetW, targetH);
    const outMime = file.type && file.type.startsWith('image/') ? file.type : 'image/jpeg';
    canvas.toBlob(async blob => {
      const dataUrl = await blobToDataURL(blob);
      applyImageReplacement(imgEl, blob, dataUrl);
      cropModal.hidden = true; cropState = null;
    }, outMime, 0.92);
  });
  function blobToDataURL(blob) {
    return new Promise((resolve, reject) => {
      const r = new FileReader(); r.onload = () => resolve(r.result); r.onerror = reject; r.readAsDataURL(blob);
    });
  }

  // ============================================================
  //  SECTIONS PANEL
  // ============================================================
  const sectionsListEl = $('#sections-list');

  function renderSectionsList() {
    const doc = state.iframeDoc; if (!doc) return;
    sectionsListEl.innerHTML = '';
    const sections = Array.from(doc.querySelectorAll('body > section, body > footer, body > header, body > nav'));
    sections.forEach((sec, i) => {
      const label = sec.getAttribute('data-section-label') || deriveSectionLabel(sec);
      sec.setAttribute('data-section-label', label);
      const tag = sec.tagName.toLowerCase();
      const row = document.createElement('li');
      row.className = 'section-row';
      row.draggable = true;
      row.dataset.index = i;
      row.innerHTML = `
        <span class="section-row-drag" title="Drag to reorder">⋮⋮</span>
        <span class="section-row-label">${escapeHtml(label)}</span>
        <span class="section-row-tag">${tag}</span>
        <span class="section-row-actions">
          <button class="sr-btn" data-act="up" title="Move up">↑</button>
          <button class="sr-btn" data-act="down" title="Move down">↓</button>
          <button class="sr-btn" data-act="dup" title="Duplicate">⎘</button>
          <button class="sr-btn danger" data-act="del" title="Delete">🗑</button>
        </span>
      `;
      row.addEventListener('click', e => {
        if (e.target.closest('.sr-btn') || e.target.closest('.section-row-drag')) return;
        sec.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
      row.querySelectorAll('.sr-btn').forEach(b => {
        b.addEventListener('click', ev => {
          ev.stopPropagation();
          const act = b.dataset.act;
          if (act === 'up') moveSection(sec, -1);
          else if (act === 'down') moveSection(sec, 1);
          else if (act === 'dup') duplicateSection(sec);
          else if (act === 'del') deleteSection(sec);
        });
      });
      row.addEventListener('dragstart', e => {
        row.classList.add('dragging');
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', String(i));
      });
      row.addEventListener('dragend', () => row.classList.remove('dragging'));
      row.addEventListener('dragover', e => { e.preventDefault(); row.classList.add('drag-over'); });
      row.addEventListener('dragleave', () => row.classList.remove('drag-over'));
      row.addEventListener('drop', e => {
        e.preventDefault(); row.classList.remove('drag-over');
        const fromIdx = Number(e.dataTransfer.getData('text/plain'));
        const toIdx = Number(row.dataset.index);
        if (!isNaN(fromIdx) && fromIdx !== toIdx) reorderSections(fromIdx, toIdx);
      });
      sectionsListEl.appendChild(row);
    });
  }

  function moveSection(sec, delta) {
    const parent = sec.parentElement;
    const target = delta < 0 ? sec.previousElementSibling : sec.nextElementSibling;
    if (!target) return;
    if (delta < 0) parent.insertBefore(sec, target);
    else parent.insertBefore(target, sec);
    markDirty(); renderSectionsList();
  }
  function reorderSections(fromIdx, toIdx) {
    const doc = state.iframeDoc;
    const sections = Array.from(doc.querySelectorAll('body > section, body > footer, body > header, body > nav'));
    const moving = sections[fromIdx]; if (!moving) return;
    const ref = sections[toIdx]; if (!ref) return;
    if (fromIdx < toIdx) ref.parentElement.insertBefore(moving, ref.nextSibling);
    else ref.parentElement.insertBefore(moving, ref);
    markDirty(); renderSectionsList();
  }
  function duplicateSection(sec) {
    const clone = sec.cloneNode(true);
    clone.removeAttribute('id');
    clone.querySelectorAll('[id]').forEach(n => n.removeAttribute('id'));
    sec.parentElement.insertBefore(clone, sec.nextSibling);
    instrumentTexts(clone);
    instrumentImages(clone);
    instrumentLinks(clone);
    instrumentSections(state.iframeDoc);
    markDirty(); renderSectionsList();
    clone.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
  function deleteSection(sec) {
    const label = sec.getAttribute('data-section-label') || 'this section';
    if (!confirm(`Delete "${label}"?`)) return;
    sec.remove();
    markDirty(); renderSectionsList();
  }

  // ============================================================
  //  ADD SECTION TEMPLATES
  // ============================================================
  const tplModal = $('#tpl-modal');
  const tplGrid = $('#tpl-grid');

  const TEMPLATES = [
    {
      name: 'Image + Text', desc: 'Photo on one side, headline + paragraph + button on the other.', icon: 'image',
      html: `<section class="section" style="padding: 80px 20px; background: #F5F2ED;"><div style="max-width: 1100px; margin: 0 auto; display: grid; grid-template-columns: 1fr 1fr; gap: 48px; align-items: center;"><div><img src="https://placehold.co/600x450/C8A84E/0D0D0D?text=Replace+me" alt="" style="width: 100%; border-radius: 6px;" /></div><div><div class="eyebrow" style="color: #C8A84E; font-size: 11px; letter-spacing: 0.15em; text-transform: uppercase; margin-bottom: 16px;">— New Section —</div><h2 style="font-size: 40px; line-height: 1.1; margin-bottom: 16px;">Your headline here.</h2><p style="font-size: 17px; line-height: 1.6; color: #555; margin-bottom: 24px;">Short description of what this section is about. Click to edit.</p><a href="#" class="btn btn-primary" style="display: inline-flex; padding: 14px 24px; background: #C8A84E; color: #000; text-decoration: none; border-radius: 2px; font-weight: 700; letter-spacing: 0.1em; text-transform: uppercase; font-size: 13px;">Learn More</a></div></div></section>`
    },
    {
      name: 'Big CTA Strip', desc: 'Full-width call-to-action with headline and prominent button.', icon: 'cta',
      html: `<section class="section" style="padding: 100px 20px; background: #0D0D0D; color: #E8E4DC; text-align: center;"><div style="max-width: 720px; margin: 0 auto;"><h2 style="font-size: 44px; line-height: 1.1; margin-bottom: 16px;">Big call to action.</h2><p style="font-size: 18px; line-height: 1.6; color: #9A9588; margin-bottom: 28px;">One compelling sentence that gets visitors to click the button below.</p><a href="#" class="btn btn-primary" style="display: inline-flex; padding: 16px 32px; background: #C8A84E; color: #0D0D0D; text-decoration: none; border-radius: 2px; font-weight: 700; letter-spacing: 0.1em; text-transform: uppercase; font-size: 14px;">Take Action</a></div></section>`
    },
    {
      name: 'Photo Banner', desc: 'Full-width photo with text overlaid on top.', icon: 'banner',
      html: `<section class="section" style="position: relative; padding: 0; min-height: 420px; overflow: hidden;"><img src="https://placehold.co/1600x500/0D0D0D/C8A84E?text=Replace+background+image" alt="" style="position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover;" /><div style="position: absolute; inset: 0; background: rgba(0,0,0,0.55);"></div><div style="position: relative; padding: 120px 20px; text-align: center; color: #fff; z-index: 1;"><h2 style="font-size: 48px; line-height: 1.1; margin-bottom: 12px;">Banner headline.</h2><p style="font-size: 18px; color: #E8E4DC; max-width: 600px; margin: 0 auto;">Supporting copy that sits over the photo.</p></div></section>`
    },
    {
      name: '3-Column Features', desc: 'Three cards side-by-side: icon, heading, description.', icon: 'grid',
      html: `<section class="section" style="padding: 80px 20px; background: #FFFFFF;"><div style="max-width: 1100px; margin: 0 auto; text-align: center; margin-bottom: 48px;"><h2 style="font-size: 36px; margin-bottom: 12px;">Section heading.</h2><p style="font-size: 17px; color: #666;">Brief intro to these three features.</p></div><div style="max-width: 1100px; margin: 0 auto; display: grid; grid-template-columns: repeat(3, 1fr); gap: 24px;"><div style="text-align: center; padding: 24px;"><div style="font-size: 36px; color: #C8A84E; margin-bottom: 12px;">◆</div><h3 style="font-size: 20px; margin-bottom: 8px;">Feature one</h3><p style="color: #666; font-size: 15px;">Short benefit description.</p></div><div style="text-align: center; padding: 24px;"><div style="font-size: 36px; color: #C8A84E; margin-bottom: 12px;">◆</div><h3 style="font-size: 20px; margin-bottom: 8px;">Feature two</h3><p style="color: #666; font-size: 15px;">Short benefit description.</p></div><div style="text-align: center; padding: 24px;"><div style="font-size: 36px; color: #C8A84E; margin-bottom: 12px;">◆</div><h3 style="font-size: 20px; margin-bottom: 8px;">Feature three</h3><p style="color: #666; font-size: 15px;">Short benefit description.</p></div></div></section>`
    },
    {
      name: 'Video + Text Split', desc: 'Video on one side, descriptive text on the other.', icon: 'video',
      html: `<section class="section" style="padding: 80px 20px; background: #0D0D0D; color: #E8E4DC;"><div style="max-width: 1100px; margin: 0 auto; display: grid; grid-template-columns: 1fr 1fr; gap: 48px; align-items: center;"><div style="aspect-ratio: 16/9; background: #000; border-radius: 6px; overflow: hidden;"><img src="https://placehold.co/640x360/0D0D0D/C8A84E?text=Video+thumbnail" alt="Video thumbnail" style="width: 100%; height: 100%; object-fit: cover;" /></div><div><div style="color: #C8A84E; font-size: 11px; letter-spacing: 0.2em; text-transform: uppercase; margin-bottom: 12px;">— Watch —</div><h2 style="font-size: 36px; line-height: 1.1; margin-bottom: 14px;">See how we train.</h2><p style="font-size: 16px; line-height: 1.6; color: #9A9588; margin-bottom: 22px;">Short description of what viewers will see in the video.</p><a href="#" class="btn btn-primary" style="display: inline-flex; padding: 14px 24px; background: #C8A84E; color: #0D0D0D; text-decoration: none; border-radius: 2px; font-weight: 700; letter-spacing: 0.1em; text-transform: uppercase; font-size: 13px;">Watch Now</a></div></div></section>`
    },
    {
      name: 'Testimonial', desc: 'Single large pull-quote with name + attribution.', icon: 'quote',
      html: `<section class="section" style="padding: 100px 20px; background: #F5F2ED; text-align: center;"><div style="max-width: 820px; margin: 0 auto;"><div style="font-size: 72px; color: #C8A84E; line-height: 1; margin-bottom: 12px;">"</div><blockquote style="font-size: 26px; line-height: 1.45; font-style: italic; color: #0D0D0D; margin-bottom: 24px;">The single best training experience I've had. Every rep matters here.</blockquote><div style="font-size: 14px; color: #666;"><strong style="color: #0D0D0D; display: block; margin-bottom: 2px;">First Last</strong>Team · Role</div></div></section>`
    }
  ];

  function renderTemplates() {
    tplGrid.innerHTML = '';
    TEMPLATES.forEach(t => {
      const card = document.createElement('div');
      card.className = 'tpl-card';
      card.innerHTML = `<div class="tpl-thumb">${tplIcon(t.icon)}<span>${t.name.toUpperCase()}</span></div><div class="tpl-name">${t.name}</div><div class="tpl-desc">${t.desc}</div>`;
      card.addEventListener('click', () => insertTemplate(t));
      tplGrid.appendChild(card);
    });
  }
  function tplIcon(kind) {
    const s = '<svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">';
    const e = '</svg>';
    switch (kind) {
      case 'image': return s + '<rect x="3" y="5" width="18" height="14" rx="1"/><circle cx="9" cy="11" r="2"/><path d="M21 19l-6-6-5 5-2-2-5 3"/>' + e;
      case 'cta':   return s + '<rect x="3" y="8" width="18" height="8" rx="4"/><path d="M10 12h4"/>' + e;
      case 'banner':return s + '<rect x="2" y="5" width="20" height="14" rx="1"/><path d="M6 12h12M6 16h8"/>' + e;
      case 'grid':  return s + '<rect x="3" y="5" width="5" height="14"/><rect x="9.5" y="5" width="5" height="14"/><rect x="16" y="5" width="5" height="14"/>' + e;
      case 'video': return s + '<rect x="3" y="5" width="12" height="14" rx="1"/><polygon points="7,8 13,12 7,16" fill="currentColor" stroke="none"/><rect x="16" y="9" width="5" height="2"/><rect x="16" y="13" width="5" height="2"/>' + e;
      case 'quote': return s + '<path d="M7 7c-2 1-3 3-3 6v4h6v-4H6c0-2 1-3 3-4zM17 7c-2 1-3 3-3 6v4h6v-4h-4c0-2 1-3 3-4z" fill="currentColor" stroke="none"/>' + e;
      default: return s + '<circle cx="12" cy="12" r="4"/>' + e;
    }
  }
  function insertTemplate(t) {
    const doc = state.iframeDoc;
    const wrap = doc.createElement('div');
    wrap.innerHTML = t.html.trim();
    const sec = wrap.firstElementChild;
    const footer = doc.querySelector('body > footer');
    if (footer) footer.parentElement.insertBefore(sec, footer);
    else doc.body.appendChild(sec);
    wrapMixedContentTextNodes(sec);
    instrumentTexts(sec); instrumentImages(sec); instrumentLinks(sec);
    instrumentSections(doc);
    tplModal.hidden = true;
    markDirty(); renderSectionsList();
    sec.scrollIntoView({ behavior: 'smooth', block: 'start' });
    showToast('Added "' + t.name + '"');
  }
  $('#btn-add-section').addEventListener('click', () => { renderTemplates(); tplModal.hidden = false; });
  $('#tpl-cancel').addEventListener('click', () => { tplModal.hidden = true; });

  // ============================================================
  //  DIRTY TRACKING
  // ============================================================
  const dirtyCountEl = $('#dirty-count');
  function markDirty() {
    state.dirty = true;
    dirtyCountEl.textContent = '●';
    dirtyCountEl.classList.add('dirty');
  }
  function clearDirty() {
    state.dirty = false;
    dirtyCountEl.textContent = '0';
    dirtyCountEl.classList.remove('dirty');
  }

  // ============================================================
  //  TOOLBAR
  // ============================================================
  $('#btn-reset').addEventListener('click', async () => {
    if (state.dirty && !confirm('Discard unsaved edits and reload from staging?')) return;
    state.pendingImages.clear();
    await loadPageIntoFrame(state.page);
    showToast('Reset to current staging');
  });
  $('#btn-preview').addEventListener('click', () => {
    window.open(state.page.previewUrl + '?ts=' + Date.now(), '_blank');
  });
  $('#btn-push').addEventListener('click', () => pushToStaging());

  // ============================================================
  //  PUSH TO STAGING
  // ============================================================
  async function pushToStaging() {
    if (!state.frameReady) return;
    const pat = await ensurePat(); if (!pat) return;
    setStatus('pushing…');
    try {
      const doc = state.iframeDoc;
      let out = '<!DOCTYPE html>\n' + doc.documentElement.outerHTML;

      // Strip editor-only artifacts
      out = out.replace(/<style id="editor-injected-style">[\s\S]*?<\/style>/g, '');
      out = out.replace(/<button[^>]*class="editor-link-pencil"[^>]*>[\s\S]*?<\/button>/g, '');
      out = out.replace(/\s+data-edit-text="[^"]*"/g, '');
      out = out.replace(/\s+data-edit-img="[^"]*"/g, '');
      out = out.replace(/\s+data-edit-link="[^"]*"/g, '');
      out = out.replace(/\s+data-section="[^"]*"/g, '');
      out = out.replace(/\s+data-section-label="[^"]*"/g, '');
      out = out.replace(/\s+data-text-wrap="[^"]*"/g, '');
      out = out.replace(/\s+contenteditable="[^"]*"/g, '');
      out = out.replace(/\s+class="editor-image-pending"/g, '');
      out = out.replace(/(class="[^"]*?)\s+editor-image-pending([^"]*")/g, '$1$2');

      // Ensure staging base present
      if (!/<!-- staging-base-start -->/.test(out)) {
        if (/<base\s[^>]*>/i.test(out)) {
          out = out.replace(/<base\s[^>]*>/i, '<!-- staging-base-start --><base href="/"><!-- staging-base-end -->');
        } else {
          out = out.replace(/<meta name="viewport"[^>]*>/i, m => m + '\n  <!-- staging-base-start --><base href="/"><!-- staging-base-end -->');
        }
      }
      // Re-inject staging banner
      if (!/<!-- staging-banner-start -->/.test(out)) {
        out = out.replace(/<\/body>/i,
          '  <!-- staging-banner-start -->\n  <script src="/stagingsite/banner.js" defer><\/script>\n  <!-- staging-banner-end -->\n</body>');
      }

      let imgCount = 0;
      for (const [fname, { bytes }] of state.pendingImages) {
        setStatus(`uploading ${fname}…`);
        await putFile(fname, bytes, `Editor: add/replace image ${fname}`);
        imgCount++;
      }

      setStatus('uploading ' + state.page.stagingPath + '…');
      await putFileText(state.page.stagingPath, out, `Editor: update ${state.page.stagingPath} (${imgCount} image${imgCount===1?'':'s'})`);

      state.pendingImages.clear();
      state.originalHtml = out;
      clearDirty();
      setStatus('pushed ✓');
      showToast('Pushed to staging. Opening preview…');
      setTimeout(() => window.open(state.page.previewUrl + '?ts=' + Date.now(), '_blank'), 600);
    } catch (err) {
      setStatus('push failed');
      showToast('Push failed: ' + err.message, true);
    }
  }

  // ============================================================
  //  GITHUB API
  // ============================================================
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
      throw new Error(`GitHub ${res.status}: ${msg}`);
    }
    return res.json();
  }
  async function getFileSha(path) {
    try {
      const j = await gh(`/contents/${path.replace(/^\/+/, '')}?ref=${BRANCH}`);
      return j.sha;
    } catch (e) { return null; }
  }
  async function putFile(path, bytes, message) {
    const sha = await getFileSha(path);
    const b64 = bytesToBase64(bytes);
    await gh(`/contents/${path.replace(/^\/+/, '')}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message, content: b64, branch: BRANCH, ...(sha ? { sha } : {}) }),
    });
  }
  async function putFileText(path, text, message) {
    const sha = await getFileSha(path);
    const b64 = utf8ToBase64(text);
    await gh(`/contents/${path.replace(/^\/+/, '')}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message, content: b64, branch: BRANCH, ...(sha ? { sha } : {}) }),
    });
  }
  function bytesToBase64(bytes) {
    let bin = ''; const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) {
      bin += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
    }
    return btoa(bin);
  }
  function utf8ToBase64(s) { return btoa(unescape(encodeURIComponent(s))); }

  // ============================================================
  //  PAT
  // ============================================================
  async function ensurePat() {
    let pat = localStorage.getItem(PAT_KEY);
    if (pat) return pat;
    return new Promise(resolve => {
      const modal = $('#pat-modal'); const input = $('#pat-input');
      input.value = ''; modal.hidden = false; input.focus();
      $('#pat-cancel').onclick = () => { modal.hidden = true; resolve(null); };
      $('#pat-save').onclick = () => {
        const v = input.value.trim();
        if (!v.startsWith('ghp_') && !v.startsWith('github_pat_')) {
          alert('That does not look like a GitHub token. Should start with ghp_ or github_pat_.'); return;
        }
        localStorage.setItem(PAT_KEY, v); modal.hidden = true; resolve(v);
      };
    });
  }

  // ============================================================
  //  UI HELPERS
  // ============================================================
  function setStatus(s) { statusEl.textContent = s; }
  const toast = $('#toast');
  function showToast(msg, isErr) {
    toast.textContent = msg;
    toast.className = 'toast' + (isErr ? ' err' : '');
    toast.hidden = false;
    clearTimeout(showToast._t);
    showToast._t = setTimeout(() => toast.hidden = true, 4000);
  }
  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
  }
})();
