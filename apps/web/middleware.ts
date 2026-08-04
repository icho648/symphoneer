import { detectLocale, isLocale, localeCookieName, locales } from "@symphoneer/i18n";
import { type NextRequest, NextResponse } from "next/server";

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (pathname.startsWith("/api/")) return NextResponse.next();

  const locale = locales.find(
    (candidate) => pathname === `/${candidate}` || pathname.startsWith(`/${candidate}/`),
  );
  if (isLocale(locale)) return NextResponse.next();

  const nextUrl = request.nextUrl.clone();
  const detected = detectLocale(
    request.cookies.get(localeCookieName)?.value,
    request.headers.get("accept-language"),
  );
  nextUrl.pathname = `/${detected}${pathname === "/" ? "" : pathname}`;
  return NextResponse.redirect(nextUrl);
}

export const config = {
  matcher: ["/((?!_next|favicon.ico|.*\\..*).*)"],
};
