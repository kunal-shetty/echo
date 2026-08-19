import { NextResponse } from "next/server";
import { isSupabaseConfigured } from "@/lib/server/supabase";
import {
  deleteCategory,
  updateCategory,
} from "@/lib/server/categories";
import { isIconName } from "@/lib/icon-vocab";
import { getDeviceUserId } from "@/lib/server/user";

export const runtime = "nodejs";

interface PatchCategoryBody {
  name?: string;
  icon?: string | null;
  tone?: string;
  sort_order?: number;
}

const TONES = new Set([
  "violet",
  "orange",
  "blue",
  "green",
  "pink",
  "red",
  "neutral",
]);

export async function PATCH(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  if (!isSupabaseConfigured()) {
    return NextResponse.json(
      { error: "Backend not configured." },
      { status: 503 },
    );
  }
  const userId = await getDeviceUserId();
  if (!userId) {
    return NextResponse.json({ error: "No device identity." }, { status: 400 });
  }
  const { id } = await ctx.params;

  let body: PatchCategoryBody;
  try {
    body = (await req.json()) as PatchCategoryBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const patch: Parameters<typeof updateCategory>[2] = {};
  if (body.name !== undefined) {
    const name = body.name.trim();
    if (name.length < 1 || name.length > 40) {
      return NextResponse.json(
        { error: "Name must be 1–40 characters" },
        { status: 400 },
      );
    }
    patch.name = name;
  }
  if (body.icon !== undefined) {
    if (body.icon === null || body.icon === "") {
      patch.icon = null;
    } else if (typeof body.icon !== "string" || !isIconName(body.icon)) {
      return NextResponse.json({ error: "Unknown icon" }, { status: 400 });
    } else {
      patch.icon = body.icon;
    }
  }
  if (body.tone !== undefined) {
    if (!TONES.has(body.tone)) {
      return NextResponse.json({ error: "Unknown tone" }, { status: 400 });
    }
    patch.tone = body.tone as Parameters<typeof updateCategory>[2]["tone"];
  }
  if (body.sort_order !== undefined) {
    if (typeof body.sort_order !== "number" || !Number.isFinite(body.sort_order)) {
      return NextResponse.json({ error: "Invalid sort_order" }, { status: 400 });
    }
    patch.sort_order = Math.trunc(body.sort_order);
  }
  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
  }

  try {
    const cat = await updateCategory(userId, id, patch);
    if (!cat) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    return NextResponse.json({ category: cat });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Unknown error";
    if (/duplicate key|unique constraint/i.test(message)) {
      return NextResponse.json(
        { error: "A category with that name already exists" },
        { status: 409 },
      );
    }
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function DELETE(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  if (!isSupabaseConfigured()) {
    return NextResponse.json(
      { error: "Backend not configured." },
      { status: 503 },
    );
  }
  const userId = await getDeviceUserId();
  if (!userId) {
    return NextResponse.json({ error: "No device identity." }, { status: 400 });
  }
  const { id } = await ctx.params;
  try {
    const ok = await deleteCategory(userId, id);
    if (!ok) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    return new NextResponse(null, { status: 204 });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Unknown error";
    // Foreign-key violation: the category is still referenced by
    // transactions or budgets.
    if (/foreign key|violates/i.test(message)) {
      return NextResponse.json(
        { error: "Category is in use; reassign its memories first" },
        { status: 409 },
      );
    }
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
