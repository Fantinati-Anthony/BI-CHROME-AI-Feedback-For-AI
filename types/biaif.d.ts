/**
 * BIAIF type declarations
 *
 * The addon ships as IIFE modules that attach to `window.BIAIF*`. These
 * ambient declarations let editors give intellisense + catch typos
 * across the codebase without converting to TS sources.
 *
 * To enable type-checking on a JS file: add `// @ts-check` at the top.
 */

interface BIAIFRef {
  type: 'element' | 'screenshot' | 'text' | 'error' | string;
  /** Compressed (JPEG, max 1600px) data URL for screenshots. */
  dataUrl?: string | null;
  /** Original page URL where the ref was captured. */
  tabUrl?: string;
  /** GitHub `owner/repo` if the page is github.com. */
  repoId?: string;
  /** CSS selector (picker output). */
  selector?: string;
  /** Plain-text content (selection). */
  text?: string;
  /** Outer HTML (picker output, scrubbed if privacy-mode is on). */
  outerHTML?: string;
  /** Stack-trace line for error refs. */
  message?: string;
  /** Snippet preview. */
  snippet?: string;
  /** Capture mode: visible / selection / element / fullpage / file / image / image-url */
  mode?: string;
  /** Source URL (when ref came from a context-menu image). */
  srcUrl?: string;
  /** Capture timestamp (ms epoch). */
  ts?: number;
  /** True when dataUrl was stripped during export. */
  _stripped?: boolean;
}

interface BIAIFDemande {
  id: string;
  ts: number;
  text: string;
  refs: BIAIFRef[];
  url: string | null;
  conversationUrl?: string | null;
  repoId?: string | null;
  /** Submission status — set after Inject. */
  status?: 'submitted' | 'done';
  submittedTo?: string;
}

interface BIAIFTemplate {
  id: string;
  name: string;
  body: string;
  ts: number;
}

interface BIAIFCurrentDemande {
  text: string;
  refs: BIAIFRef[];
  pageUrl: string | null;
}

interface BIAIFVisibleButtons {
  [key: string]: boolean;
}

interface BIAIFState {
  // 1) SESSION
  armed: boolean;
  pickerActive: boolean;
  micActive: boolean;
  currentInterim: string;
  replacingRef: { demKey: number | 'current'; refIndex: number } | null;
  dictationTarget: number | 'current';
  modalTarget:     number | 'current';
  consoleErrors: { msg: string; ts: number; url?: string }[];
  editingDemandeIdx: number | null;
  searchQuery: string;
  pendingConversationUrl: string | null;
  pendingRepoId: string | null;
  lastShot: string | null;
  lastShotMode: string | null;
  conversationFilter: string;
  repoFilter: string;
  domainFilter: string;
  pageFilter: string;
  // 2) DATA
  currentDemande: BIAIFCurrentDemande;
  demandes: BIAIFDemande[];
  templates: BIAIFTemplate[];
  // 3) SETTINGS
  lang: string;
  uiLang: string;
  micDeviceId: string;
  sortOrder: 'asc' | 'desc';
  segFontSize: number;
  autoOpenOnKnownActive: boolean;
  autoOpenOnKnownDone:   boolean;
  autoOpenOnAiPage:      boolean;
  hideAiTextarea:        boolean;
  autoSubmitAfterInject: boolean;
  archiveExpanded:       boolean;
  showConsoleBtn:        boolean;
  topbarPosition: 'top' | 'bottom';
  theme: 'dark' | 'light' | 'auto';
  privacyScrub: boolean;
  syncEnabled:  boolean;
  visibleButtons: BIAIFVisibleButtons;
  // Live grouped views (read-through)
  session:  Partial<BIAIFState>;
  data:     Partial<BIAIFState>;
  settings: Partial<BIAIFState>;
}

interface BIAIFButtonDef {
  key: string;
  slug: string;
  label: string;
  i18nKey: string;
  defaultVisible: boolean;
  exportFn?: string;
  webUrl?: string;
}

interface BIAIFAiAdapter {
  host: string;
  label: string;
  webUrl?: string;
  editor?: string[];
  stopBtn?: string[];
  generatingEl?: string[];
  inputHide?: string[];
  submitBtn?: string[];
}

declare global {
  interface Window {
    BIAIF: {
      MSG: Record<string, string>;
      AI_TARGETS: BIAIFButtonDef[];
      LOCAL_ACTIONS: BIAIFButtonDef[];
      ALL_BUTTONS: BIAIFButtonDef[];
      AI_ADAPTERS: BIAIFAiAdapter[];
      utils: {
        extractGithubRepo(url: string): string | null;
        t(key: string, fallback?: string, vars?: Record<string, unknown>): string;
        decodeErr(e: unknown): string;
        msgKey(key: string): string;
        findAiAdapter(hostname: string): BIAIFAiAdapter | null;
        toast(msg: string, kind?: 'info' | 'success' | 'error', duration?: number): void;
        sendBg<T = unknown>(payload: object): Promise<T | null>;
      };
      config?: { ui?: Record<string, number> };
      dom?: { esc(s: unknown): string; formatUrl?(u: string): string; hostname?(u: string): string };
    };
    BIAIFStorage: {
      hydrate(STATE: BIAIFState, callback?: () => void): void;
      persist(STATE: BIAIFState, opts?: { skipUndo?: boolean }): void;
      exportToFile(STATE: BIAIFState, opts?: { stripDataUrls?: boolean }): object;
      importBundle(STATE: BIAIFState, bundle: unknown, opts?: { mode?: 'replace' | 'merge' }): { ok: boolean; error?: string; imported?: number };
      pullFromSync(STATE: BIAIFState): Promise<boolean>;
    };
    BIAIFSession: {
      init(state: BIAIFState, refs: Record<string, HTMLElement | null>): void;
      finalizeDemande(silent?: boolean): void;
      enterEditMode(idx: number): void;
      exitEditMode(opts?: { silent?: boolean }): void;
      disarm(): void;
      addRefToTarget(ref: BIAIFRef): Promise<boolean>;
      addTextToTarget(text: string): void;
      runShotMode(mode: string): Promise<void>;
      mergeDemandes(srcIdx: number, dstIdx: number): void;
      reorderDemande(srcIdx: number, dstIdx: number): void;
      syncCurrentDemandeFromEditor(): void;
      insertTextAtSelection(container: Element, text: string): void;
      rememberPageUrl(opt?: string): Promise<void>;
      editRef(demKey: number | 'current', refIndex: number, editType?: string): Promise<void>;
    };
    BIAIFTemplates: {
      init(state: BIAIFState): void;
      list(): BIAIFTemplate[];
      add(tpl: { name?: string; body: string }): BIAIFTemplate | null;
      remove(id: string): boolean;
      rename(id: string, name: string): boolean;
      insertIntoEditor(id: string): void;
      saveCurrentAsTemplate(name?: string): BIAIFTemplate | null;
      interpolate(body: string): string;
    };
    BIAIFScrub: {
      scrubText(s: string): string;
      scrubRef(ref: BIAIFRef): BIAIFRef;
      scrubDemande(d: BIAIFDemande): BIAIFDemande;
      isEnabled(STATE: Partial<BIAIFState>): boolean;
    };
    BIAIFImaging: {
      compressDataUrl(dataUrl: string, opts?: { maxWidth?: number; maxHeight?: number; quality?: number; mime?: string }): Promise<string>;
      bytes(dataUrl: string): number;
    };
    BIAIFToast: {
      show(msg: string, kind?: 'info' | 'success' | 'error', duration?: number): HTMLElement | undefined;
      showAction(msg: string, label: string, onClick: () => void, opts?: { kind?: string; duration?: number }): HTMLElement | undefined;
    };
    BIAIFUndo: {
      push(snapshot: object): void;
      pop(): object | null;
      clear(): void;
      canUndo(): boolean;
      size(): number;
    };
    BIAIFRender: {
      ctx: { STATE: BIAIFState; REFS: Record<string, HTMLElement | null>; init(s: BIAIFState, r: object): void };
      tokenCounter?: { update(): void };
      [key: string]: any;
    };
    BIAIFRenderer: Record<string, (...args: any[]) => any>;
    BIAIFSpeech: Record<string, (...args: any[]) => any>;
    BIAIFExport: Record<string, (...args: any[]) => any>;
  }
}

export {};
