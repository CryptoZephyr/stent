/**
 * Gated agent claim/edit. The ONLY privileged write in the dashboard.
 *
 * Flow: verify the caller's session (auth abstraction → wallet), then upsert the
 * agent for THAT wallet via the service role. `agent_wallet` and `owner_wallet`
 * are both set from the verified session wallet — never from the request body —
 * so a caller can only create or rename the agent for the wallet it controls.
 */
import { auth } from "@/lib/auth";
import { adminSupabase } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";

export async function POST(req: Request): Promise<Response> {
  const session = await auth.verifyRequest(req);
  if (!session) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "invalid_json" }, { status: 400 });
  }
  const b = (body ?? {}) as { name?: unknown; description?: unknown };

  const name = String(b.name ?? "").trim();
  if (name.length < 1 || name.length > 60) {
    return Response.json(
      { error: "invalid_name", detail: "Name must be 1–60 characters." },
      { status: 400 }
    );
  }
  const description =
    b.description == null ? null : String(b.description).trim().slice(0, 280) || null;

  const wallet = session.wallet; // verified + lowercased; not from the body
  const { data, error } = await adminSupabase()
    .from("agents")
    .upsert(
      { agent_wallet: wallet, owner_wallet: wallet, name, description },
      { onConflict: "agent_wallet" }
    )
    .select("agent_wallet, owner_wallet, name, description, created_at")
    .single();

  if (error) {
    return Response.json({ error: "write_failed", detail: error.message }, { status: 500 });
  }
  return Response.json({ agent: data }, { status: 200 });
}
