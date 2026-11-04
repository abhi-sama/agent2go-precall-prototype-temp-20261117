/**
 * ISO 3166-1 alpha-2 to the numeric code Natural Earth (world-atlas) uses as a feature id.
 * Only the countries a medical-affairs organisation is likely to operate in: a country that is
 * missing here is still listed and counted, it just has no outline on the map.
 */
export const COUNTRY_NUMERIC: Readonly<Record<string, string>> = {
  AE: "784", AR: "032", AT: "040", AU: "036", BE: "056", BR: "076", CA: "124", CH: "756", CL: "152", CN: "156",
  CO: "170", DE: "276", DK: "208", ES: "724", FI: "246", FR: "250", GB: "826", IE: "372", IL: "376", IN: "356",
  IT: "380", JP: "392", KR: "410", MX: "484", NL: "528", NO: "578", NZ: "554", PL: "616", PT: "620", RU: "643",
  SA: "682", SE: "752", SG: "702", TR: "792", US: "840", ZA: "710",
}

const BY_NUMERIC: Readonly<Record<string, string>> = Object.fromEntries(Object.entries(COUNTRY_NUMERIC).map(([a2, n]) => [n, a2]))

/** The alpha-2 code for a Natural Earth feature id, or undefined when we do not know it. */
export function alpha2ForNumeric(id: string | number | undefined): string | undefined {
  return id === undefined ? undefined : BY_NUMERIC[String(id).padStart(3, "0")]
}

/** Geographic centres, where a country's globe marker sits (so markers do not pile up on one city). */
export const COUNTRY_CENTER: Readonly<Record<string, readonly [lat: number, lng: number]>> = {
  AE: [24, 54], AR: [-34, -64], AT: [47.6, 14.1], AU: [-25, 134], BE: [50.6, 4.7], BR: [-10, -52], CA: [56, -96],
  CH: [46.8, 8.2], CL: [-30, -71], CN: [35, 103], CO: [4.6, -74], DE: [51.2, 10.4], DK: [56, 10], ES: [40.2, -3.7],
  FI: [64, 26], FR: [46.6, 2.4], GB: [54, -2], IE: [53.4, -8], IL: [31.5, 35], IN: [22, 79], IT: [42.8, 12.8],
  JP: [36.5, 138], KR: [36.5, 127.8], MX: [23.6, -102.5], NL: [52.2, 5.3], NO: [62, 10], NZ: [-41, 172], PL: [52, 19],
  PT: [39.6, -8], RU: [61, 100], SA: [24, 45], SE: [62, 15], SG: [1.35, 103.8], TR: [39, 35], US: [39.8, -98.6], ZA: [-29, 24],
}
