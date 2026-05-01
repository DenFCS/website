/* /email-handler.js
 * Site-wide click handler for any <a href="mailto:..."> link.
 *  • On mobile/touch devices: let the browser open the default email app.
 *  • On desktop: intercept and show a small modal with three send options:
 *      1) Open in your email app (mailto:)
 *      2) Open in Gmail (browser, opens new tab)
 *      3) Copy email + details to clipboard
 *
 * Drop the script tag into any page where you want this behavior. The modal
 * styles + HTML are injected lazily on first click so there's no setup cost.
 */
(function () {
  'use strict';

  // ---------- Robust mobile/touch detection ----------
  function isMobile() {
    try {
      if (window.matchMedia('(pointer: coarse)').matches) return true;
    } catch (_) {}
    if ('ontouchstart' in window) return true;
    if (navigator.maxTouchPoints && navigator.maxTouchPoints > 0) return true;
    if (/Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent)) return true;
    if (window.innerWidth <= 900) return true;
    return false;
  }

  // ---------- Mailto parsing ----------
  function parseMailto(href) {
    // Strip leading "mailto:" then split query string.
    const raw = href.replace(/^mailto:/i, '');
    const qIdx = raw.indexOf('?');
    const to = decodeURIComponent(qIdx === -1 ? raw : raw.slice(0, qIdx));
    const params = new URLSearchParams(qIdx === -1 ? '' : raw.slice(qIdx + 1));
    return {
      to: to,
      subject: params.get('subject') || '',
      body: params.get('body') || '',
    };
  }

  // ---------- Lazy modal injection ----------
  let modalEl = null;
  function ensureModal() {
    if (modalEl) return modalEl;

    // Inject styles once
    const style = document.createElement('style');
    style.textContent = `
      .gem-modal {
        position: fixed; inset: 0; z-index: 99999;
        background: rgba(0,0,0,0.85);
        display: flex; align-items: center; justify-content: center;
        padding: 24px;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Golos Text", sans-serif;
      }
      .gem-modal[hidden] { display: none !important; }
      .gem-card {
        background: #0A0A0A; color: #FFFFFF;
        border: 1px solid #C8A84E; border-radius: 4px;
        max-width: 460px; width: 100%;
        padding: 32px 28px;
        box-shadow: 0 30px 80px rgba(0,0,0,0.6);
      }
      .gem-card h3 {
        font-family: 'Orbitron', -apple-system, sans-serif;
        font-weight: 800; font-size: 22px; line-height: 1.2;
        margin: 0 0 8px; letter-spacing: -0.01em;
      }
      .gem-card .gem-sub {
        color: #A3A3A3; font-size: 14px; line-height: 22px;
        margin: 0 0 20px;
      }
      .gem-card .gem-to {
        background: #1A1A1A; padding: 8px 12px;
        border-radius: 3px; font-size: 12px; color: #C8A84E;
        font-family: monospace; margin-bottom: 16px;
        word-break: break-all;
      }
      .gem-options { display: flex; flex-direction: column; gap: 10px; }
      .gem-btn {
        display: block; width: 100%;
        padding: 14px 18px; border-radius: 2px;
        font-weight: 700; font-size: 12px; letter-spacing: 0.12em;
        text-transform: uppercase; cursor: pointer;
        text-align: center; text-decoration: none;
        border: 1px solid transparent; line-height: 1;
        font-family: inherit;
      }
      .gem-btn-primary { background: #C8A84E; color: #0D0D0D; border-color: #C8A84E; }
      .gem-btn-primary:hover { background: #E0C872; border-color: #E0C872; }
      .gem-btn-secondary { background: transparent; color: #FFFFFF; border-color: #555555; }
      .gem-btn-secondary:hover { border-color: #C8A84E; color: #C8A84E; }
      .gem-cancel {
        margin-top: 6px;
        background: transparent; color: #A3A3A3;
        border: none; cursor: pointer;
        font-family: inherit; text-transform: uppercase;
        font-size: 11px; letter-spacing: 0.15em; padding: 10px;
      }
      .gem-cancel:hover { color: #FFFFFF; }
      .gem-feedback {
        margin-top: 10px; font-size: 12px; color: #C8A84E;
        text-align: center; min-height: 16px;
      }
    `;
    document.head.appendChild(style);

    // Build the modal
    modalEl = document.createElement('div');
    modalEl.className = 'gem-modal';
    modalEl.hidden = true;
    modalEl.setAttribute('role', 'dialog');
    modalEl.setAttribute('aria-labelledby', 'gem-title');
    modalEl.innerHTML = `
      <div class="gem-card">
        <h3 id="gem-title">Send your message</h3>
        <p class="gem-sub">Pick how you'd like to send this email.</p>
        <div class="gem-to" id="gem-to"></div>
        <div class="gem-options">
          <a id="gem-mailto" class="gem-btn gem-btn-primary" href="#">Open in my email app</a>
          <a id="gem-gmail" class="gem-btn gem-btn-secondary" href="#" target="_blank" rel="noopener">Open in Gmail (browser)</a>
          <button id="gem-copy" class="gem-btn gem-btn-secondary" type="button">Copy email + details</button>
          <div class="gem-feedback" id="gem-feedback"></div>
          <button id="gem-cancel" class="gem-cancel" type="button">Close</button>
        </div>
      </div>
    `;
    document.body.appendChild(modalEl);

    // Wire up close + copy
    const cancelBtn = modalEl.querySelector('#gem-cancel');
    const copyBtn = modalEl.querySelector('#gem-copy');
    const feedback = modalEl.querySelector('#gem-feedback');

    function close() { modalEl.hidden = true; feedback.textContent = ''; }
    cancelBtn.addEventListener('click', close);
    modalEl.addEventListener('click', (e) => { if (e.target === modalEl) close(); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !modalEl.hidden) close(); });

    // Auto-close after picking an email link
    modalEl.querySelector('#gem-mailto').addEventListener('click', () => setTimeout(close, 400));
    modalEl.querySelector('#gem-gmail').addEventListener('click', () => setTimeout(close, 400));

    copyBtn.addEventListener('click', async () => {
      const payload = modalEl._gemPayload || '';
      try {
        await navigator.clipboard.writeText(payload);
        feedback.textContent = '✓ Copied. Paste anywhere.';
      } catch (err) {
        const ta = document.createElement('textarea');
        ta.value = payload; document.body.appendChild(ta);
        ta.select();
        try { document.execCommand('copy'); feedback.textContent = '✓ Copied.'; }
        catch (e2) { feedback.textContent = 'Could not copy. Use the email links above.'; }
        ta.remove();
      }
    });

    return modalEl;
  }

  function openModal(parsed) {
    const m = ensureModal();
    const encTo = encodeURIComponent(parsed.to);
    const encSub = encodeURIComponent(parsed.subject);
    const encBody = encodeURIComponent(parsed.body);

    m.querySelector('#gem-to').textContent = parsed.to;
    m.querySelector('#gem-mailto').href = `mailto:${parsed.to}?subject=${encSub}&body=${encBody}`;
    m.querySelector('#gem-gmail').href = `https://mail.google.com/mail/?view=cm&fs=1&to=${encTo}&su=${encSub}&body=${encBody}`;

    // Build a clean clipboard payload
    m._gemPayload =
      `To: ${parsed.to}\n` +
      `Subject: ${parsed.subject}\n\n` +
      (parsed.body || '');

    m.querySelector('#gem-feedback').textContent = '';
    m.hidden = false;
  }

  // ---------- Global click delegation ----------
  document.addEventListener('click', function (e) {
    const a = e.target.closest && e.target.closest('a[href^="mailto:"]');
    if (!a) return;

    // On mobile, leave it alone — the OS handles mailto: gracefully.
    if (isMobile()) return;

    // Desktop: show our modal with options.
    e.preventDefault();
    e.stopPropagation();
    try {
      const parsed = parseMailto(a.getAttribute('href') || '');
      openModal(parsed);
    } catch (err) {
      // If parsing fails, just let the default behavior happen.
      console.warn('[email-handler] could not parse mailto, falling back:', err);
      window.location.href = a.href;
    }
  }, true);
})();
