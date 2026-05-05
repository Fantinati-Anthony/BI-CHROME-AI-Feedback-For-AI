/**
 * BIAIF Screenshot — outils étendus depuis Blazing Toolkit.
 *
 * Quatre modes de capture :
 *   - capture()              : viewport visible (rapide)
 *   - captureSelection()     : on dessine un rectangle (overlay crosshair)
 *   - captureElement(el)     : élément ; scroll+stitch si plus grand que le viewport
 *   - captureFullPage()      : page complète, scroll+stitch
 *
 * Plus deux modes interactifs (sélection à la souris dans la page) :
 *   - pickAndCapture('selection') : l'utilisateur dessine un cadre
 *   - pickAndCapture('element')   : l'utilisateur clique un élément
 *
 * La capture pixel passe toujours par chrome.tabs.captureVisibleTab via le
 * service worker (`background.js`), avec retry rate-limit côté SW.
 */

(function (window, document) {
  'use strict';

  const Screenshot = {
    state: {
      isCapturing: false,
      lastCapture: null,
      lastCaptureTime: null,
    },

    config: {
      padding: 12,
      maxWidth: 1600,
      maxHeight: 1200,
      jpegQuality: 0.9,
      scrollSettleMs: 300,
      hideLoaderForCaptureMs: 100,
    },

    // -------------------------------------------------------------------
    // Modes de base
    // -------------------------------------------------------------------

    async capture() {
      if (this.state.isCapturing) throw new Error('Capture déjà en cours');
      this.state.isCapturing = true;
      this.hideWidget();
      try {
        const dataUrl = await this.requestCapture();
        this.state.lastCapture = dataUrl;
        this.state.lastCaptureTime = Date.now();
        this.emit('success', { dataUrl });
        return dataUrl;
      } catch (e) {
        console.warn('[BIAIF] capture viewport KO :', e.message);
        this.emit('error', { error: e.message });
        return this.fallbackCapture();
      } finally {
        this.showWidget();
        this.state.isCapturing = false;
      }
    },

    /**
     * Crop l'élément depuis le viewport. Si l'élément est plus grand que
     * le viewport, on bascule automatiquement en scroll+stitch.
     */
    async captureElement(element) {
      if (!element || element.nodeType !== 1) {
        throw new Error('Élément invalide');
      }

      const rect = element.getBoundingClientRect();
      const vpW = window.innerWidth;
      const vpH = window.innerHeight;

      // Cas hors écran : on scrolle dans la vue
      if (rect.bottom < 0 || rect.top > vpH) {
        element.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' });
        await this.waitFrames(2);
      }

      // Élément plus grand que le viewport → scroll + stitch
      const newRect = element.getBoundingClientRect();
      if (newRect.width > vpW || newRect.height > vpH) {
        return this.captureElementScrollStitch(element);
      }

      // Élément qui rentre dans le viewport → capture + crop simple
      const fullDataUrl = await this.capture();
      try {
        return await this.cropAroundElement(fullDataUrl, element);
      } catch (e) {
        console.warn('[BIAIF] crop KO, on renvoie le viewport entier :', e.message);
        return fullDataUrl;
      }
    },

    /**
     * Capture en dessinant un rectangle (overlay crosshair). Renvoie un
     * dataURL recadré. Rejette si l'utilisateur appuie sur Échap.
     */
    captureSelection() {
      return new Promise((resolve, reject) => {
        this.openSelectionOverlay({
          onCancel: () => reject(new Error('Sélection annulée')),
          onSelect: async (rect) => {
            try {
              const dataUrl = await this.capture();
              const dpr = window.devicePixelRatio || 1;
              const cropped = await this.cropImage(dataUrl, {
                x: rect.x * dpr,
                y: rect.y * dpr,
                w: rect.width * dpr,
                h: rect.height * dpr,
              });
              resolve(cropped);
            } catch (e) {
              reject(e);
            }
          },
        });
      });
    },

    /**
     * Mode interactif : l'utilisateur survole et clique sur un élément.
     * Renvoie le dataURL recadré (scroll+stitch si nécessaire).
     */
    pickAndCapture(mode = 'element') {
      if (mode === 'selection') return this.captureSelection();
      return new Promise((resolve, reject) => {
        this.openElementPicker({
          onCancel: () => reject(new Error('Sélection annulée')),
          onPick: async (el) => {
            try {
              resolve(await this.captureElement(el));
            } catch (e) { reject(e); }
          },
        });
      });
    },

    /**
     * Capture la page entière en empilant des viewports. Hide les
     * éléments fixed/sticky pour éviter les barres répétées.
     */
    async captureFullPage() {
      if (this.state.isCapturing) throw new Error('Capture déjà en cours');
      this.state.isCapturing = true;
      this.hideWidget();
      this.showLoader('Préparation…');

      const dpr = window.devicePixelRatio || 1;
      const vpH = window.innerHeight;
      const vpW = window.innerWidth;
      const scrollH = Math.max(document.documentElement.scrollHeight, document.body.scrollHeight);
      const scrollW = Math.max(document.documentElement.scrollWidth, document.body.scrollWidth);
      const sections = Math.ceil(scrollH / vpH);
      const previousScroll = { x: window.scrollX, y: window.scrollY };

      const restored = this.hideFixedElements();
      const captures = [];

      try {
        window.scrollTo(0, 0);
        await this.sleep(this.config.scrollSettleMs);

        let lastScrollY = -1;
        for (let i = 0; i < sections; i++) {
          this.showLoader('Capture en cours…', i + 1, sections);
          this.sendProgress(i + 1, sections);
          window.scrollTo(0, i * vpH);
          await this.sleep(this.config.scrollSettleMs);

          const actualY = window.scrollY;
          if (actualY === lastScrollY) continue;
          lastScrollY = actualY;

          this.hideLoader();
          await this.sleep(this.config.hideLoaderForCaptureMs);
          const dataUrl = await this.requestCapture();

          captures.push({
            dataUrl,
            scrollY: actualY,
            viewportHeight: vpH,
          });
        }

        this.showLoader('Assemblage…');
        const finalDataUrl = await this.stitchSections(captures, scrollW, scrollH, vpH, dpr);
        this.state.lastCapture = finalDataUrl;
        this.emit('success', { dataUrl: finalDataUrl, mode: 'fullpage' });
        return finalDataUrl;
      } catch (e) {
        console.warn('[BIAIF] full-page KO :', e.message);
        this.emit('error', { error: e.message });
        return this.fallbackCapture();
      } finally {
        restored();
        window.scrollTo(previousScroll.x, previousScroll.y);
        this.removeLoader();
        this.showWidget();
        this.state.isCapturing = false;
      }
    },

    /**
     * Élément plus grand que le viewport → on scrolle dans la page pour
     * couvrir l'élément en plusieurs viewports puis on stitch.
     */
    async captureElementScrollStitch(element) {
      if (!element) throw new Error('Élément invalide');

      this.state.isCapturing = true;
      this.hideWidget();
      this.showLoader('Préparation…');

      const dpr = window.devicePixelRatio || 1;
      const vpH = window.innerHeight;
      const vpW = window.innerWidth;
      const previousScroll = { x: window.scrollX, y: window.scrollY };
      const restored = this.hideFixedElements();
      const captures = [];

      try {
        // Position absolue de l'élément en haut de page
        const startRect = element.getBoundingClientRect();
        const elemTop = startRect.top + window.scrollY;
        const elemLeft = startRect.left + window.scrollX;
        const elemH = startRect.height;
        const elemW = startRect.width;
        const sections = Math.ceil(elemH / vpH);

        for (let i = 0; i < sections; i++) {
          this.showLoader('Capture en cours…', i + 1, sections);
          window.scrollTo(elemLeft, elemTop + i * vpH);
          await this.sleep(this.config.scrollSettleMs);

          this.hideLoader();
          await this.sleep(this.config.hideLoaderForCaptureMs);
          const dataUrl = await this.requestCapture();

          const live = element.getBoundingClientRect();
          const cropX = Math.max(0, live.left);
          const cropY = Math.max(0, live.top);
          const cropW = Math.min(elemW, vpW - cropX, live.width);

          const isLast = i === sections - 1;
          const remaining = elemH - i * vpH;
          const cropH = isLast ? Math.min(remaining, vpH - cropY) : Math.min(vpH - cropY, vpH);

          captures.push({
            dataUrl,
            sectionIndex: i,
            cropX, cropY, cropW, cropH,
            viewportHeight: vpH,
            isLast,
          });
        }

        this.showLoader('Assemblage…');
        const finalDataUrl = await this.stitchElementSections(captures, elemW, elemH, vpH, dpr);
        this.state.lastCapture = finalDataUrl;
        this.emit('success', { dataUrl: finalDataUrl, mode: 'element-stitch' });
        return finalDataUrl;
      } catch (e) {
        console.warn('[BIAIF] element-stitch KO :', e.message);
        this.emit('error', { error: e.message });
        return this.fallbackCapture();
      } finally {
        restored();
        window.scrollTo(previousScroll.x, previousScroll.y);
        this.removeLoader();
        this.showWidget();
        this.state.isCapturing = false;
      }
    },

    // -------------------------------------------------------------------
    // Service worker bridge
    // -------------------------------------------------------------------

    sendProgress(current, total, label) {
      try {
        chrome.runtime.sendMessage({
          type: window.BIAIF.MSG.CAPTURE_PROGRESS,
          current: current,
          total: total,
          label: label || ('Section ' + current + '/' + total),
        }).catch(function () {});
      } catch (_) {}
    },

    requestCapture() {
      return new Promise((resolve, reject) => {
        chrome.runtime.sendMessage({ type: window.BIAIF.MSG.CAPTURE_TAB }, (resp) => {
          if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
          if (!resp || resp.error) return reject(new Error(resp?.error || 'capture failed'));
          resolve(resp.dataUrl);
        });
      });
    },

    fallbackCapture() {
      const canvas = document.createElement('canvas');
      canvas.width = 800; canvas.height = 600;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#f5f5f5'; ctx.fillRect(0, 0, 800, 600);
      ctx.strokeStyle = '#ddd'; ctx.lineWidth = 2; ctx.strokeRect(1, 1, 798, 598);
      ctx.fillStyle = '#999'; ctx.font = '48px Arial'; ctx.textAlign = 'center';
      ctx.fillText('📷', 400, 270);
      ctx.font = '16px Arial';
      ctx.fillText('Capture non disponible', 400, 320);
      ctx.font = '12px monospace'; ctx.fillStyle = '#666';
      ctx.fillText(window.location.href, 400, 350);
      return canvas.toDataURL('image/png');
    },

    // -------------------------------------------------------------------
    // Crop / resize / sizing
    // -------------------------------------------------------------------

    /**
     * Crop autour d'un élément qui rentre dans le viewport (capture
     * unique). dpr-aware.
     */
    cropAroundElement(dataUrl, element) {
      return new Promise((resolve, reject) => {
        const rect = element.getBoundingClientRect();
        const dpr = window.devicePixelRatio || 1;
        const pad = this.config.padding;
        const img = new Image();
        img.onload = () => {
          const x = Math.max(0, Math.floor((rect.left - pad) * dpr));
          const y = Math.max(0, Math.floor((rect.top - pad) * dpr));
          const w = Math.min(img.width - x, Math.ceil((rect.width + pad * 2) * dpr));
          const h = Math.min(img.height - y, Math.ceil((rect.height + pad * 2) * dpr));
          if (w <= 0 || h <= 0) return reject(new Error('Zone hors écran'));
          const canvas = document.createElement('canvas');
          canvas.width = w; canvas.height = h;
          canvas.getContext('2d').drawImage(img, x, y, w, h, 0, 0, w, h);
          resolve(canvas.toDataURL('image/png'));
        };
        img.onerror = () => reject(new Error('Image non chargée'));
        img.src = dataUrl;
      });
    },

    cropImage(dataUrl, { x, y, w, h }) {
      return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => {
          const canvas = document.createElement('canvas');
          canvas.width = Math.max(1, w);
          canvas.height = Math.max(1, h);
          canvas.getContext('2d').drawImage(img, x, y, w, h, 0, 0, w, h);
          resolve(canvas.toDataURL('image/png'));
        };
        img.onerror = () => reject(new Error('Image non chargée'));
        img.src = dataUrl;
      });
    },

    async stitchSections(captures, pageWidth, pageHeight, viewportHeight, dpr) {
      const images = await Promise.all(captures.map((c) => this.loadImage(c.dataUrl)));
      const canvas = document.createElement('canvas');
      canvas.width = pageWidth * dpr;
      canvas.height = pageHeight * dpr;
      const ctx = canvas.getContext('2d');

      captures.forEach((c, i) => {
        const img = images[i];
        const destY = c.scrollY * dpr;
        const remaining = Math.max(0, pageHeight - c.scrollY);
        const sourceH = Math.min(c.viewportHeight, remaining) * dpr;
        if (sourceH > 0) {
          ctx.drawImage(img, 0, 0, img.width, sourceH, 0, destY, img.width, sourceH);
        }
      });
      return canvas.toDataURL('image/png');
    },

    async stitchElementSections(captures, elemWidth, elemHeight, viewportHeight, dpr) {
      const images = await Promise.all(captures.map((c) => this.loadImage(c.dataUrl)));
      const canvas = document.createElement('canvas');
      canvas.width = elemWidth * dpr;
      canvas.height = elemHeight * dpr;
      const ctx = canvas.getContext('2d');

      captures.forEach((c, i) => {
        const img = images[i];
        const destY = c.sectionIndex * viewportHeight * dpr;
        const sectionH = c.isLast ? (elemHeight - c.sectionIndex * viewportHeight) : viewportHeight;
        const drawH = Math.min(sectionH * dpr, c.cropH * dpr);

        ctx.drawImage(
          img,
          c.cropX * dpr, c.cropY * dpr,
          c.cropW * dpr, drawH,
          0, destY,
          c.cropW * dpr, drawH
        );
      });
      return canvas.toDataURL('image/png');
    },

    loadImage(dataUrl) {
      return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = () => reject(new Error('Image non chargée'));
        img.src = dataUrl;
      });
    },

    resize(dataUrl, maxWidth = this.config.maxWidth, maxHeight = this.config.maxHeight) {
      return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => {
          let { width, height } = img;
          if (width > maxWidth) { height = (height * maxWidth) / width; width = maxWidth; }
          if (height > maxHeight) { width = (width * maxHeight) / height; height = maxHeight; }
          const canvas = document.createElement('canvas');
          canvas.width = Math.round(width); canvas.height = Math.round(height);
          canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
          resolve(canvas.toDataURL('image/jpeg', this.config.jpegQuality));
        };
        img.onerror = () => reject(new Error('Image non chargée'));
        img.src = dataUrl;
      });
    },

    getSize(dataUrl) {
      const base64 = (dataUrl.split(',')[1] || '');
      return Math.round((base64.length * 3) / 4);
    },

    formatSize(bytes) {
      if (bytes < 1024) return bytes + ' B';
      if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
      return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
    },

    // -------------------------------------------------------------------
    // Picker overlays (élément + sélection)
    // -------------------------------------------------------------------

    openElementPicker({ onPick, onCancel } = {}) {
      this.closePickers();
      const overlay = document.createElement('div');
      overlay.id = 'biaif-shot-element-overlay';
      Object.assign(overlay.style, {
        position: 'fixed', inset: '0', zIndex: '2147483646', cursor: 'crosshair',
      });
      const hl = document.createElement('div');
      hl.id = 'biaif-shot-highlight';
      Object.assign(hl.style, {
        position: 'fixed', border: '3px solid #2bd4d9',
        background: 'rgba(43,212,217,0.10)', pointerEvents: 'none',
        zIndex: '2147483647', display: 'none', boxSizing: 'border-box',
      });
      const tip = document.createElement('div');
      Object.assign(tip.style, {
        position: 'fixed', top: '20px', left: '50%', transform: 'translateX(-50%)',
        background: 'rgba(0,0,0,0.85)', color: '#fff', padding: '10px 20px',
        borderRadius: '8px', font: '13px/1.4 -apple-system,Segoe UI,sans-serif',
        zIndex: '2147483648',
      });
      tip.innerHTML = 'Cliquez sur l\'élément à capturer<br><small style="opacity:.7">Échap pour annuler</small>';
      overlay.appendChild(tip);
      document.body.appendChild(hl);
      document.body.appendChild(overlay);

      let current = null;
      const onMove = (e) => {
        overlay.style.pointerEvents = 'none';
        const el = document.elementFromPoint(e.clientX, e.clientY);
        overlay.style.pointerEvents = 'auto';
        if (!el || el === overlay || el === hl || overlay.contains(el)) return;
        current = el;
        const r = el.getBoundingClientRect();
        hl.style.display = 'block';
        hl.style.left = r.left + 'px';
        hl.style.top = r.top + 'px';
        hl.style.width = r.width + 'px';
        hl.style.height = r.height + 'px';
      };
      const onClick = (e) => {
        e.preventDefault(); e.stopPropagation();
        if (!current) return;
        cleanup();
        onPick && onPick(current);
      };
      const onKey = (e) => {
        if (e.key === 'Escape') { cleanup(); onCancel && onCancel(); }
      };
      const cleanup = () => {
        overlay.removeEventListener('mousemove', onMove);
        overlay.removeEventListener('click', onClick);
        document.removeEventListener('keydown', onKey, true);
        overlay.remove(); hl.remove();
      };
      overlay.addEventListener('mousemove', onMove);
      overlay.addEventListener('click', onClick);
      document.addEventListener('keydown', onKey, true);
    },

    openSelectionOverlay({ onSelect, onCancel } = {}) {
      this.closePickers();
      const overlay = document.createElement('div');
      overlay.id = 'biaif-shot-selection-overlay';
      Object.assign(overlay.style, {
        position: 'fixed', inset: '0', background: 'rgba(0,0,0,0.30)',
        cursor: 'crosshair', zIndex: '2147483647',
      });
      const box = document.createElement('div');
      Object.assign(box.style, {
        position: 'fixed', border: '2px dashed #fff',
        background: 'rgba(43,212,217,0.20)', pointerEvents: 'none', display: 'none',
      });
      overlay.appendChild(box);
      const tip = document.createElement('div');
      Object.assign(tip.style, {
        position: 'fixed', top: '20px', left: '50%', transform: 'translateX(-50%)',
        background: 'rgba(0,0,0,0.85)', color: '#fff', padding: '10px 20px',
        borderRadius: '8px', font: '13px/1.4 sans-serif', zIndex: '2147483648',
      });
      tip.textContent = 'Dessinez un rectangle pour capturer (Échap pour annuler).';
      overlay.appendChild(tip);
      document.body.appendChild(overlay);

      let drawing = false, sx = 0, sy = 0;
      const onDown = (e) => {
        drawing = true; sx = e.clientX; sy = e.clientY;
        box.style.display = 'block';
        box.style.left = sx + 'px'; box.style.top = sy + 'px';
        box.style.width = '0'; box.style.height = '0';
      };
      const onMove = (e) => {
        if (!drawing) return;
        const left = Math.min(sx, e.clientX);
        const top = Math.min(sy, e.clientY);
        box.style.left = left + 'px'; box.style.top = top + 'px';
        box.style.width = Math.abs(e.clientX - sx) + 'px';
        box.style.height = Math.abs(e.clientY - sy) + 'px';
      };
      const onUp = (e) => {
        if (!drawing) return;
        drawing = false;
        const rect = {
          x: Math.min(sx, e.clientX),
          y: Math.min(sy, e.clientY),
          width: Math.abs(e.clientX - sx),
          height: Math.abs(e.clientY - sy),
        };
        cleanup();
        if (rect.width > 10 && rect.height > 10) onSelect && onSelect(rect);
        else onCancel && onCancel();
      };
      const onKey = (e) => {
        if (e.key === 'Escape') { cleanup(); onCancel && onCancel(); }
      };
      const cleanup = () => {
        overlay.removeEventListener('mousedown', onDown);
        overlay.removeEventListener('mousemove', onMove);
        overlay.removeEventListener('mouseup', onUp);
        document.removeEventListener('keydown', onKey, true);
        overlay.remove();
      };
      overlay.addEventListener('mousedown', onDown);
      overlay.addEventListener('mousemove', onMove);
      overlay.addEventListener('mouseup', onUp);
      document.addEventListener('keydown', onKey, true);
    },

    closePickers() {
      ['biaif-shot-element-overlay', 'biaif-shot-selection-overlay', 'biaif-shot-highlight']
        .forEach((id) => { const e = document.getElementById(id); if (e) e.remove(); });
    },

    // -------------------------------------------------------------------
    // Loader / hide widget / hide fixed elements
    // -------------------------------------------------------------------

    showLoader(message = 'Capture en cours…', current = null, total = null) {
      let loader = document.getElementById('biaif-screenshot-loader');
      if (!loader) {
        loader = document.createElement('div');
        loader.id = 'biaif-screenshot-loader';
        Object.assign(loader.style, {
          position: 'fixed', inset: '0',
          background: 'rgba(15,23,42,0.85)',
          display: 'flex', flexDirection: 'column', alignItems: 'center',
          justifyContent: 'center', zIndex: '2147483647',
          font: '14px/1.4 -apple-system,Segoe UI,sans-serif',
        });
        document.body.appendChild(loader);
      }
      const progress = current && total
        ? `<div style="font-size:13px;color:#94a3b8;margin-top:8px">Section ${current}/${total}</div>`
        : '';
      loader.innerHTML = `
        <div style="
          width:46px;height:46px;border:4px solid rgba(255,255,255,0.1);
          border-top-color:#2bd4d9;border-radius:50%;
          animation:biaif-spin 1s linear infinite;
        "></div>
        <div style="color:#fff;font-size:16px;margin-top:18px;text-align:center">${message}</div>
        ${progress}
        <div style="color:#94a3b8;font-size:12px;margin-top:14px">Merci de ne rien toucher</div>
        <style>@keyframes biaif-spin{to{transform:rotate(360deg)}}</style>
      `;
      loader.style.display = 'flex';
    },

    hideLoader() {
      const loader = document.getElementById('biaif-screenshot-loader');
      if (loader) loader.style.display = 'none';
    },

    removeLoader() {
      const loader = document.getElementById('biaif-screenshot-loader');
      if (loader) loader.remove();
    },

    /**
     * Masque les éléments en position fixed/sticky pendant un scroll-stitch
     * pour éviter que les barres de nav apparaissent dupliquées.
     * Renvoie une fonction de restauration.
     */
    hideFixedElements() {
      // Stylesheet single-shot : (1) cible les inline styles fixed/sticky
      // sans walk + getComputedStyle ; (2) hide via classe ajoutée pour les
      // candidats trouvés lors d'un walk peu profond (la plupart des nav
      // bars / cookie banners vivent à <= 6 niveaux du body).
      const style = document.createElement('style');
      style.id = 'biaif-hide-fixed-style';
      style.textContent =
        '[style*="position: fixed"],[style*="position:fixed"],' +
        '[style*="position: sticky"],[style*="position:sticky"],' +
        '.biaif-hidden-fixed{display:none !important}';
      (document.head || document.documentElement).appendChild(style);

      const hidden = [];
      const MAX_DEPTH = 6;
      const visit = (parent, depth) => {
        if (depth > MAX_DEPTH || !parent) return;
        for (const el of parent.children) {
          const cs = window.getComputedStyle(el);
          if (cs.position === 'fixed' || cs.position === 'sticky') {
            el.classList.add('biaif-hidden-fixed');
            hidden.push(el);
            // pas de descente dans un sous-arbre déjà masqué
          } else {
            visit(el, depth + 1);
          }
        }
      };
      visit(document.body, 0);

      return () => {
        if (style.parentNode) style.remove();
        hidden.forEach((el) => el.classList.remove('biaif-hidden-fixed'));
      };
    },

    hideWidget() {
      const host = document.getElementById('biaif-sidebar-host');
      if (host) host.style.visibility = 'hidden';
      const ov = document.getElementById('biaif-picker-overlay');
      const tg = document.getElementById('biaif-picker-tag');
      if (ov) { ov.dataset.prevDisplay = ov.style.display; ov.style.display = 'none'; }
      if (tg) { tg.dataset.prevDisplay = tg.style.display; tg.style.display = 'none'; }
    },

    showWidget() {
      const host = document.getElementById('biaif-sidebar-host');
      if (host) host.style.visibility = 'visible';
      const ov = document.getElementById('biaif-picker-overlay');
      const tg = document.getElementById('biaif-picker-tag');
      if (ov && ov.dataset.prevDisplay !== undefined) ov.style.display = ov.dataset.prevDisplay;
      if (tg && tg.dataset.prevDisplay !== undefined) tg.style.display = tg.dataset.prevDisplay;
    },

    // -------------------------------------------------------------------
    // Métadonnées + utils
    // -------------------------------------------------------------------

    getMetadata() {
      const ua = navigator.userAgent;
      return {
        url: window.location.href,
        title: document.title,
        referrer: document.referrer || null,
        timestamp: new Date().toISOString(),
        viewport: { w: window.innerWidth, h: window.innerHeight },
        scroll: { x: window.scrollX || 0, y: window.scrollY || 0 },
        devicePixelRatio: window.devicePixelRatio || 1,
        browser: this.detectBrowser(ua),
        os: this.detectOS(ua),
        device: this.detectDevice(),
        language: navigator.language || null,
        platform: navigator.platform || null,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      };
    },

    detectBrowser(ua) {
      if (ua.includes('Edg/')) return 'Edge';
      if (ua.includes('OPR/') || ua.includes('Opera')) return 'Opera';
      if (ua.includes('Firefox/')) return 'Firefox';
      if (ua.includes('Chrome/')) return 'Chrome';
      if (ua.includes('Safari/')) return 'Safari';
      return 'Unknown';
    },

    detectOS(ua) {
      if (ua.includes('Windows NT 10')) return 'Windows 10/11';
      if (ua.includes('Windows')) return 'Windows';
      if (ua.includes('Mac OS X')) return 'macOS';
      if (ua.includes('Android')) return 'Android';
      if (ua.includes('iPhone') || ua.includes('iPad')) return 'iOS';
      if (ua.includes('Linux')) return 'Linux';
      return 'Unknown';
    },

    detectDevice() {
      const w = window.innerWidth;
      const touch = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
      if (w <= 480) return 'Mobile';
      if (w <= 1024) return touch ? 'Tablet' : 'Desktop';
      return 'Desktop';
    },

    sleep(ms) { return new Promise((r) => setTimeout(r, ms)); },

    waitFrames(n = 1) {
      return new Promise((resolve) => {
        const tick = (k) => k <= 0 ? resolve() : requestAnimationFrame(() => tick(k - 1));
        tick(n);
      });
    },

    emit(name, detail = {}) {
      document.dispatchEvent(new CustomEvent('biaif:screenshot-' + name, { bubbles: true, detail }));
    },
  };

  window.BIAIFScreenshot = Screenshot;
})(window, document);
