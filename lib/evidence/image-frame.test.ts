/**
 * @jest-environment node
 */
import sharp from "sharp";
import { gifKeyFramePng } from "@/lib/evidence/image-frame";

async function animatedGif(colors: number[][], w = 60, ph = 40): Promise<Buffer> {
  const frames: Buffer[] = [];
  for (const [r, g, b] of colors) {
    frames.push(
      await sharp({ create: { width: w, height: ph, channels: 3, background: { r, g, b } } })
        .raw()
        .toBuffer(),
    );
  }
  // pageHeight DENTRO de raw => sharp trata as n faixas como n frames
  return sharp(Buffer.concat(frames), {
    raw: { width: w, height: ph * colors.length, channels: 3, pageHeight: ph },
  })
    .gif({ loop: 0 })
    .toBuffer();
}

describe("gifKeyFramePng", () => {
  it("GIF animado -> PNG do ULTIMO frame (estado final, nao o primeiro)", async () => {
    const gif = await animatedGif([
      [255, 0, 0], // vermelho (primeiro)
      [0, 255, 0], // verde
      [0, 0, 255], // azul (ultimo)
    ]);
    expect((await sharp(gif).metadata()).pages).toBe(3);
    const png = await gifKeyFramePng(gif);
    expect(png).not.toBeNull();
    expect(png!.subarray(0, 4).toString("hex")).toBe("89504e47"); // PNG
    const { data } = await sharp(png!).raw().toBuffer({ resolveWithObject: true });
    expect(data[2]).toBeGreaterThan(200); // azul = ULTIMO frame
    expect(data[0]).toBeLessThan(60); // nao vermelho = nao o primeiro
  }, 20000);

  it("GIF de 1 frame -> PNG daquele frame", async () => {
    const gif = await sharp({
      create: { width: 50, height: 50, channels: 3, background: { r: 10, g: 200, b: 10 } },
    })
      .gif()
      .toBuffer();
    const png = await gifKeyFramePng(gif);
    expect(png).not.toBeNull();
    expect(png!.subarray(0, 4).toString("hex")).toBe("89504e47");
  }, 20000);

  it("buffer nao-decodavel -> null (fail-safe, chamador mantem o original)", async () => {
    expect(await gifKeyFramePng(Buffer.from("isto-nao-e-gif-nenhum-0123"))).toBeNull();
  });
});
