// Browser-side syntax check for topic 'apply' function bodies. The runtime
// compiles apply bodies with Function('message', 'state', body); compiling
// the same way here surfaces syntax errors while editing.
export function checkApplySyntax(body: string): string | null {
  if (body.trim() === '') {
    return null;
  }
  try {
    new Function('message', 'state', body);
    return null;
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
}
