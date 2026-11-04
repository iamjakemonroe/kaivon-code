/// <reference lib="webworker" />
/** Runs the playground's tests in a worker, so a loop that never ends can't freeze the page. Each file
 * becomes a module, and node:test and node:assert are small stand-ins for the real ones. Everything
 * stays in the visitor's browser. */

type File = { name: string; code: string };
type Test = { name: string; fn: () => unknown };

const tests: Test[] = [];
const line = (text: string, kind = '') => postMessage({ type: 'line', text, kind });

class AssertionError extends Error {
  override name = 'AssertionError';
}

const show = (v: unknown) => (typeof v === 'string' ? `'${v}'` : typeof v === 'object' ? JSON.stringify(v) : String(v));

const assert = Object.assign(
  (value: unknown, message?: string) => {
    if (!value) throw new AssertionError(message ?? 'The expression evaluated to a falsy value');
  },
  {
    ok(value: unknown, message?: string) {
      if (!value) throw new AssertionError(message ?? 'The expression evaluated to a falsy value');
    },
    equal(actual: unknown, expected: unknown, message?: string) {
      if (!Object.is(actual, expected)) throw new AssertionError(message ?? `Expected values to be strictly equal:\n\n${show(actual)} !== ${show(expected)}`);
    },
    notEqual(actual: unknown, expected: unknown, message?: string) {
      if (Object.is(actual, expected)) throw new AssertionError(message ?? `Expected "actual" to be strictly unequal to: ${show(expected)}`);
    },
    deepEqual(actual: unknown, expected: unknown, message?: string) {
      if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new AssertionError(message ?? `Expected values to be strictly deep-equal:\n\n${show(actual)} !== ${show(expected)}`);
    },
    throws(fn: () => unknown, message?: string) {
      try {
        fn();
      } catch {
        return;
      }
      throw new AssertionError(message ?? 'Missing expected exception.');
    },
  },
);

const scope = globalThis as unknown as Record<string, unknown>;
scope.__test = (name: string, fn: () => unknown) => void tests.push({ name, fn });
scope.__assert = assert;

const blob = (code: string) => URL.createObjectURL(new Blob([code], { type: 'text/javascript' }));
const SHIMS: Record<string, string> = {
  'node:test': blob('export default globalThis.__test; export const test = globalThis.__test; export const it = globalThis.__test;'),
  'node:assert/strict': blob('export default globalThis.__assert;'),
  'node:assert': blob('export default globalThis.__assert;'),
};

function modules(files: File[]) {
  const urls = new Map<string, string>();
  const names = new Map<string, string>();
  const find = (spec: string) => files.find((f) => f.name === spec.replace(/^\.\//, '') || f.name === `${spec.replace(/^\.\//, '')}.js`);
  const url = (file: File, path: string[]): string => {
    const known = urls.get(file.name);
    if (known) return known;
    if (path.includes(file.name)) throw new Error(`${[...path, file.name].join(' → ')} import each other in a circle.`);
    const code = file.code.replace(/(\bfrom\s*|\bimport\s*\(?\s*)(['"])([^'"]+)\2/g, (whole, lead: string, quote: string, spec: string) => {
      if (SHIMS[spec]) return `${lead}${quote}${SHIMS[spec]}${quote}`;
      const target = spec.startsWith('.') ? find(spec) : null;
      return target ? `${lead}${quote}${url(target, [...path, file.name])}${quote}` : whole;
    });
    const made = blob(code);
    urls.set(file.name, made);
    names.set(made, file.name);
    return made;
  };
  return { url, named: (text: string) => [...names].reduce((t, [u, n]) => t.split(u).join(n), text) };
}

const text = (args: unknown[]) => args.map((a) => (typeof a === 'string' ? a : show(a))).join(' ');
console.log = console.info = (...a: unknown[]) => line(text(a));
console.error = console.warn = (...a: unknown[]) => line(text(a), 'fail');

self.onmessage = async (e: MessageEvent<{ files: File[] }>) => {
  const files = e.data.files.filter((f) => f.name.endsWith('.js'));
  const { url, named } = modules(files);
  try {
    for (const file of files.filter((f) => f.name.endsWith('.test.js'))) await import(/* @vite-ignore */ url(file, []));
  } catch (err) {
    line(named(`${(err as Error).name}: ${(err as Error).message}`), 'fail');
    postMessage({ type: 'done', pass: 0, fail: 1 });
    return;
  }
  let pass = 0;
  let fail = 0;
  for (const test of tests) {
    const started = performance.now();
    try {
      await test.fn();
      pass++;
      line(`✔ ${test.name} (${(performance.now() - started).toFixed(1)}ms)`, 'pass');
    } catch (err) {
      fail++;
      line(`✖ ${test.name}`, 'fail');
      line(`  ${named((err as Error).message).split('\n').filter(Boolean).join('\n  ')}`);
    }
  }
  line(`tests ${pass + fail} · pass ${pass} · fail ${fail}`);
  postMessage({ type: 'done', pass, fail });
};
