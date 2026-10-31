import { mkdir, readFile, writeFile } from "node:fs/promises";

import { Resvg } from "@resvg/resvg-js";

const assets = new URL("../assets/", import.meta.url);
await mkdir(assets, { recursive: true });
const svg = await readFile(new URL("icon.svg", assets), "utf-8");
for (const scale of [1, 2, 3]) {
  const png = new Resvg(svg, { fitTo: { mode: "width", value: 29 * scale } })
    .render()
    .asPng();
  await writeFile(
    new URL(scale === 1 ? "icon.png" : `icon@${scale}x.png`, assets),
    png
  );
}
