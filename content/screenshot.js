/**
 * BIAIF Screenshot — adapté de WP-Blazing-Minds (assets/js/screenshot.js)
 *
 * Différence avec l'original : on utilise chrome.tabs.captureVisibleTab
 * (via le service worker) à la place d'html2canvas. C'est plus propre
 * dans une extension MV3 (pas de dépendance, capture pixel-perfect).
 *
 * Conserve l'API et les helpers du module Blazing :
 *   - capture()             : viewport visible
 *   - captureElement(el)    : crop autour d'un élément
 *   - getMetadata()         : infos browser/OS/device/page
 *   - resize() / getSize()  : redimensionnement et mesure
 *   - hideWidget/showWidget : masque la sidebar pendant la capture
 *   - fallbackCapture()     : placeholder si la capture échoue
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
      padding: 12,         // px autour de l'élément ciblé
      maxWidth: 1600,      // redimensionnement automatique
      maxHeight: 1200,
      jpegQuality: 0.9,
    },

    async capture() {
      if (this.state.isCapturing) {
        throw new Error('Capture déjà en cours');
      }
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

    async captureElement(element) {
      if (!element || element.nodeType !== 1) {
        throw new Error('Élément invalide');
      }
      // Faire défiler l'élément en vue si nécessaire (sans animation pour rapidité)
      const rect = element.getBoundingClientRect();
      if (rect.bottom < 0 || rect.top > window.innerHeight) {
        element.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' });
        await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      }
      const fullDataUrl = await this.capture();
      try {
        const cropped = await this.cropAroundElement(fullDataUrl, element);
        return cropped;
      } catch (e) {
        console.warn('[BIAIF] crop KO, on renvoie le viewport entier :', e.message);
        return fullDataUrl;
      }
    },

    /**
     * Crop l'image autour d'un élément, en tenant compte du devicePixelRatio
     * (captureVisibleTab renvoie l'image en pixels physiques).
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
          canvas.width = w;
          canvas.height = h;
          const ctx = canvas.getContext('2d');
          ctx.drawImage(img, x, y, w, h, 0, 0, w, h);
          resolve(canvas.toDataURL('image/png'));
        };
        img.onerror = () => reject(new Error('Image non chargée'));
        img.src = dataUrl;
      });
    },

    requestCapture() {
      return new Promise((resolve, reject) => {
        chrome.runtime.sendMessage({ type: 'biaif:capture-tab' }, (resp) => {
          if (chrome.runtime.lastError) {
            return reject(new Error(chrome.runtime.lastError.message));
          }
          if (!resp || resp.error) {
            return reject(new Error(resp?.error || 'capture failed'));
          }
          resolve(resp.dataUrl);
        });
      });
    },

    fallbackCapture() {
      const canvas = document.createElement('canvas');
      canvas.width = 800;
      canvas.height = 600;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#f5f5f5';
      ctx.fillRect(0, 0, 800, 600);
      ctx.strokeStyle = '#ddd';
      ctx.lineWidth = 2;
      ctx.strokeRect(1, 1, 798, 598);
      ctx.fillStyle = '#999';
      ctx.font = '48px Arial';
      ctx.textAlign = 'center';
      ctx.fillText('📷', 400, 270);
      ctx.font = '16px Arial';
      ctx.fillText('Capture non disponible', 400, 320);
      ctx.font = '12px monospace';
      ctx.fillStyle = '#666';
      ctx.fillText(window.location.href, 400, 350);
      return canvas.toDataURL('image/png');
    },

    /**
     * Redimensionnement façon BlazingScreenshot.resize.
     */
    resize(dataUrl, maxWidth = this.config.maxWidth, maxHeight = this.config.maxHeight) {
      return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => {
          let { width, height } = img;
          if (width > maxWidth) {
            height = (height * maxWidth) / width;
            width = maxWidth;
          }
          if (height > maxHeight) {
            width = (width * maxHeight) / height;
            height = maxHeight;
          }
          const canvas = document.createElement('canvas');
          canvas.width = Math.round(width);
          canvas.height = Math.round(height);
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

    /**
     * Métadonnées de la page / browser / device — port direct du module
     * Blazing (utile pour donner du contexte à l'IA).
     */
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

    hideWidget() {
      const host = document.getElementById('biaif-sidebar-host');
      if (host) host.style.visibility = 'hidden';
      // Masquer aussi l'overlay du picker pour qu'il n'apparaisse pas
      const ov = document.getElementById('biaif-picker-overlay');
      const tg = document.getElementById('biaif-picker-tag');
      if (ov) ov.dataset.prevDisplay = ov.style.display, (ov.style.display = 'none');
      if (tg) tg.dataset.prevDisplay = tg.style.display, (tg.style.display = 'none');
    },

    showWidget() {
      const host = document.getElementById('biaif-sidebar-host');
      if (host) host.style.visibility = 'visible';
      const ov = document.getElementById('biaif-picker-overlay');
      const tg = document.getElementById('biaif-picker-tag');
      if (ov && ov.dataset.prevDisplay !== undefined) ov.style.display = ov.dataset.prevDisplay;
      if (tg && tg.dataset.prevDisplay !== undefined) tg.style.display = tg.dataset.prevDisplay;
    },

    emit(name, detail = {}) {
      document.dispatchEvent(new CustomEvent('biaif:screenshot-' + name, { bubbles: true, detail }));
    },
  };

  window.BIAIFScreenshot = Screenshot;
})(window, document);
