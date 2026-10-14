import {defineConfig} from 'vitest/config';
export default defineConfig({cacheDir:'.centinel-vitest-cache',test:{include:['fixture.case.ts'],fileParallelism:false,maxWorkers:1}});
