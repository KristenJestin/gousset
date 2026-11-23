/**
 * How long a password may be, in characters: the only rule better-auth checks, set here once so
 * that the forms say it before a submit (apps/web). No import beyond this file: the pages load it.
 */
export const PASSWORD_LENGTH = { min: 8, max: 128 };
