# My-Feedbacks

> **Local-first feedback bridge between developers and their clients.**
> Capture visuel, vocal, erreurs JS sur n'importe quelle page web, puis exporte
> vers Claude, ChatGPT, Cursor, VS Code Copilot, Aider — en un clic, avec
> screenshots, sélecteurs CSS, breadcrumbs et metadata appareil inlinés
> automatiquement.

[![License MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Manifest V3](https://img.shields.io/badge/manifest-v3-green.svg)](manifest.json)
[![Version](https://img.shields.io/badge/version-1.0.0-cyan.svg)](manifest.json)
![Languages](https://img.shields.io/badge/i18n-7%20langs-orange.svg)

Extension Chrome (Manifest V3) qui permet de pointer des éléments d'une page,
parler à leur sujet, capturer des screenshots, et transformer le tout en
prompt IA prêt à l'emploi. Pensée pour le **vibe-fixing** entre développeurs
et clients sans la galère du copier-coller.

→ **Site officiel :** [my-feedbacks.com](https://my-feedbacks.com)

---

## Philosophie : local-first

Tes feedbacks restent **chez toi**. My-Feedbacks ne possède aucun serveur
auquel envoyer tes données. Tu choisis ton canal :

| Mode | Setup | Stockage | Coût |
|---|---|---|---|
| **Solo** | aucun | local (IndexedDB) | gratuit |
| **Shared Folder** | un dossier Drive/Dropbox/OneDrive partagé | local + dossier partagé | gratuit |
| **Self-hosted** | binaire PHP open-source sur ton serveur | ton serveur | gratuit |
| **My-Feedbacks Cloud** | compte sur my-feedbacks.com | nos serveurs EU | payant (service géré) |

L'extension est **open-source MIT**. Le serveur self-hosted est
**open-source AGPL-3.0**. Le cloud officiel est un service géré payant.

---

## Quickstart

```bash
git clone https://github.com/Fantinati-Anthony/my-feedbacks-extension.git
cd my-feedbacks-extension
npm install
```

1. Ouvre `chrome://extensions/` (ou `edge://extensions/`).
2. Active le **Mode développeur**.
3. Clique **Charger l'extension non empaquetée** et sélectionne ce dossier.
4. Épingle l'extension et appuie sur **Alt+Shift+F** pour ouvrir le panneau.

Au premier lancement, un **wizard** te demande :
- Ton rôle (admin/dev/agence ou client)
- Ton mode de sync préféré (Solo par défaut)
- Ton consentement RGPD

---

## Raccourcis clavier

| Raccourci | Action |
|---|---|
| `Alt+Shift+F` | Ouvrir/fermer le panneau My-Feedbacks |
| `Alt+Shift+E` | Activer le sélecteur d'élément CSS |
| `Alt+Shift+M` | Démarrer/arrêter le micro (speech-to-text) |
| `Alt+Shift+C` | Copier le prompt formaté pour l'IA |

---

## Fonctionnalités

### Capture
- **Sélecteur d'éléments** CSS avec overlay persistant et badge cliquable
- **Captures de zone / plein écran / élément** avec annotations
- **Saisie vocale** multi-langue (7 langues)
- **Auto-capture au submit** : 20 dernières erreurs JS, 20 derniers échecs réseau, 20 dernières actions utilisateur (sans contenu de champs, RGPD-safe)
- **Métadonnées appareil** complètes : UUID persistant, browser, OS, viewport, DPR, hardware, network, locale, performance

### Triage & collaboration
- **Statuts** : nouveau → accepté → rejeté → livré
- **Commentaires** thread admin ↔ client par demande
- **Tags** multi-couleur, **priorités** (low / medium / high / critical)
- **Filtres & recherche** full-text

### IA native
- **Résumé automatique** par Claude
- **Triage suggéré** par IA (statut + priorité + tags)
- **Export one-click** vers Claude.ai, ChatGPT, Cursor, VS Code Copilot, Aider, Cody
- **Templates** de prompts partageables

### Sync
- **Solo** : tout local, zéro infra
- **Shared Folder** : sync via dossier cloud (Drive, Dropbox, OneDrive, LAN)
- **Self-hosted** : serveur PHP/MySQL open-source
- **Cloud** : my-feedbacks.com (multi-tenant, dashboard, webhooks, billing)

### Privacy
- **E2E encryption** opt-in (Web Crypto API)
- **Scrubbing PII automatique** (emails, IBAN, CB Luhn, JWT, tokens)
- **Mode anonyme** (UUID régénéré à chaque submit)
- **Export local one-click**, **delete-my-data RGPD-conforme**
- **Telemetry opt-in transparente**

---

## Architecture

Voir [ARCHITECTURE.md](ARCHITECTURE.md) pour les détails techniques. En résumé :

```
┌──────────────────────────────────────────────────────────────┐
│  Extension Chrome My-Feedbacks (vanilla JS + Dexie)          │
│                                                              │
│  ┌─────────────────────────────────────────────────────────┐ │
│  │  Event store (immuable, append-only, IndexedDB)         │ │
│  └─────────────────────────────────────────────────────────┘ │
│                            │                                 │
│                            ▼                                 │
│  ┌─────────────────────────────────────────────────────────┐ │
│  │  Reducer (état dérivé pur)                              │ │
│  └─────────────────────────────────────────────────────────┘ │
│                            │                                 │
│       ┌────────────────────┼────────────────────┐            │
│       ▼                    ▼                    ▼            │
│   Transports          Side panel UI       Page overlays      │
│   ├─ solo                                                    │
│   ├─ shared-folder                                           │
│   ├─ self-hosted                                             │
│   └─ cloud                                                   │
└──────────────────────────────────────────────────────────────┘
```

L'**event sourcing** rend la sync triviale, l'undo/redo gratuit, l'audit log
gratuit, et le multi-device trivial.

---

## Développement

```bash
npm install
npm test            # vitest run
npm run lint        # eslint
npm run i18n:check  # audit clés i18n (7 langues)
npm run build       # esbuild
```

### Structure

```
shared/
  core/
    events/     event store, reducer, lamport clock, catalog
    transports/ solo, shared-folder, self-hosted, cloud
  i18n.js       7 langues, audité en CI
  scrub.js      scrubbing PII automatique
  ai-adapters.js
content/        scripts injectés dans les pages
sidepanel/      UI du panneau latéral
background/     service worker
tests/          vitest + jsdom
```

---

## Roadmap

- ✅ **v1.0.0** — Foundation : rebrand, event sourcing core, tier Solo
- 🟡 **v1.1** — UX V4 : wizard, rôles, overlays page, triage, comments, breadcrumbs
- 🟡 **v1.2** — Tier 2 (shared folder) + IA (résumé, triage suggéré)
- 🟡 **v1.3** — Tier 3 (self-hosted server open-source, repo séparé)
- 🟡 **v2.0** — Tier 4 (my-feedbacks.com cloud + dashboard + billing)

---

## Contribuer

Voir [CONTRIBUTING.md](CONTRIBUTING.md). PRs bienvenues. Bugs : ouvre une issue.

## Licence

MIT pour l'extension. AGPL-3.0 pour le futur serveur self-hosted.

## Privacy

[PRIVACY.md](PRIVACY.md) détaille ce qui est collecté, comment, et comment
exporter/supprimer tes données.
