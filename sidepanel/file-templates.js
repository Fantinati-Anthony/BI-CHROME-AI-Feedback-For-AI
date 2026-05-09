/**
 * BIAIFFileTemplates — File System Access API + manual import.
 *
 * Option A: User picks a root folder via showDirectoryPicker(). The
 *           FileSystemDirectoryHandle is persisted in IndexedDB so the
 *           extension remembers it across sessions (Chrome re-asks for
 *           permission on the first access after a browser restart).
 *           Supports any locally-mounted folder: GDrive, OneDrive, Dropbox,
 *           Obsidian vault, etc. Scans recursively for .md and .txt files.
 *
 * Option B: User imports individual .md / .txt files via <input type=file>.
 *           Files are added to BIAIFTemplates (chrome.storage) immediately.
 *
 * Public API:
 *   BIAIFFileTemplates.init()              → Promise<void>  load stored handle
 *   BIAIFFileTemplates.pickFolder()        → Promise<string|null>  folder name
 *   BIAIFFileTemplates.clearFolder()       → Promise<void>
 *   BIAIFFileTemplates.scan(force?)        → Promise<Node[]|null>
 *   BIAIFFileTemplates.readFile(handle)    → Promise<string|null>
 *   BIAIFFileTemplates.importFiles(files)  → Promise<number>  count added
 *   BIAIFFileTemplates.hasFolder()         → boolean
 *   BIAIFFileTemplates.getRootName()       → string
 *
 * Node shape (tree):
 *   { name, path, type:'file'|'folder', handle?, children? }
 */
(function (window) {
  'use strict';

  var DB_NAME   = 'biaif-file-tpl';
  var DB_VER    = 1;
  var STORE     = 'handles';

  var _db          = null;
  var _rootHandle  = null;
  var _rootName    = '';
  var _tree        = null;   // cached after last scan

  /* ── IndexedDB helpers ───────────────────────────────────────── */

  function _openDB() {
    return new Promise(function (resolve, reject) {
      if (_db) { resolve(_db); return; }
      var req = indexedDB.open(DB_NAME, DB_VER);
      req.onupgradeneeded = function (e) { e.target.result.createObjectStore(STORE); };
      req.onsuccess  = function (e) { _db = e.target.result; resolve(_db); };
      req.onerror    = function (e) { reject(e.target.error); };
    });
  }

  function _putHandle(h) {
    return _openDB().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(STORE, 'readwrite');
        tx.objectStore(STORE).put(h, 'root');
        tx.oncomplete = resolve;
        tx.onerror    = function (e) { reject(e.target.error); };
      });
    });
  }

  function _getHandle() {
    return _openDB().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx  = db.transaction(STORE, 'readonly');
        var req = tx.objectStore(STORE).get('root');
        req.onsuccess = function () { resolve(req.result || null); };
        req.onerror   = function (e) { reject(e.target.error); };
      });
    });
  }

  function _delHandle() {
    return _openDB().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(STORE, 'readwrite');
        tx.objectStore(STORE).delete('root');
        tx.oncomplete = resolve;
        tx.onerror    = function (e) { reject(e.target.error); };
      });
    });
  }

  /* ── Recursive scan ──────────────────────────────────────────── */

  async function _scanDir(dirHandle, pathPrefix) {
    var nodes = [];
    try {
      for await (var [name, handle] of dirHandle.entries()) {
        // Skip hidden files/folders
        if (name.startsWith('.')) continue;
        if (handle.kind === 'directory') {
          var children = await _scanDir(handle, pathPrefix + name + '/');
          nodes.push({ name: name, path: pathPrefix + name + '/', type: 'folder', children: children });
        } else if (/\.(md|txt)$/i.test(name)) {
          nodes.push({ name: name, path: pathPrefix + name, type: 'file', handle: handle });
        }
      }
    } catch (e) {
      console.warn('[BIAIF FileTemplates] scanDir error', e);
    }
    // Folders first, then alpha within each group
    nodes.sort(function (a, b) {
      if (a.type !== b.type) return a.type === 'folder' ? -1 : 1;
      return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
    });
    return nodes;
  }

  /* ── Public API ──────────────────────────────────────────────── */

  async function init() {
    try {
      var h = await _getHandle();
      if (h) {
        _rootHandle = h;
        _rootName   = h.name;
        // Probe permission — we can't request without a user gesture,
        // so just mark it cached; scan() will re-request if needed.
      }
    } catch (e) {
      _rootHandle = null;
      _rootName   = '';
    }
  }

  async function pickFolder() {
    try {
      var h = await window.showDirectoryPicker({ mode: 'read', id: 'biaif-tpl' });
      _rootHandle = h;
      _rootName   = h.name;
      _tree       = null;
      await _putHandle(h);
      return h.name;
    } catch (e) {
      if (e.name !== 'AbortError') console.warn('[BIAIF FileTemplates] pickFolder error', e);
      return null;
    }
  }

  async function clearFolder() {
    _rootHandle = null;
    _rootName   = '';
    _tree       = null;
    await _delHandle();
  }

  async function scan(force) {
    if (!_rootHandle) return null;
    if (_tree && !force) return _tree;
    try {
      var perm = await _rootHandle.queryPermission({ mode: 'read' });
      if (perm !== 'granted') {
        perm = await _rootHandle.requestPermission({ mode: 'read' });
      }
      if (perm !== 'granted') return null;
      _tree = await _scanDir(_rootHandle, '');
      return _tree;
    } catch (e) {
      console.warn('[BIAIF FileTemplates] scan error', e);
      return null;
    }
  }

  async function readFile(fileHandle) {
    try {
      var file = await fileHandle.getFile();
      return await file.text();
    } catch (e) {
      console.warn('[BIAIF FileTemplates] readFile error', e);
      return null;
    }
  }

  // Import from a FileList (input[type=file]) — persists to BIAIFTemplates
  function importFiles(files) {
    var promises = [];
    var added    = 0;
    for (var i = 0; i < files.length; i++) {
      (function (f) {
        if (!/\.(md|txt)$/i.test(f.name)) return;
        promises.push(new Promise(function (resolve) {
          var reader = new FileReader();
          reader.onload = function (e) {
            var name = f.name.replace(/\.(md|txt)$/i, '');
            if (window.BIAIFTemplates && window.BIAIFTemplates.add) {
              window.BIAIFTemplates.add({ name: name, body: e.target.result });
              added++;
            }
            resolve();
          };
          reader.onerror = resolve;
          reader.readAsText(f);
        }));
      })(files[i]);
    }
    return Promise.all(promises).then(function () { return added; });
  }

  function hasFolder()   { return !!_rootHandle; }
  function getRootName() { return _rootName; }

  window.BIAIFFileTemplates = {
    init: init,
    pickFolder: pickFolder,
    clearFolder: clearFolder,
    scan: scan,
    readFile: readFile,
    importFiles: importFiles,
    hasFolder: hasFolder,
    getRootName: getRootName,
  };
})(window);
