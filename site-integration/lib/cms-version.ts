import { NextResponse } from 'next/server';
export function versionConflict(input: unknown, current: number) {
  if (!Number.isSafeInteger(input) || Number(input) < 1 || input !== current) {
    return NextResponse.json({ error: 'This item has changed since you opened it. Your changes were not saved. Keep this page open, copy your changes, and open the latest version in another tab to review them.', version: current }, { status: 409 });
  }
  return null;
}
