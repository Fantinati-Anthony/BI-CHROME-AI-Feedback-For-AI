/**
 * My-Feedbacks type declarations
 *
 * The addon ships as IIFE modules that progressively enrich
 * `window.MyFb*` globals. To keep tsc happy with that pattern, every
 * window-attached field is optional and the main `MyFb` object has a
 * permissive index signature. Strictness lives in individual function
 * parameter / return types.
 *
 * To enable type-checking on a JS file: add `// @ts-check` at the top.
 */

interface MyFbRef {
  type: 'element' | 'screenshot' | 'text' | 'error' | 'annotation' | string;
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

interface MyFbDemande {
  id: string;
  ts: number;
  text: string;
  refs: MyFbRef[];
  url: string | null;
  conversationUrl?: string | null;
  repoId?: string | null;
  status?: 'submitted' | 'done' | 'new' | 'accepted' | 'rejected' | 'shipped';
  submittedTo?: string;
}

interface MyFbTemplate {
  id: string;
  name: string;
  body: string;
  ts: number;
}

interface MyFbCurrentDemande {
  text: string;
  refs: MyFbRef[];
  pageUrl: string | null;
}

interface MyFbButtonDef {
  key: string;
  slug: string;
  label: string;
  i18nKey: string;
  defaultVisible: boolean;
  exportFn?: string;
  webUrl?: string;
}

interface MyFbAiAdapter {
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
/** v2.4 — one persisted DB profile card. The HMAC secret is stored as
 *  an AES-GCM envelope (see MyFbDbSecretCrypto). Legacy fields
 *  `bridgeSecret` (plaintext) are auto-migrated on load. */
interface MyFbDbProfile {
  id: string;
  label: string;
  engine: 'mysql' | 'postgres' | 'sqlite' | 'mongo' | 'other';
  mode: 'paste' | 'bridge';
  host?: string;
  port?: number | null;
  database?: string;
  prefix?: string;
  schemaMd: string;
  notes?: string;
  autoInject?: boolean;
  bridgeUrl?: string;
  bridgeSecret?: string;                  // legacy — migrated to bridgeSecretEnc
  bridgeSecretEnc?: { iv: string; ct: string };
  linkedRepoId?: string | null;
  linkedDomain?: string | null;
  lastRefreshTs?: number;
  ts: number;
  updatedTs?: number;
}

interface MyFbState {
  [key: string]: any;
  demandes: MyFbDemande[];
  currentDemande: MyFbCurrentDemande;
  templates: MyFbTemplate[];
  dbProfiles?: MyFbDbProfile[];
  visibleButtons: Record<string, boolean>;
}

/** Aggregator for shared/* modules. Index signature keeps it permissive. */
interface MyFbNamespace {
  [key: string]: any;
  MSG?: Record<string, string>;
  AI_TARGETS?: MyFbButtonDef[];
  LOCAL_ACTIONS?: MyFbButtonDef[];
  ALL_BUTTONS?: MyFbButtonDef[];
  AI_ADAPTERS?: MyFbAiAdapter[];
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
    findAiAdapter(hostname: string): MyFbAiAdapter | null;
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
  /** Event-sourcing core (v1.0.0+). Permissive shape — each sub-module
   *  attaches itself via IIFE, so we don't try to enumerate the surface. */
  core?: {
    [k: string]: any;
    events?:     { [k: string]: any };
    lamport?:    { [k: string]: any };
    store?:      { [k: string]: any };
    reducer?:    { [k: string]: any };
    transports?: { [k: string]: any };
  };
}

declare global {
  interface Window {
    MyFb?: MyFbNamespace;
    MyFbStorage?: { [k: string]: any };
    MyFbSession?:  { [k: string]: any };
    MyFbTemplates?:{ [k: string]: any };
    MyFbScrub?:    { [k: string]: any };
    MyFbImaging?:  { [k: string]: any };
    MyFbToast?:    { [k: string]: any };
    MyFbUndo?:     { [k: string]: any };
    MyFbRender?:   { [k: string]: any; ctx?: any; tokenCounter?: { update(): void; _estimate?(s: string): number; _kindFor?(n: number): string } };
    MyFbRenderer?: { [k: string]: any };
    MyFbSpeech?:   { [k: string]: any };
    MyFbExport?:   { [k: string]: any };
    MyFbBindings?: { [k: string]: any };
    MyFbBlobStore?:{ [k: string]: any };
    MyFbPalette?:  { [k: string]: any };
    MyFbPerf?:     { [k: string]: any };
    MyFbWizard?:   { [k: string]: any };
    MyFbOnboarding?: { [k: string]: any };
    MyFbRuntimeBoot?: { [k: string]: any };
    MyFbOverlayController?: { [k: string]: any };
    MyFbRefOverlay?: { [k: string]: any };
    MyFbTriage?:   { [k: string]: any };
    MyFbBreadcrumbs?: { [k: string]: any };
    MyFbAiUi?: { [k: string]: any };
    MyFbSettingsUi?: { [k: string]: any };
    MyFbExportPicker?: { [k: string]: any };
    MyFbTriageUi?: { [k: string]: any };
    MyFbTriageFilter?: { [k: string]: any };
    MyFbDataControls?: { [k: string]: any };
    MyFbPairingUi?: { [k: string]: any };
    MyFbLegacyEventBridge?: { [k: string]: any };
    MyFbStateSync?: { [k: string]: any };
    MyFbPrivacyControls?: { [k: string]: any };
    MyFbVideoRecorder?: { [k: string]: any };
    MyFbQuickToolsConfig?: { [k: string]: any };
    /** v2.4 — DB context for AI (see bridge/myfb-bridge.php) */
    MyFbDbBridge?: {
      call(profile: { bridgeUrl: string; bridgeSecret: string }, op: string, args?: Record<string, unknown>): Promise<unknown>;
      fetchSchemaMd(profile: { bridgeUrl: string; bridgeSecret: string }): Promise<string>;
      signRequest(secret: string, ts: number, nonce: string, op: string, args: Record<string, unknown>): Promise<string>;
      _canonArgs(args: unknown): string;
    };
    MyFbDbProfilesUi?: {
      init(state?: MyFbState): Promise<void> | void;
      render(): void;
    };
    MyFbDbSecretCrypto?: {
      encrypt(plaintext: string): Promise<{ iv: string; ct: string }>;
      decrypt(envelope: { iv: string; ct: string }): Promise<string>;
      ready(): Promise<boolean>;
      isEnvelope(v: unknown): boolean;
    };
    MyFbNetworkBridge?: { [k: string]: any };
    MyFbIntentParser?: { [k: string]: any };
    MyFbLog?:      (level: string, ...args: any[]) => void;
  }

  /** Logger reads/writes `globalThis.myfb_log_level`. */
  // eslint-disable-next-line no-var
  var myfb_log_level: string | undefined;
}

export {};
