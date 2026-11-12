/** Turbopack serves an imported font file as a hashed static asset and hands back its URL. */
declare module "*.woff2" {
  const url: string
  export default url
}
