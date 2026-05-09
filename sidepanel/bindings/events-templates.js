/**
 * BIAIF Bindings — Templates modal.
 *
 * Replaces the old small popover with a full-screen modal that has two
 * sections:
 *   1. Saved        — templates stored in chrome.storage (existing behaviour)
 *   2. Dossier      — file tree from a locally-mounted folder via the File
 *                     System Access API (BIAIFFileTemplates, Option A)
 *
 * A "Importer" button at the bottom handles Option B (manual .md/.txt import).
 *
 * Public entry point: BIAIFBindings.bindTemplatesPopover(autoArm)
 *                     (name kept for back-compat; called by events.js).
 */
(function (window) {
  'use strict';

  window.BIAIFBindings = window.BIAIFBindings || {};
  var ctx = window.BIAIFBindings.ctx;

  function _t(k, fb) {
    var U = window.BIAIF && window.BIAIF.utils;
    return (U && U.t) ? U.t(k, fb) : (fb || k);
  }

  /* ── Hidden file input for manual import ─────────────────────── */
  var _fileInput = null;
  function _getFileInput() {
    if (_fileInput) return _fileInput;
    _fileInput = document.createElement('input');
    _fileInput.type     = 'file';
    _fileInput.multiple = true;
    _fileInput.accept   = '.md,.txt';
    _fileInput.style.display = 'none';
    document.body.appendChild(_fileInput);
    return _fileInput;
  }

  /* ── Modal state ─────────────────────────────────────────────── */
  var _modal    = null;
  var _autoArm  = null;

  /* ── DOM helpers ──────────────────────────────────────────────── */

  function _el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls)  e.className   = cls;
    if (text) e.textContent = text;
    return e;
  }

  function _btn(cls, label, icon) {
    var b = document.createElement('button');
    b.type      = 'button';
    b.className = cls;
    if (icon) b.innerHTML = icon + '<span>' + label + '</span>';
    else      b.textContent = label;
    return b;
  }

  /* ── Saved templates section ─────────────────────────────────── */

  function _renderSaved(container, body) {
    container.innerHTML = '';

    var items = (window.BIAIFTemplates && window.BIAIFTemplates.list()) || [];

    if (!items.length) {
      var empty = _el('p', 'tm-empty', _t('templates.empty_short', 'Aucun modèle enregistré'));
      container.appendChild(empty);
      return;
    }

    items.forEach(function (t) {
      var row = _el('div', 'tm-item');
      row.dataset.id = t.id;

      var info = _el('div', 'tm-item-info');
      var name = _el('span', 'tm-item-name', t.name);
      var prev = _el('span', 'tm-item-prev', t.body.replace(/\s+/g, ' ').slice(0, 70));
      prev.title = t.body;
      info.appendChild(name);
      info.appendChild(prev);

      var del = _el('button', 'tm-item-del');
      del.type = 'button';
      del.setAttribute('aria-label', _t('templates.delete', 'Supprimer ce modèle'));
      del.innerHTML =
        '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
        'stroke-width="2.5" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/>' +
        '<line x1="6" y1="6" x2="18" y2="18"/></svg>';
      del.addEventListener('click', function (e) {
        e.stopPropagation();
        window.BIAIFTemplates.remove(t.id);
        _renderSaved(container, body);
      });

      row.appendChild(info);
      row.appendChild(del);
      row.addEventListener('click', function () { _insertSaved(t.id); });
      container.appendChild(row);
    });
  }

  function _insertSaved(id) {
    if (typeof _autoArm === 'function') _autoArm();
    window.BIAIFTemplates.insertIntoEditor(id);
    _close();
    if (window.BIAIFToast) {
      window.BIAIFToast.show(_t('toast.template_inserted', 'Modèle inséré.'), 'success', 1800);
    }
  }

  /* ── Folder tree section ─────────────────────────────────────── */

  function _fileIcon() {
    return '<svg class="tm-node-icon" width="13" height="13" viewBox="0 0 24 24" fill="none" ' +
      'stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
      '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>' +
      '<polyline points="14 2 14 8 20 8"/></svg>';
  }
  function _folderIcon(open) {
    return open
      ? '<svg class="tm-node-icon" width="13" height="13" viewBox="0 0 24 24" fill="none" ' +
        'stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
        '<path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>'
      : '<svg class="tm-node-icon" width="13" height="13" viewBox="0 0 24 24" fill="none" ' +
        'stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
        '<path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>';
  }
  function _chevron(down) {
    return '<svg class="tm-chevron" width="10" height="10" viewBox="0 0 24 24" fill="none" ' +
      'stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">' +
      (down ? '<polyline points="6 9 12 15 18 9"/>' : '<polyline points="9 18 15 12 9 6"/>') +
      '</svg>';
  }

  function _buildTreeNode(node, depth, body) {
    if (node.type === 'file') {
      var row = _el('div', 'tm-node tm-node--file');
      row.style.paddingLeft = (12 + depth * 16) + 'px';
      row.innerHTML = _fileIcon();
      var lbl = _el('span', 'tm-node-label', node.name.replace(/\.(md|txt)$/i, ''));
      row.appendChild(lbl);
      row.addEventListener('click', function () { _insertFile(node.handle, node.name); });
      return row;
    }

    // Folder
    var wrap = _el('div', 'tm-folder-wrap');
    var header = _el('div', 'tm-node tm-node--folder');
    header.style.paddingLeft = (12 + depth * 16) + 'px';
    var isOpen = depth === 0; // top-level folders open by default
    header.innerHTML = _chevron(isOpen) + _folderIcon(isOpen);
    var lbl2 = _el('span', 'tm-node-label', node.name + '/');
    header.appendChild(lbl2);

    var children = _el('div', 'tm-folder-children' + (isOpen ? '' : ' is-collapsed'));
    (node.children || []).forEach(function (child) {
      children.appendChild(_buildTreeNode(child, depth + 1, body));
    });
    if (!node.children || !node.children.length) {
      children.appendChild(_el('div', 'tm-empty-folder', _t('templates.folder_empty', 'Dossier vide')));
    }

    header.addEventListener('click', function () {
      isOpen = !isOpen;
      children.classList.toggle('is-collapsed', !isOpen);
      header.innerHTML = _chevron(isOpen) + _folderIcon(isOpen);
      header.appendChild(lbl2);
    });

    wrap.appendChild(header);
    wrap.appendChild(children);
    return wrap;
  }

  function _insertFile(fileHandle, fileName) {
    if (!fileHandle) return;
    var FT = window.BIAIFFileTemplates;
    if (!FT) return;
    FT.readFile(fileHandle).then(function (body) {
      if (body == null) {
        if (window.BIAIFToast) window.BIAIFToast.show(_t('toast.file_read_error', 'Impossible de lire le fichier.'), 'error');
        return;
      }
      if (typeof _autoArm === 'function') _autoArm();
      if (window.BIAIFTemplates && window.BIAIFTemplates.interpolate) {
        body = window.BIAIFTemplates.interpolate(body);
      }
      if (window.BIAIFSession && window.BIAIFSession.addTextToTarget) {
        window.BIAIFSession.addTextToTarget(body);
      }
      _close();
      if (window.BIAIFToast) {
        window.BIAIFToast.show(_t('toast.template_inserted', 'Modèle inséré.'), 'success', 1800);
      }
    });
  }

  function _renderFolder(container) {
    container.innerHTML = '';
    var FT = window.BIAIFFileTemplates;
    if (!FT || !FT.hasFolder()) {
      _renderFolderEmpty(container);
      return;
    }

    var loading = _el('div', 'tm-folder-loading', _t('templates.scanning', 'Analyse du dossier…'));
    container.appendChild(loading);

    FT.scan().then(function (tree) {
      container.innerHTML = '';
      if (!tree) {
        _renderFolderEmpty(container);
        return;
      }
      if (!tree.length) {
        container.appendChild(_el('p', 'tm-empty', _t('templates.folder_no_files', 'Aucun fichier .md / .txt trouvé')));
        return;
      }
      var treeWrap = _el('div', 'tm-tree');
      tree.forEach(function (node) {
        treeWrap.appendChild(_buildTreeNode(node, 0, container));
      });
      container.appendChild(treeWrap);
    }).catch(function () {
      container.innerHTML = '';
      container.appendChild(_el('p', 'tm-empty tm-empty--error', _t('templates.folder_error', 'Erreur de lecture du dossier')));
    });
  }

  function _renderFolderEmpty(container) {
    var wrap = _el('div', 'tm-pick-folder');
    var icon = document.createElement('div');
    icon.className = 'tm-pick-folder-icon';
    icon.innerHTML =
      '<svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
      'stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">' +
      '<path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>';
    var hint = _el('p', 'tm-pick-folder-hint',
      _t('templates.pick_folder_hint', 'Choisissez un dossier racine pour charger vos .md / .txt (GDrive, OneDrive, local…)'));
    wrap.appendChild(icon);
    wrap.appendChild(hint);
    container.appendChild(wrap);
  }

  /* ── Modal build ─────────────────────────────────────────────── */

  function _open(autoArm) {
    if (_modal) return;
    _autoArm = autoArm;

    // Backdrop
    _modal = _el('div', 'tm-overlay');
    _modal.setAttribute('role', 'dialog');
    _modal.setAttribute('aria-modal', 'true');
    _modal.setAttribute('aria-label', _t('templates.modal_aria', 'Modèles de prompts'));
    _modal.addEventListener('click', function (e) { if (e.target === _modal) _close(); });

    var panel = _el('div', 'tm-panel');

    /* ── Header ── */
    var header = _el('div', 'tm-header');
    header.innerHTML =
      '<svg class="tm-header-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" ' +
      'stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">' +
      '<rect x="4" y="3" width="16" height="18" rx="2"/><line x1="8" y1="8" x2="16" y2="8"/>' +
      '<line x1="8" y1="12" x2="16" y2="12"/><line x1="8" y1="16" x2="13" y2="16"/></svg>' +
      '<span class="tm-header-title">' + _t('templates.modal_title', 'Modèles de prompts') + '</span>';

    var closeBtn = _el('button', 'tm-close-btn');
    closeBtn.type = 'button';
    closeBtn.innerHTML = '&times;';
    closeBtn.setAttribute('aria-label', _t('templates.close', 'Fermer'));
    closeBtn.addEventListener('click', _close);
    header.appendChild(closeBtn);

    /* ── Tabs ── */
    var tabs    = _el('div', 'tm-tabs');
    var tabSave = _el('button', 'tm-tab is-active', _t('templates.tab_saved', 'Enregistrés'));
    var tabDir  = _el('button', 'tm-tab', _t('templates.tab_folder', 'Dossier'));
    tabSave.type = 'button'; tabDir.type = 'button';

    /* ── Bodies ── */
    var bodySave = _el('div', 'tm-body');
    var bodyDir  = _el('div', 'tm-body is-hidden');

    /* Saved body content */
    var savedList = _el('div', 'tm-saved-list');
    _renderSaved(savedList, bodySave);
    bodySave.appendChild(savedList);

    /* Saved footer actions */
    var savedActions = _el('div', 'tm-actions');

    var saveCurrentBtn = _btn('tm-action-btn tm-action-btn--primary',
      _t('templates.save_current', 'Enregistrer la saisie'),
      '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
      'stroke-width="2.5" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"/>' +
      '<line x1="5" y1="12" x2="19" y2="12"/></svg>');
    saveCurrentBtn.addEventListener('click', function () {
      var entry = window.BIAIFTemplates && window.BIAIFTemplates.saveCurrentAsTemplate();
      if (!entry) {
        if (window.BIAIFToast) window.BIAIFToast.show(_t('toast.template_empty', 'Rien à enregistrer — saisissez du texte.'), 'info');
        return;
      }
      _renderSaved(savedList, bodySave);
      if (window.BIAIFToast) window.BIAIFToast.show(_t('toast.template_saved', 'Modèle enregistré.'), 'success');
    });

    var importBtn = _btn('tm-action-btn',
      _t('templates.import', 'Importer .md / .txt'),
      '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
      'stroke-width="2.5" stroke-linecap="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>' +
      '<polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>');
    importBtn.addEventListener('click', function () {
      var fi = _getFileInput();
      fi.value = '';
      fi.onchange = function () {
        if (!fi.files || !fi.files.length) return;
        var FT = window.BIAIFFileTemplates;
        if (!FT) return;
        FT.importFiles(fi.files).then(function (n) {
          _renderSaved(savedList, bodySave);
          if (window.BIAIFToast) {
            window.BIAIFToast.show(
              n + ' ' + _t('toast.templates_imported', 'modèle(s) importé(s).'), 'success', 2500);
          }
        });
      };
      fi.click();
    });

    savedActions.appendChild(saveCurrentBtn);
    savedActions.appendChild(importBtn);
    bodySave.appendChild(savedActions);

    /* Folder body content */
    var FT = window.BIAIFFileTemplates;

    /* Folder header bar (path + change button) */
    var dirBar  = _el('div', 'tm-dir-bar');
    var dirPath = _el('span', 'tm-dir-path',
      FT && FT.hasFolder()
        ? FT.getRootName()
        : _t('templates.no_folder', 'Aucun dossier sélectionné'));
    var dirActions = _el('div', 'tm-dir-actions');

    var pickBtn = _btn('tm-action-btn tm-action-btn--primary',
      _t('templates.pick_folder', 'Choisir un dossier'),
      '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
      'stroke-width="2.5" stroke-linecap="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>');
    pickBtn.addEventListener('click', function () {
      if (!FT) return;
      FT.pickFolder().then(function (name) {
        if (!name) return;
        dirPath.textContent = name;
        clearBtn.style.display = '';
        _renderFolder(folderContent);
      });
    });

    var clearBtn = _btn('tm-action-btn tm-action-btn--danger',
      _t('templates.clear_folder', 'Retirer'),
      '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
      'stroke-width="2.5" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/>' +
      '<line x1="6" y1="6" x2="18" y2="18"/></svg>');
    clearBtn.style.display = (FT && FT.hasFolder()) ? '' : 'none';
    clearBtn.addEventListener('click', function () {
      if (!FT) return;
      FT.clearFolder().then(function () {
        dirPath.textContent = _t('templates.no_folder', 'Aucun dossier sélectionné');
        clearBtn.style.display = 'none';
        _renderFolder(folderContent);
      });
    });

    var refreshBtn = _btn('tm-action-btn',
      _t('templates.refresh', 'Actualiser'),
      '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
      'stroke-width="2.5" stroke-linecap="round"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>');
    refreshBtn.style.display = (FT && FT.hasFolder()) ? '' : 'none';
    refreshBtn.addEventListener('click', function () {
      if (FT) FT.scan(true).then(function () { _renderFolder(folderContent); });
    });

    dirActions.appendChild(pickBtn);
    dirActions.appendChild(refreshBtn);
    dirActions.appendChild(clearBtn);
    dirBar.appendChild(dirPath);
    dirBar.appendChild(dirActions);

    var folderContent = _el('div', 'tm-folder-content');
    _renderFolder(folderContent);

    bodyDir.appendChild(dirBar);
    bodyDir.appendChild(folderContent);

    /* ── Tab switching ── */
    tabSave.addEventListener('click', function () {
      tabSave.classList.add('is-active');
      tabDir.classList.remove('is-active');
      bodySave.classList.remove('is-hidden');
      bodyDir.classList.add('is-hidden');
    });
    tabDir.addEventListener('click', function () {
      tabDir.classList.add('is-active');
      tabSave.classList.remove('is-active');
      bodyDir.classList.remove('is-hidden');
      bodySave.classList.add('is-hidden');
    });

    tabs.appendChild(tabSave);
    tabs.appendChild(tabDir);

    panel.appendChild(header);
    panel.appendChild(tabs);
    panel.appendChild(bodySave);
    panel.appendChild(bodyDir);
    _modal.appendChild(panel);
    document.body.appendChild(_modal);

    document.addEventListener('keydown', _onKey, true);
    setTimeout(function () { panel.focus && panel.focus(); }, 30);
  }

  function _close() {
    if (!_modal) return;
    document.removeEventListener('keydown', _onKey, true);
    if (_modal.parentNode) _modal.parentNode.removeChild(_modal);
    _modal = null;
  }

  function _onKey(e) {
    if (e.key === 'Escape') { e.preventDefault(); _close(); }
  }

  /* ── Entry point (called by events.js → bind()) ──────────────── */

  function bindTemplatesPopover(autoArm) {
    var btn = document.querySelector('[data-act="open-templates"]');
    if (!btn) return;

    // Init file-templates async
    if (window.BIAIFFileTemplates) window.BIAIFFileTemplates.init();

    btn.addEventListener('click', function (e) {
      e.stopPropagation();
      if (_modal) { _close(); btn.setAttribute('aria-expanded', 'false'); return; }
      _open(autoArm);
      btn.setAttribute('aria-expanded', 'true');
    });

    // Clean up aria-expanded when modal closes by other means
    var origClose = _close;
    _close = function () {
      origClose();
      btn.setAttribute('aria-expanded', 'false');
    };
  }

  window.BIAIFBindings.bindTemplatesPopover = bindTemplatesPopover;
})(window);
