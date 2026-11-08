// Browse: the word search drawn as a picture (a PNG), for the printed sheet, the Word document and the preview. Needs a screen (a canvas), so it
// is kept apart from sheets.ts, which node tests.

import type { Picture, WordSearch } from "./sheets";

/** The grid as a PNG. With `answers`, each hidden word is marked with a soft yellow band behind its letters. */
export function drawWordSearch(ws: WordSearch, answers: boolean): Picture | null {
  if (ws.size === 0) return null;
  const cell = Math.floor(1100 / ws.size);
  const pad = 12;
  const side = cell * ws.size + pad * 2;
  const canvas = document.createElement("canvas");
  canvas.width = side;
  canvas.height = side;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, side, side);

  if (answers) {
    ctx.lineCap = "round";
    ctx.lineWidth = cell * 0.78;
    ctx.strokeStyle = "rgba(255, 193, 7, 0.55)";
    for (const p of ws.placed) {
      const x1 = pad + (p.col + 0.5) * cell;
      const y1 = pad + (p.row + 0.5) * cell;
      const x2 = pad + (p.col + p.dc * (p.word.length - 1) + 0.5) * cell;
      const y2 = pad + (p.row + p.dr * (p.word.length - 1) + 0.5) * cell;
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();
    }
  }

  ctx.strokeStyle = "#b9b9b9";
  ctx.lineWidth = 2;
  ctx.strokeRect(pad, pad, cell * ws.size, cell * ws.size);
  ctx.fillStyle = "#111111";
  ctx.font = `700 ${Math.round(cell * 0.56)}px "Segoe UI", Arial, sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  for (let r = 0; r < ws.size; r++) for (let c = 0; c < ws.size; c++) ctx.fillText(ws.grid[r][c], pad + (c + 0.5) * cell, pad + (r + 0.5) * cell + cell * 0.03);
  return { src: canvas.toDataURL("image/png"), width: side, height: side };
}
