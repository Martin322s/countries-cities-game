import {
  isPlayerVisible,
  nextVisibilityReport,
  TAB_HEARTBEAT_MS,
  type PeerTab,
  type TabObservation,
} from '@/domain';

/**
 * Watches this tab's Page Visibility and coordinates with the player's other tabs of
 * the same round, so visibility is judged per PLAYER: one hidden tab is not an absence
 * while another tab of the game is visible.
 *
 * Signals:
 *  - `document.visibilityState` (via `visibilitychange`) is the only source of truth.
 *  - `pagehide` marks the page as unloading (refresh, close, navigation); in Chrome it
 *    fires before the final `visibilitychange`, so the away is tagged as an unload.
 *  - `pageshow`, `focus` and `resume` only trigger a re-check of visibilityState (some
 *    mobile browsers miss a visibilitychange on return). `blur` alone is ignored: it
 *    also fires for the address bar, devtools, autofill and permission prompts.
 *
 * No timer runs while hidden for correctness: the away is sent immediately from the
 * event handler and the server stamps both ends. Network state is irrelevant here.
 */

export interface MonitorDocument {
  readonly visibilityState: DocumentVisibilityState;
  addEventListener(type: 'visibilitychange' | 'resume', listener: () => void): void;
  removeEventListener(type: 'visibilitychange' | 'resume', listener: () => void): void;
}

export interface MonitorWindow {
  addEventListener(
    type: 'pagehide' | 'pageshow' | 'focus' | 'blur',
    listener: (event: Event) => void,
  ): void;
  removeEventListener(
    type: 'pagehide' | 'pageshow' | 'focus' | 'blur',
    listener: (event: Event) => void,
  ): void;
  setInterval(handler: () => void, ms: number): number;
  clearInterval(id: number): void;
}

export interface MonitorChannel {
  postMessage(message: TabMessage): void;
  addEventListener(type: 'message', listener: (event: MessageEvent<TabMessage>) => void): void;
  removeEventListener(type: 'message', listener: (event: MessageEvent<TabMessage>) => void): void;
  close(): void;
}

export type TabMessage =
  | { type: 'hello'; tabId: string }
  /** playerVisible: the sender's view after its change — false means it already reported the away. */
  | { type: 'state'; tabId: string; visible: boolean; playerVisible: boolean }
  | { type: 'bye'; tabId: string; unloading: boolean };

export interface MonitorDeps {
  tabId: string;
  doc: MonitorDocument;
  win: MonitorWindow;
  /** null when BroadcastChannel is unavailable: the tab then decides on its own. */
  channel: MonitorChannel | null;
  now: () => number;
  report: (report: { visible: boolean; unloading: boolean }) => void;
  /** Strict game rule: this tab losing focus locks the player's round permanently. */
  lockOnExit?: boolean;
}

export class TabVisibilityMonitor {
  private readonly peers = new Map<string, PeerTab>();
  private last: TabObservation | null = null;
  private unloading = false;
  private timer: number | null = null;
  private exitReported = false;

  constructor(private readonly deps: MonitorDeps) {}

  start(): void {
    const { doc, win, channel } = this.deps;
    doc.addEventListener('visibilitychange', this.onVisibilityChange);
    doc.addEventListener('resume', this.recheck);
    win.addEventListener('pagehide', this.onPageHide);
    win.addEventListener('pageshow', this.onPageShow);
    win.addEventListener('focus', this.recheck);
    if (this.deps.lockOnExit) win.addEventListener('blur', this.onBlur);
    channel?.addEventListener('message', this.onMessage);
    channel?.postMessage({ type: 'hello', tabId: this.deps.tabId });
    this.timer = win.setInterval(this.onTick, TAB_HEARTBEAT_MS);
    this.evaluate();
  }

  stop(): void {
    const { doc, win, channel } = this.deps;
    doc.removeEventListener('visibilitychange', this.onVisibilityChange);
    doc.removeEventListener('resume', this.recheck);
    win.removeEventListener('pagehide', this.onPageHide);
    win.removeEventListener('pageshow', this.onPageShow);
    win.removeEventListener('focus', this.recheck);
    win.removeEventListener('blur', this.onBlur);
    if (this.timer !== null) win.clearInterval(this.timer);
    this.timer = null;
    if (channel) {
      channel.removeEventListener('message', this.onMessage);
      channel.postMessage({ type: 'bye', tabId: this.deps.tabId, unloading: false });
      channel.close();
    }
  }

  /** This tab's own state, as other tabs should see it. */
  private selfVisible(): boolean {
    return !this.unloading && this.deps.doc.visibilityState === 'visible';
  }

  private evaluate(cause: { unloading?: boolean; peerReportedAway?: boolean } = {}): void {
    if (this.deps.lockOnExit) {
      if (!this.selfVisible()) this.reportExit();
      return;
    }
    const now = this.deps.now();
    const selfVisible = this.selfVisible();
    const next: TabObservation = {
      selfVisible,
      playerVisible: isPlayerVisible(selfVisible, this.peers.values(), now),
    };
    const report = nextVisibilityReport(this.last, next);
    const selfChanged = this.last?.selfVisible !== selfVisible;
    this.last = next;
    if (selfChanged) this.announce();
    // The peer whose change caused this already reported the away: don't repeat it.
    if (report === 'away' && cause.peerReportedAway === true) return;
    if (report) {
      this.deps.report({
        visible: report === 'return',
        unloading: report === 'away' && (this.unloading || cause.unloading === true),
      });
    }
  }

  private announce(): void {
    // An unloading tab has said goodbye; it must not reappear as a peer.
    if (this.unloading) return;
    this.deps.channel?.postMessage({
      type: 'state',
      tabId: this.deps.tabId,
      visible: this.selfVisible(),
      playerVisible: this.last?.playerVisible ?? this.selfVisible(),
    });
  }

  private readonly onVisibilityChange = () => {
    this.evaluate();
  };

  private reportExit(): void {
    if (this.exitReported) return;
    this.exitReported = true;
    this.deps.report({ visible: false, unloading: this.unloading });
  }

  private readonly onBlur = () => {
    this.reportExit();
  };

  private readonly recheck = () => {
    this.evaluate();
  };

  private readonly onPageHide = () => {
    this.unloading = true;
    // Say goodbye first, so other tabs attribute a resulting absence to the unload.
    this.deps.channel?.postMessage({ type: 'bye', tabId: this.deps.tabId, unloading: true });
    this.evaluate();
  };

  private readonly onPageShow = (event: Event) => {
    // Restored from the back/forward cache: the page is alive again.
    if ((event as PageTransitionEvent).persisted) this.unloading = false;
    this.evaluate();
  };

  private readonly onTick = () => {
    // Visible tabs keep announcing themselves; everyone re-checks for silent peers.
    if (this.selfVisible()) this.announce();
    this.evaluate();
  };

  private readonly onMessage = (event: MessageEvent<TabMessage>) => {
    const message = event.data;
    if (message.tabId === this.deps.tabId) return;
    switch (message.type) {
      case 'hello':
        this.announce();
        return;
      case 'state':
        this.peers.set(message.tabId, { visible: message.visible, seenAt: this.deps.now() });
        this.evaluate({ peerReportedAway: !message.playerVisible });
        return;
      case 'bye':
        this.peers.delete(message.tabId);
        this.evaluate({ unloading: message.unloading });
        return;
    }
  };
}
