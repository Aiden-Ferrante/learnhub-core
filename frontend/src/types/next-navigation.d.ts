/** Narrowed override of next/navigation's types (predates the app-router migration).
 *  It REPLACES the module's real types, so every hook used anywhere in the app must be
 *  declared here or tsc reports TS2305. Candidate for deletion once the build's
 *  ignoreBuildErrors is retired. */
declare module 'next/navigation' {
  export function useRouter(): {
    push: (url: string) => void;
    replace: (url: string) => void;
    back: () => void;
    forward: () => void;
    refresh: () => void;
    prefetch: (url: string) => void;
  };
  export function usePathname(): string;
  export function useSearchParams(): URLSearchParams;
}
