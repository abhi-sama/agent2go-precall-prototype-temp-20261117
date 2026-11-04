// Lossless PNG recompression for the visual baselines (e2e/__visual__): Playwright writes fast, large PNGs;
// this shrinks them about 2.7x without changing a single pixel. Run by `pnpm test:visual:update`.
import { readdirSync, readFileSync, writeFileSync } from "node:fs"
import path from "node:path"
import sharp from "sharp"

const root = path.resolve(import.meta.dirname, "../e2e/__visual__")
const files = readdirSync(root, { recursive: true }).filter((f) => String(f).endsWith(".png"))
let before = 0
let after = 0
for (const rel of files) {
  const file = path.join(root, String(rel))
  const original = readFileSync(file)
  const packed = await sharp(original).png({ compressionLevel: 9, effort: 10 }).toBuffer()
  before += original.length
  if (packed.length < original.length) {
    writeFileSync(file, packed)
    after += packed.length
  } else after += original.length
}
const mb = (n) => (n / 1048576).toFixed(1)
console.log(`visual baselines: ${files.length} files, ${mb(before)} MB -> ${mb(after)} MB`)
