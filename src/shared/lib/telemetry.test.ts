import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  installGlobalErrorHandlers,
  reportError,
  resetTelemetry,
  sanitize,
  setTelemetrySink,
  type TelemetryEvent,
} from './telemetry';

afterEach(() => {
  resetTelemetry();
});

describe('telemetry', () => {
  it('scrubs tokens, keys, ids, room codes and user text', () => {
    const dirty =
      'failed for 3f2a9c1e-1111-4a2b-9c3d-123456789abc in /room/K7M4Q with "Испания" ' +
      'Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.c2lnbmF0dXJl sb_publishable_ABCdef123';
    const clean = sanitize(dirty);
    expect(clean).not.toMatch(/3f2a9c1e|K7M4Q|Испания|eyJ|sb_publishable_ABC/);
    expect(clean).toContain('[id]');
    expect(clean).toContain('/room/[code]');
  });

  it('sends nothing unless an operator registered a sink', () => {
    expect(() => {
      reportError('rpc_failure', new Error('x'));
    }).not.toThrow();
  });

  it('sends sanitized events and throttles identical ones', () => {
    const events: TelemetryEvent[] = [];
    setTelemetrySink((event) => events.push(event));
    for (let i = 0; i < 5; i++) reportError('rpc_failure', new Error('boom for /room/AB2CD'));
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      kind: 'rpc_failure',
      message: 'Error: boom for /room/[code]',
    });
  });

  it('never lets a broken sink break the game', () => {
    setTelemetrySink(() => {
      throw new Error('sink down');
    });
    expect(() => {
      reportError('render_error', new Error('y'));
    }).not.toThrow();
  });

  it('catches unhandled errors and rejections globally', () => {
    const sink = vi.fn();
    setTelemetrySink(sink);
    const target = new EventTarget() as unknown as Window;
    const uninstall = installGlobalErrorHandlers(target);
    target.dispatchEvent(Object.assign(new Event('error'), { error: new Error('global') }));
    target.dispatchEvent(Object.assign(new Event('unhandledrejection'), { reason: 'rejected' }));
    expect(sink.mock.calls.map(([event]) => (event as TelemetryEvent).kind)).toEqual([
      'unhandled_error',
      'unhandled_rejection',
    ]);
    uninstall();
  });
});
