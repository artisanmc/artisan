/** Tiny className combiner: filters out falsy values and joins. */
export const cx = (...xs: Array<string | false | null | undefined>): string =>
  xs.filter(Boolean).join(' ');
