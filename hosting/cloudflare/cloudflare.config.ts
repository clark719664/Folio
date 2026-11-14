import { bindings, defineConfig } from 'cf/config';

export default defineConfig({
  accountId: 'beab6ed5231abcbda8f1b84f498d786f',
  worker: {
    name: 'folio-converter',
    compatibilityDate: '2026-11-14',
    entrypoint: './worker.js',
    workersDev: true,
    env: { CONVERTER: bindings.vpcService({ id: '01a1d86b-a2cd-7720-bff6-7723f11bb79b' }) },
  },
});
