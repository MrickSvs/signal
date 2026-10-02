import { NextResponse, type NextRequest } from "next/server";
import { isAuthorized } from "@/lib/basic-auth";

export function proxy(request: NextRequest) {
  const password = process.env.SITE_PASSWORD;
  if (!password) return NextResponse.next();
  if (isAuthorized(request.headers.get("authorization"), password)) return NextResponse.next();
  return new NextResponse("Authentification requise", {
    status: 401,
    headers: { "WWW-Authenticate": 'Basic realm="Signal", charset="UTF-8"' },
  });
}

export const config = {
  // Cron, Notion webhook and MCP routes are protected by their own secret.
  matcher: ["/((?!api/cron|api/notion/webhook|api/mcp|_next/static|_next/image|favicon.ico).*)"],
};
