# BI Chrome AI Feedback For AI

Extension Chrome (Manifest V3) qui reproduit la sidebar de feedback de
[WP Blazing Minds](https://github.com/Fantinati-Anthony/WP-Blazing-Minds)
mais sur **n'importe quelle page web**.

Conçue pour préparer rapidement un prompt à coller dans **Claude Code**
(ou tout autre LLM) afin de demander une modification ciblée :

- 🎯 **Sélecteur d'élément** : surligne au survol, capture au clic, génère
  un sélecteur CSS unique (id, data-testid, classes, nth-of-type).
- 🎙 **Micro → texte** : reconnaissance vocale en temps réel via la
  Web Speech API, insérée dans la zone de notes au fil de la dictée.
- ⌨️ **Raccourcis clavier** pour tout piloter sans souris.
- 📋 **Export Markdown** prêt à coller dans Claude Code, contenant URL,
  page, sélecteurs, classes, texte visible, outerHTML tronqué et la
  description de l'utilisateur.

## Installation (mode développeur)

1. Cloner ce repo et basculer sur la branche
   `claude/chrome-extension-feedback-PZt63`.
2. Ouvrir `chrome://extensions/` (ou `edge://extensions/`).
3. Activer le **mode développeur**.
4. Cliquer **« Charger l'extension non empaquetée »** et sélectionner le
   dossier racine du repo (celui qui contient `manifest.json`).

## Raccourcis

| Action                                     | Raccourci par défaut |
| ------------------------------------------ | -------------------- |
| Ouvrir / fermer la sidebar                 | `Alt+Shift+F`        |
| Activer / désactiver le sélecteur          | `Alt+Shift+E`        |
| Démarrer / arrêter le micro                | `Alt+Shift+M`        |
| Copier le prompt formaté pour l'IA         | `Alt+Shift+C`        |

> Les raccourcis sont personnalisables dans `chrome://extensions/shortcuts`.

### Raccourcis contextuels (dans la page)

- **Esc** : quitte le mode sélecteur d'élément.
- **Ctrl/Cmd + clic** : capture plusieurs éléments d'affilée sans quitter
  le picker.

## Workflow type

1. Lancer la sidebar (`Alt+Shift+F`).
2. Démarrer le micro (`Alt+Shift+M`) et décrire ce qui doit changer.
3. Activer le sélecteur (`Alt+Shift+E`) et cliquer le ou les éléments
   à modifier — leurs sélecteurs s'insèrent dans la zone de notes et
   s'affichent en chips.
4. Copier (`Alt+Shift+C`) puis coller dans Claude Code.

## Architecture

```
manifest.json              Manifest V3 + commands + content scripts
background.js              Service worker : relaie hotkeys & clic icône
content/
  css-selector.js          Génération du sélecteur CSS unique
  element-selector.js      Mode picker (overlay + capture click)
  voice-recorder.js        Web Speech API (continuous + interim)
  sidebar-ui.js            UI Shadow DOM, état, compilation du prompt
  main.js                  Bridge service worker ↔ modules de page
```

Chaque module expose un namespace global (`BIAIFSelector`,
`BIAIFElementSelector`, `BIAIFVoiceRecorder`, `BIAIFSidebar`) pour rester
testable individuellement, à l'image des modules `BlazingFeedback` du
plugin WordPress de référence.

## Limites connues

- La Web Speech API n'est disponible que sur Chrome / Edge / navigateurs
  Chromium ; elle nécessite une connexion réseau (la transcription passe
  par les serveurs Google).
- Sur certaines pages chrome-internes (`chrome://`, Web Store), Chrome
  refuse l'injection de content scripts : les raccourcis n'auront pas
  d'effet sur ces pages.
- Le Shadow DOM isole nos styles, mais l'overlay de surlignage utilise
  un `z-index` très élevé qui peut être recouvert par certains modaux
  full-screen.
