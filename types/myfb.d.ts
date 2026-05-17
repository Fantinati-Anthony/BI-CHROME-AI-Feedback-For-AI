/**
 * BIAIF type declarations
 *
 * The addon ships as IIFE modules that progressively enrich
 * `window.BIAIF*` globals. To keep tsc happy with that pattern, every
 * window-attached field is optional and the main `BIAIF` object has a
 * permissive index signature. Strictness lives in individual function
 * parameter / return types.
 *
 * To enable type-checking on a JS file: add `// @ts-check` at the top.
 */

interface BIAIFRef {
  type: 'element' | 'screenshot' | 'text' | 'error' | string;
  dataUrl?: string | null;
  blobId?: string | null;
  tabUrl?: string;
  repoId?: string;
  selector?: string;
  text?: string;
  outerHTML?: string;
  message?: string;
  snippet?: string;
  mode?: string;
  srcUrl?: string;
  ts?: number;
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

/** Permissive shape for the loosely-typed STATE object. */
interface BIAIFState {
  [key: string]: any;
  demandes: BIAIFDemande[];
  currentDemande: BIAIFCurrentDemande;
  templates: BIAIFTemplate[];
  visibleButtons: Record<string, boolean>;
}

/** Aggregator for shared/* modules. Index signature keeps it permissive. */
interface BIAIFNamespace {
  [key: string]: any;
  MSG?: Record<string, string>;
  AI_TARGETS?: BIAIFButtonDef[];
  LOCAL_ACTIONS?: BIAIFButtonDef[];
  ALL_BUTTONS?: BIAIFButtonDef[];
  AI_ADAPTERS?: BIAIFAiAdapter[];
  VSCODE_BRIDGE_PORT?: number;
  STORAGE_KEY?: string;
  STORAGE_LEGACY_KEYS?: string[];
  VERSION?: string;
  utils?: {
    extractGithubRepo(url: string): string | null;
    t(key: string, fallback?: string, vars?: Record<string, unknown>): string;
    tn(baseKey: string, n: number, fallback?: string, vars?: Record<string, unknown>): string;
    decodeErr(e: unknown): string;
    msgKey(key: string): string;
    findAiAdapter(hostname: string): BIAIFAiAdapter | null;
    toast(msg: string, kind?: 'info' | 'success' | 'error', duration?: number): void;
    sendBg<T = unknown>(payload: object): Promise<T | null>;
  };
  config?: { ui?: Record<string, number> };
  dom?: {
    esc(s: unknown): string;
    escAttr?(s: unknown): string;
    formatUrl?(u: string): string;
    hostname?(u: string): string;
  };
}

declare global {
  interface Window {
    BIAIF?: BIAIFNamespace;
    BIAIFStorage?: { [k: string]: any };
    BIAIFSession?:  { [k: string]: any };
    BIAIFTemplates?:{ [k: string]: any };
    BIAIFScrub?:    { [k: string]: any };
    BIAIFImaging?:  { [k: string]: any };
    BIAIFToast?:    { [k: string]: any };
    BIAIFUndo?:     { [k: string]: any };
    BIAIFRender?:   { [k: string]: any; ctx?: any; tokenCounter?: { update(): void; _estimate?(s: string): number; _kindFor?(n: number): string } };
    BIAIFRenderer?: { [k: string]: any };
    BIAIFSpeech?:   { [k: string]: any };
    BIAIFExport?:   { [k: string]: any };
    BIAIFBindings?: { [k: string]: any };
    BIAIFBlobStore?:{ [k: string]: any };
    BIAIFPalette?:  { [k: string]: any };
    BIAIFPerf?:     { [k: string]: any };
    BIAIFi18n?:     { [k: string]: any };
    BIAIFIntentParser?: { [k: string]: any };
    BIAIFLog?:      (level: string, ...args: any[]) => void;
  }

  /** Logger reads/writes `globalThis.biaif_log_level`. */
  // eslint-disable-next-line no-var
  var biaif_log_level: string | undefined;
}

export {};
