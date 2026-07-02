/**
 * The single import surface for authentication.
 *
 * App code imports `auth` and the `Session` type from here and nothing else.
 * To move off Supabase (e.g. to Privy), implement `AuthClient & AuthServer` in a
 * new provider and swap the one binding below — no other file, and no database
 * column, references the provider.
 */
import { supabaseAuth } from "./supabaseProvider";
import type { AuthClient, AuthServer } from "./types";

export type { Session } from "./types";

export const auth: AuthClient & AuthServer = supabaseAuth;
