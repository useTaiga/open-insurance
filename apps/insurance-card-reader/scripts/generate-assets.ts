import { mkdir, readFile, writeFile } from "node:fs/promises";

import { Resvg } from "@resvg/resvg-js";
import sharp from "sharp";

const svg = await readFile(
  new URL("../../../packages/insurance-card/assets/icon.svg", import.meta.url),
  "utf-8"
);
const output = new URL(
  "../Reader/Assets.xcassets/AppIcon.appiconset/",
  import.meta.url
);
await mkdir(output, { recursive: true });
const rendered = new Resvg(svg, {
  background: "#15463d",
  fitTo: { mode: "width", value: 1024 },
}).render();
const png = await sharp(rendered.pixels, {
  raw: { channels: 4, height: rendered.height, width: rendered.width },
})
  .removeAlpha()
  .png()
  .toBuffer();
await writeFile(new URL("AppIcon.png", output), png);
