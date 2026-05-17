/**
 * MyFb CSS Selector Generator
 *
 * Construit un sélecteur CSS unique et stable pour un élément donné,
 * en privilégiant : id > data-* > classes pertinentes > tag + nth-of-type.
 */

(function (window) {
  'use strict';

  /**
   * Échapper un identifiant pour usage dans un sélecteur CSS.
   */
  function cssEscape(value) {
    if (window.CSS && typeof window.CSS.escape === 'function') {
      return window.CSS.escape(value);
    }
    return String(value).replace(/[^a-zA-Z0-9_-]/g, (c) => `\\${c}`);
  }

  function isMeaningfulClass(cls) {
    if (!cls || typeof cls !== 'string') return false;
    if (cls.startsWith('myfb-')) return false;
    // Ignorer classes utilitaires "noisy" générées (ex: tailwind aléatoires, css-modules hash)
    if (/^css-[a-z0-9]{5,}$/i.test(cls)) return false;
    if (/^[a-z]+-[0-9a-f]{6,}$/i.test(cls)) return false;
    return true;
  }

  function classSelector(el) {
    if (!el.classList || !el.classList.length) return '';
    const classes = Array.from(el.classList).filter(isMeaningfulClass);
    if (!classes.length) return '';
    return '.' + classes.map(cssEscape).join('.');
  }

  function nthOfTypeIndex(el) {
    let i = 1;
    let sib = el.previousElementSibling;
    while (sib) {
      if (sib.tagName === el.tagName) i++;
      sib = sib.previousElementSibling;
    }
    return i;
  }

  function isUnique(selector, root) {
    try {
      return root.querySelectorAll(selector).length === 1;
    } catch (e) {
      return false;
    }
  }

  /**
   * Génère un sélecteur unique pour `el` à l'intérieur de `root`.
   */
  function getUniqueSelector(el, root) {
    if (!el || el.nodeType !== 1) return '';
    root = root || document;

    if (el.id) {
      const sel = `#${cssEscape(el.id)}`;
      if (isUnique(sel, root)) return sel;
    }

    // data-testid / data-cy / data-test
    const dataAttrs = ['data-testid', 'data-test', 'data-cy', 'data-qa'];
    for (const attr of dataAttrs) {
      const v = el.getAttribute(attr);
      if (v) {
        const sel = `[${attr}="${cssEscape(v)}"]`;
        if (isUnique(sel, root)) return sel;
      }
    }

    const path = [];
    let current = el;
    while (current && current.nodeType === 1 && current !== root) {
      let part = current.tagName.toLowerCase();
      const cls = classSelector(current);
      if (cls) part += cls;

      const parent = current.parentElement;
      if (parent) {
        // Ajouter nth-of-type si l'identification reste ambigüe au niveau du parent
        const sameTypeSiblings = Array.from(parent.children).filter(
          (c) => c.tagName === current.tagName
        );
        if (sameTypeSiblings.length > 1) {
          part += `:nth-of-type(${nthOfTypeIndex(current)})`;
        }
      }

      path.unshift(part);

      const candidate = path.join(' > ');
      if (isUnique(candidate, root)) return candidate;

      current = parent;
    }

    return path.join(' > ');
  }

  /**
   * Capture un descripteur complet d'un élément pour le prompt IA.
   */
  function describeElement(el) {
    if (!el || el.nodeType !== 1) return null;

    const rect = el.getBoundingClientRect();
    const text = (el.innerText || '').trim().slice(0, 200);

    return {
      tag: el.tagName.toLowerCase(),
      id: el.id || null,
      classes: Array.from(el.classList || []),
      selector: getUniqueSelector(el),
      text,
      attrs: Array.from(el.attributes || [])
        .filter((a) => !a.name.startsWith('on'))
        .reduce((acc, a) => {
          if (a.name === 'class' || a.name === 'id') return acc;
          acc[a.name] = a.value.length > 200 ? a.value.slice(0, 200) + '…' : a.value;
          return acc;
        }, {}),
      box: {
        x: Math.round(rect.left),
        y: Math.round(rect.top),
        w: Math.round(rect.width),
        h: Math.round(rect.height),
      },
      outerHTML: el.outerHTML.length > 1000 ? el.outerHTML.slice(0, 1000) + '…' : el.outerHTML,
    };
  }

  window.MyFbSelector = { getUniqueSelector, describeElement };
})(window);
