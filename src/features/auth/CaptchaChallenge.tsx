import { useEffect, useRef, useState } from 'react';

import type { CaptchaConfig } from '@/shared/lib/env';

/*
 * Cloudflare Turnstile / hCaptcha widget, loaded only when a new anonymous identity is
 * being created and bot protection is configured. Both providers expose the same
 * explicit-render API shape: render(container, { sitekey, callback, ... }).
 */
interface WidgetApi {
  render: (
    container: HTMLElement,
    options: {
      sitekey: string;
      callback: (token: string) => void;
      'error-callback'?: () => void;
      'expired-callback'?: () => void;
      language?: string;
      hl?: string;
    },
  ) => string | number;
  remove?: (id: string | number) => void;
}

const SCRIPTS: Record<
  CaptchaConfig['provider'],
  { src: string; global: 'turnstile' | 'hcaptcha' }
> = {
  turnstile: {
    src: 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit',
    global: 'turnstile',
  },
  hcaptcha: { src: 'https://js.hcaptcha.com/1/api.js?render=explicit', global: 'hcaptcha' },
};

const loading = new Map<string, Promise<WidgetApi>>();

function loadWidget(provider: CaptchaConfig['provider']): Promise<WidgetApi> {
  const { src, global } = SCRIPTS[provider];
  let promise = loading.get(src);
  if (!promise) {
    promise = new Promise<WidgetApi>((resolve, reject) => {
      const script = document.createElement('script');
      script.src = src;
      script.async = true;
      script.onload = () => {
        const api = (window as unknown as Record<string, WidgetApi | undefined>)[global];
        if (api) resolve(api);
        else reject(new Error('CAPTCHA script loaded without its API'));
      };
      script.onerror = () => {
        loading.delete(src);
        reject(new Error('CAPTCHA script failed to load'));
      };
      document.head.append(script);
    });
    loading.set(src, promise);
  }
  return promise;
}

export function CaptchaChallenge({
  config,
  onToken,
}: {
  config: CaptchaConfig;
  onToken: (token: string) => void;
}) {
  const container = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let widgetId: string | number | undefined;
    let api: WidgetApi | undefined;
    let disposed = false;
    loadWidget(config.provider)
      .then((loaded) => {
        if (disposed || !container.current) return;
        api = loaded;
        widgetId = loaded.render(container.current, {
          sitekey: config.siteKey,
          callback: onToken,
          'error-callback': () => {
            setFailed(true);
          },
          'expired-callback': () => {
            setAttempt((n) => n + 1);
          },
          language: 'bg',
          hl: 'bg',
        });
      })
      .catch(() => {
        if (!disposed) setFailed(true);
      });
    return () => {
      disposed = true;
      if (api?.remove && widgetId !== undefined) api.remove(widgetId);
    };
  }, [config, onToken, attempt]);

  return (
    <div
      role="dialog"
      aria-label="Проверка за бот"
      className="fixed inset-x-4 bottom-4 z-50 mx-auto flex max-w-md flex-col items-center gap-3 rounded-panel bg-ink-900/95 glass p-5 text-center sm:bottom-8"
    >
      <p className="text-sm text-fg-muted">
        Кратка проверка, че си човек — само веднъж на това устройство.
      </p>
      <div ref={container} className="min-h-16" />
      {failed ? (
        <button
          type="button"
          className="text-sm font-semibold text-brand-300 underline-offset-4 hover:underline"
          onClick={() => {
            setFailed(false);
            setAttempt((n) => n + 1);
          }}
        >
          Проверката не се зареди. Опитай отново
        </button>
      ) : null}
    </div>
  );
}
