import { describe, expect, it } from 'vitest';

import { TAB_HEARTBEAT_MS, TAB_STALE_MS } from '@/domain';

import {
  TabVisibilityMonitor,
  type MonitorChannel,
  type MonitorDocument,
  type MonitorWindow,
  type TabMessage,
} from './tabVisibilityMonitor';

type Listener = (event: Event) => void;

/** Same-origin BroadcastChannel stand-in: delivers to every other member synchronously. */
class Bus {
  readonly members = new Set<FakeChannel>();
  open(): FakeChannel {
    const channel = new FakeChannel(this);
    this.members.add(channel);
    return channel;
  }
}

class FakeChannel implements MonitorChannel {
  private listeners = new Set<(event: MessageEvent<TabMessage>) => void>();
  constructor(private readonly bus: Bus) {}
  postMessage(message: TabMessage) {
    for (const member of this.bus.members) {
      if (member === this) continue;
      for (const listener of member.listeners)
        listener({ data: message } as MessageEvent<TabMessage>);
    }
  }
  addEventListener(_type: 'message', listener: (event: MessageEvent<TabMessage>) => void) {
    this.listeners.add(listener);
  }
  removeEventListener(_type: 'message', listener: (event: MessageEvent<TabMessage>) => void) {
    this.listeners.delete(listener);
  }
  close() {
    this.bus.members.delete(this);
  }
}

class FakeTab {
  visibilityState: DocumentVisibilityState = 'visible';
  readonly reports: { visible: boolean; unloading: boolean }[] = [];
  private docListeners = new Map<string, Set<() => void>>();
  private winListeners = new Map<string, Set<Listener>>();
  private intervals = new Map<number, () => void>();
  readonly monitor: TabVisibilityMonitor;

  constructor(
    tabId: string,
    bus: Bus | null,
    private readonly clock: { now: number },
    visible = true,
  ) {
    this.visibilityState = visible ? 'visible' : 'hidden';
    const doc: MonitorDocument = {
      get visibilityState() {
        return self.visibilityState;
      },
      addEventListener: (type, listener) => {
        this.listenersOf(this.docListeners, type).add(listener);
      },
      removeEventListener: (type, listener) => {
        this.docListeners.get(type)?.delete(listener);
      },
    };
    // eslint-disable-next-line @typescript-eslint/no-this-alias -- getter needs the instance
    const self = this;
    let nextId = 1;
    const win: MonitorWindow = {
      addEventListener: (type, listener) => {
        this.listenersOf(this.winListeners, type).add(listener);
      },
      removeEventListener: (type, listener) => {
        this.winListeners.get(type)?.delete(listener);
      },
      setInterval: (handler) => {
        const id = nextId++;
        this.intervals.set(id, handler);
        return id;
      },
      clearInterval: (id) => {
        this.intervals.delete(id);
      },
    };
    this.monitor = new TabVisibilityMonitor({
      tabId,
      doc,
      win,
      channel: bus ? bus.open() : null,
      now: () => this.clock.now,
      report: (report) => this.reports.push(report),
    });
  }

  private listenersOf<T>(map: Map<string, Set<T>>, type: string): Set<T> {
    let set = map.get(type);
    if (!set) {
      set = new Set();
      map.set(type, set);
    }
    return set;
  }

  setVisible(visible: boolean) {
    this.visibilityState = visible ? 'visible' : 'hidden';
    for (const listener of this.docListeners.get('visibilitychange') ?? []) listener();
  }

  fireWindow(type: string, event: Partial<PageTransitionEvent> = {}) {
    for (const listener of this.winListeners.get(type) ?? []) listener(event as Event);
  }

  tick() {
    for (const handler of this.intervals.values()) handler();
  }

  /** Reports since the last call, as compact strings. */
  take(): string[] {
    const taken = this.reports
      .splice(0)
      .map((r) => (r.visible ? 'return' : r.unloading ? 'away(unload)' : 'away'));
    return taken;
  }
}

describe('TabVisibilityMonitor — single tab', () => {
  it('reports a return on start (closes anything left open) and away on hide', () => {
    const tab = new FakeTab('a', new Bus(), { now: 0 });
    tab.monitor.start();
    expect(tab.take()).toEqual(['return']);
    tab.setVisible(false);
    expect(tab.take()).toEqual(['away']);
    tab.setVisible(true);
    expect(tab.take()).toEqual(['return']);
  });

  it('swallows duplicate browser events', () => {
    const tab = new FakeTab('a', null, { now: 0 });
    tab.monitor.start();
    tab.take();
    tab.setVisible(false);
    tab.setVisible(false);
    tab.fireWindow('focus');
    expect(tab.take()).toEqual(['away']);
    tab.setVisible(true);
    tab.fireWindow('focus');
    tab.fireWindow('pageshow');
    expect(tab.take()).toEqual(['return']);
  });

  it('ignores blur while the page stays visible', () => {
    const tab = new FakeTab('a', null, { now: 0 });
    tab.monitor.start();
    tab.take();
    tab.fireWindow('blur');
    expect(tab.take()).toEqual([]);
  });

  it('tags an away caused by unloading (refresh / close)', () => {
    const tab = new FakeTab('a', new Bus(), { now: 0 });
    tab.monitor.start();
    tab.take();
    tab.fireWindow('pagehide', { persisted: false });
    tab.setVisible(false); // Chrome: pagehide, then visibilitychange
    expect(tab.take()).toEqual(['away(unload)']);
  });

  it('does not report away for a tab that starts hidden', () => {
    const tab = new FakeTab('a', new Bus(), { now: 0 }, false);
    tab.monitor.start();
    expect(tab.take()).toEqual([]);
  });

  it('reports nothing after it was stopped (answers locked)', () => {
    const tab = new FakeTab('a', null, { now: 0 });
    tab.monitor.start();
    tab.take();
    tab.monitor.stop();
    tab.setVisible(false);
    tab.setVisible(true);
    expect(tab.take()).toEqual([]);
  });
});

describe('TabVisibilityMonitor — multiple tabs of one player', () => {
  it('one visible + one hidden → still visible; both hidden → away; one back → return', () => {
    const bus = new Bus();
    const clock = { now: 0 };
    const a = new FakeTab('a', bus, clock);
    const b = new FakeTab('b', bus, clock);
    a.monitor.start();
    b.monitor.start();
    a.take();
    b.take();

    b.setVisible(false); // B hidden, A visible
    expect([...a.take(), ...b.take()]).toEqual([]);

    a.setVisible(false); // both hidden
    expect([...a.take(), ...b.take()]).toEqual(['away']);

    b.setVisible(true); // B back
    expect(b.take()).toEqual(['return']);
    expect(a.take()).toEqual([]);
  });

  it('treats a silent peer as gone after the stale window', () => {
    const bus = new Bus();
    const clock = { now: 0 };
    const a = new FakeTab('a', bus, clock);
    const b = new FakeTab('b', bus, clock);
    a.monitor.start();
    b.monitor.start();
    a.setVisible(false);
    a.take();
    b.take();
    // B crashes silently (no bye): it stops announcing.
    bus.members.forEach((member) => {
      if (member !== [...bus.members][0]) member.close();
    });
    clock.now += TAB_STALE_MS + TAB_HEARTBEAT_MS;
    a.tick();
    expect(a.take()).toEqual(['away']);
  });

  it('a closing visible tab hands the absence over as an unload', () => {
    const bus = new Bus();
    const clock = { now: 0 };
    const a = new FakeTab('a', bus, clock);
    const b = new FakeTab('b', bus, clock);
    a.monitor.start();
    b.monitor.start();
    a.setVisible(false);
    a.take();
    b.take();
    b.fireWindow('pagehide'); // B (the visible one) is refreshed or closed
    const reports = [...a.take(), ...b.take()];
    expect(reports.length).toBeGreaterThan(0);
    expect(reports.every((r) => r === 'away(unload)')).toBe(true);
  });
});
