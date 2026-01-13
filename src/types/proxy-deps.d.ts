/**
 * Type declarations for proxy-related dependencies
 */

declare module '@tootallnate/quickjs-emscripten' {
  export interface QuickJSWASMModule {
    // QuickJS WASM module interface
  }

  export function getQuickJS(): Promise<QuickJSWASMModule>;
}

declare module 'pac-resolver' {
  import type { QuickJSWASMModule } from '@tootallnate/quickjs-emscripten';

  export interface PacResolverOptions {
    filename?: string;
    sandbox?: Record<string, unknown>;
  }

  export type FindProxyForURL = (url: string | URL, host?: string) => Promise<string>;

  export function createPacResolver(
    qjs: QuickJSWASMModule,
    pacScript: string | Buffer,
    options?: PacResolverOptions
  ): FindProxyForURL;
}
