declare namespace Deno {
  namespace env {
    function get(key: string): string | undefined;
  }
}

declare module "https://deno.land/std@0.224.0/http/server.ts" {
  export function serve(handler: (req: Request) => Promise<Response> | Response): Promise<void>;
}

declare module "https://esm.sh/@supabase/supabase-js@2.50.1" {
  import { SupabaseClient as SupabaseClientOriginal, createClient as createClientOriginal, Session, User } from '@supabase/supabase-js';
  export { Session, User };
  export const createClient: typeof createClientOriginal;
  export type SupabaseClient = SupabaseClientOriginal;
}

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