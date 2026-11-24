import { Window } from 'happy-dom';

/**
 * Test-only browser globals for React DOM tests. This is not a layout engine:
 * it lets us assert rendered markup, state changes and event handling without a
 * real browser. Visual overflow is checked separately in the browser QA pass.
 */
export function installDomTestEnv(): void {
  const window = new Window({ url: 'http://localhost/' });
  const globals = globalThis as unknown as Record<string, unknown>;
  const define = (name: string, value: unknown) => {
    Object.defineProperty(globalThis, name, {
      value,
      configurable: true,
      writable: true,
    });
  };

  define('window', window);
  define('document', window.document);
  for (const name of [
    'navigator',
    'location',
    'localStorage',
    'sessionStorage',
    'HTMLElement',
    'HTMLInputElement',
    'Element',
    'Node',
    'Event',
    'CustomEvent',
    'MouseEvent',
    'MutationObserver',
  ] as const) {
    define(name, (window as unknown as Record<string, unknown>)[name]);
  }
  define('getComputedStyle', window.getComputedStyle.bind(window));
  define('requestAnimationFrame', window.requestAnimationFrame.bind(window));
  define('cancelAnimationFrame', window.cancelAnimationFrame.bind(window));
  define('IS_REACT_ACT_ENVIRONMENT', true);
  globals.IS_REACT_ACT_ENVIRONMENT = true;
}
