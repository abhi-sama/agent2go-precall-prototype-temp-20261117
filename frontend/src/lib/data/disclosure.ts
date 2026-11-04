/**
 * Small-group disclosure rule shared by the mock adapter (the BE applies the same rule in
 * backend/lambdas/api/src/a2g_api/executive.py): a count below the threshold is withheld, and when exactly
 * one part of a shown total is withheld the next-smallest part is withheld too, so the hidden figure
 * cannot be recovered by subtraction.
 */
export const MIN_CELL = 5

export function suppressFlags(
  values: ReadonlyArray<number | null>,
  total: number | null,
  additive: boolean,
  minCell = MIN_CELL,
): { flags: boolean[]; totalHidden: boolean } {
  const flags = values.map((v) => v !== null && v > 0 && v < minCell)
  let totalHidden = total !== null && total > 0 && total < minCell
  if (additive && !totalHidden && flags.filter(Boolean).length === 1) {
    let pick = -1
    values.forEach((v, i) => {
      if (!flags[i] && v !== null && v > 0 && (pick < 0 || v < (values[pick] as number))) pick = i
    })
    if (pick >= 0) flags[pick] = true
    else totalHidden = true
  }
  return { flags, totalHidden }
}

export const shown = (value: number, hidden: boolean) => ({ value: hidden ? null : value, suppressed: hidden })
