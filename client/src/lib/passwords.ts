/**
 * One password rule for every form (sign-up, reset, Account → Security,
 * Dashboard → Settings). Keep MIN_PASSWORD_LENGTH equal to Supabase →
 * Authentication → Email → "Minimum password length" (8 since 2026-10-18).
 * Length beats composition rules, so there is no "must contain a digit".
 */
export const MIN_PASSWORD_LENGTH = 8;
export const PASSWORD_HINT = `At least ${MIN_PASSWORD_LENGTH} characters.`;

/** "Use at least 8 characters." when too short, else null. */
export function passwordProblem(pw: string): string | null {
  return pw.length < MIN_PASSWORD_LENGTH ? `Use at least ${MIN_PASSWORD_LENGTH} characters.` : null;
}

/**
 * Plain wording for Supabase sign-up / password errors — never the raw text
 * (it goes to the console instead).
 */
export function authErrorMessage(err: unknown, fallback: string): string {
  console.error("[auth]", err);
  const m = err instanceof Error ? err.message : "";
  if (/already registered|already exists|already been registered/i.test(m)) return "There's already an account with this email. Sign in, or use “Forgot password?” to set a new one.";
  if (/weak|should be at least|characters|pwned|leaked|known/i.test(m)) return `Choose a stronger password — at least ${MIN_PASSWORD_LENGTH} characters, and not one used on other sites.`;
  if (/rate|too many|security purposes|seconds/i.test(m)) return "Too many attempts — please wait a minute and try again.";
  if (/invalid.*email|email.*invalid|unable to validate email/i.test(m)) return "That email address doesn't look right — check it and try again.";
  if (/different from the old|same as/i.test(m)) return "Choose a password you haven't used for this account before.";
  return fallback;
}
