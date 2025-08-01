// This file provides type declarations for Deno-specific globals and remote modules
// to satisfy the local TypeScript compiler in a non-Deno environment.
// It is NOT meant to be deployed as a Supabase Edge Function.

declare namespace Deno {
  namespace env {
    function get(key: string): string | undefined;
  }
}

declare module "https://deno.land/std@0.224.0/http/server.ts" {
  export function serve(handler: (req: Request) => Promise<Response> | Response): Promise<void>;
}

declare module "https://deno.land/std@0.224.0/uuid/v4.ts" {
  export function v4(): string;
}

declare module "https://deno.land/std@0.224.0/encoding/base64.ts" {
  export function encode(input: string | Uint8Array): string;
  export function decode(input: string): Uint8Array;
}

// Removed: declare module "https://esm.sh/@supabase/supabase-js@2.50.1" { ... }
// This declaration is removed to allow TypeScript to use the official types from the installed npm package.

declare module "https://esm.sh/@google/generative-ai@0.15.0" {
  import { GoogleGenerativeAI as GoogleGenerativeAIOriginal, GenerativeModel } from '@google/generative-ai';
  export { GenerativeModel };
  export const GoogleGenerativeAI: typeof GoogleGenerativeAIOriginal;
}

declare module "https://esm.sh/openai@4.52.7" {
  import OpenAIOriginal from 'openai';
  export default OpenAIOriginal;
  export * from 'openai'; // Re-export all named exports
}