/**
 * BIAIF Intent Parser (shared)
 *
 * Repère, dans une transcription vocale, les verbes-déclencheurs qui
 * indiquent l'action voulue par l'utilisateur. Renvoie un tableau de
 * tags normalisés (move, copy, fix, …) qu'on attache aux segments.
 */

(function (root) {
  'use strict';

  // FR + EN. La normalisation passe en lowercase + retrait des accents.
  const INTENTS = {
    move:    ['deplacer', 'deplace', 'bouger', 'pousser', 'move'],
    copy:    ['copier', 'copie', 'dupliquer', 'duplique', 'copy', 'duplicate'],
    fix:     ['corriger', 'corrige', 'reparer', 'repare', 'fix', 'repair'],
    delete:  ['supprimer', 'supprime', 'enlever', 'enleve', 'effacer', 'efface', 'retirer', 'retire', 'delete', 'remove'],
    add:     ['ajouter', 'ajoute', 'inserer', 'insere', 'creer', 'cree', 'add', 'insert', 'create'],
    replace: ['remplacer', 'remplace', 'substituer', 'replace', 'swap'],
    style:   ['styler', 'restyler', 'styliser', 'colorier', 'colorer', 'restyle', 'recolor'],
    rename:  ['renommer', 'renomme', 'rename'],
    align:   ['aligner', 'aligne', 'centrer', 'centre', 'align', 'center'],
    resize:  ['redimensionner', 'redimensionne', 'agrandir', 'reduire', 'resize', 'shrink', 'enlarge'],
    rewrite: ['reformuler', 'reformule', 'reecrire', 'reecris', 'rewrite', 'reword'],
    hide:    ['cacher', 'cache', 'masquer', 'masque', 'hide'],
    show:    ['afficher', 'affiche', 'montrer', 'montre', 'show', 'reveal'],
  };

  function normalize(s) {
    return String(s || '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '');
  }

  function detect(text) {
    const norm = normalize(text);
    if (!norm) return [];
    const found = new Set();
    for (const [intent, verbs] of Object.entries(INTENTS)) {
      if (verbs.some((v) => norm.includes(v))) found.add(intent);
    }
    return Array.from(found);
  }

  function listIntents() { return Object.keys(INTENTS); }

  root.BIAIFIntentParser = { detect, listIntents };
})(typeof window !== 'undefined' ? window : self);
