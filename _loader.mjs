import { fileURLToPath } from 'node:url';
const stub = new URL('./_types-stub.mjs', import.meta.url).href;
export async function resolve(specifier, context, nextResolve) {
  if (specifier.includes('shared/types')) {
    return { url: stub, shortCircuit: true };
  }
  try {
    return await nextResolve(specifier, context);
  } catch (err) {
    if (specifier.startsWith('.') && !/\.[a-z]+$/i.test(specifier)) {
      return nextResolve(specifier + '.ts', context);
    }
    throw err;
  }
}