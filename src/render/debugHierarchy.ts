import type { Camera } from '../core/camera';
import {
  regionAt, sectorAt, districtAt, roomAt,
  REGION_SIZE, SECTOR_SIZE, DISTRICT_SIZE, ROOM_SIZE,
} from '../world/hierarchy';

const SYSTEM_HUE: Record<string, number> = {
  water: 200, power: 50, habitation: 130, disposal: 20, foundry: 340,
};

/**
 * 階層グリッドをズームアウトした独自スケールで俯瞰可視化する。
 * tilesAcross = 画面幅に収めるワールドタイル数(ゲーム描画とは独立)。
 * region=系統色の巨大塗り+ラベル、sector=枠+ハブ十字、district=状態色枠、
 * room=系統色の小ドット(decayで濃淡)、白丸=現在地、下部に現在地HUD。
 */
export function drawHierarchyDebug(
  ctx: CanvasRenderingContext2D,
  cam: Camera,
  seed: number,
  w: number,
  h: number,
  tilesAcross: number,
): void {
  const ppt = w / tilesAcross; // オーバーレイ独自の px/tile(ゲームppt非依存)
  const toX = (wx: number) => (wx - cam.x) * ppt + w / 2;
  const toY = (wy: number) => (wy - cam.y) * ppt + h / 2;
  const x0 = cam.x - w / ppt / 2, x1 = cam.x + w / ppt / 2;
  const y0 = cam.y - h / ppt / 2, y1 = cam.y + h / ppt / 2;

  ctx.save();

  // --- region: 系統色の巨大な半透明塗り ---
  for (let ry = Math.floor(y0 / REGION_SIZE); ry <= Math.floor(y1 / REGION_SIZE); ry++) {
    for (let rx = Math.floor(x0 / REGION_SIZE); rx <= Math.floor(x1 / REGION_SIZE); rx++) {
      const wx = rx * REGION_SIZE, wy = ry * REGION_SIZE;
      const hue = SYSTEM_HUE[regionAt(seed, wx, wy).system] ?? 0;
      ctx.fillStyle = `hsla(${hue}, 55%, 45%, 0.18)`;
      ctx.fillRect(toX(wx), toY(wy), REGION_SIZE * ppt, REGION_SIZE * ppt);
    }
  }

  // --- room: 存在する部屋を系統色の小ドットで(密度・種類の可視化) ---
  const roomPx = ROOM_SIZE * ppt;
  if (roomPx >= 0.75) {
    for (let rmy = Math.floor(y0 / ROOM_SIZE); rmy <= Math.floor(y1 / ROOM_SIZE); rmy++) {
      for (let rmx = Math.floor(x0 / ROOM_SIZE); rmx <= Math.floor(x1 / ROOM_SIZE); rmx++) {
        const wx = rmx * ROOM_SIZE, wy = rmy * ROOM_SIZE;
        const room = roomAt(seed, wx, wy);
        if (!room.present) continue;
        const hue = SYSTEM_HUE[regionAt(seed, wx, wy).system] ?? 0;
        ctx.fillStyle = `hsla(${hue}, 70%, 55%, ${0.35 + room.decay * 0.5})`;
        const s = Math.max(1, roomPx * 0.9);
        ctx.fillRect(toX(wx), toY(wy), s, s);
      }
    }
  }

  // --- district: 状態色の枠 ---
  const distPx = DISTRICT_SIZE * ppt;
  if (distPx >= 3) {
    ctx.lineWidth = 1;
    for (let dy = Math.floor(y0 / DISTRICT_SIZE); dy <= Math.floor(y1 / DISTRICT_SIZE); dy++) {
      for (let dx = Math.floor(x0 / DISTRICT_SIZE); dx <= Math.floor(x1 / DISTRICT_SIZE); dx++) {
        const wx = dx * DISTRICT_SIZE, wy = dy * DISTRICT_SIZE;
        const d = districtAt(seed, wx, wy);
        ctx.strokeStyle = d.state === 'active' ? 'rgba(255,255,255,0.5)'
          : d.state === 'ruined' ? 'rgba(150,150,150,0.5)' : 'rgba(200,60,60,0.6)';
        ctx.strokeRect(toX(wx), toY(wy), distPx, distPx);
      }
    }
  }

  // --- sector: 枠 + ハブ十字 ---
  const secPx = SECTOR_SIZE * ppt;
  ctx.lineWidth = 2;
  for (let sy = Math.floor(y0 / SECTOR_SIZE); sy <= Math.floor(y1 / SECTOR_SIZE); sy++) {
    for (let sx = Math.floor(x0 / SECTOR_SIZE); sx <= Math.floor(x1 / SECTOR_SIZE); sx++) {
      const wx = sx * SECTOR_SIZE, wy = sy * SECTOR_SIZE;
      ctx.strokeStyle = 'rgba(255,255,0,0.35)';
      ctx.strokeRect(toX(wx), toY(wy), secPx, secPx);
      const s = sectorAt(seed, wx, wy);
      const hx = toX(wx + s.hubX), hy = toY(wy + s.hubY);
      ctx.strokeStyle = '#ff0';
      ctx.beginPath();
      ctx.moveTo(hx - 8, hy); ctx.lineTo(hx + 8, hy);
      ctx.moveTo(hx, hy - 8); ctx.lineTo(hx, hy + 8);
      ctx.stroke();
    }
  }

  // --- region ラベル(系統名) ---
  ctx.font = 'bold 14px monospace';
  ctx.fillStyle = '#fff';
  for (let ry = Math.floor(y0 / REGION_SIZE); ry <= Math.floor(y1 / REGION_SIZE); ry++) {
    for (let rx = Math.floor(x0 / REGION_SIZE); rx <= Math.floor(x1 / REGION_SIZE); rx++) {
      const region = regionAt(seed, rx * REGION_SIZE, ry * REGION_SIZE);
      const lx = Math.max(6, Math.min(w - 220, toX(rx * REGION_SIZE) + 6));
      const ly = Math.max(18, Math.min(h - 30, toY(ry * REGION_SIZE) + 18));
      ctx.fillText(`region(${region.rx},${region.ry}) ${region.system}`, lx, ly);
    }
  }

  // --- 現在地マーカー(白丸) ---
  ctx.strokeStyle = '#fff';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(toX(cam.x), toY(cam.y), 6, 0, Math.PI * 2);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(toX(cam.x), toY(cam.y), 2, 0, Math.PI * 2);
  ctx.fillStyle = '#fff';
  ctx.fill();

  // --- HUD ---
  ctx.fillStyle = '#0f0';
  ctx.font = '12px monospace';
  const region = regionAt(seed, cam.x, cam.y);
  const d = districtAt(seed, cam.x, cam.y);
  ctx.fillText(
    `zoom=${tilesAcross}t region(${region.rx},${region.ry}) sys=${region.system} district=${d.facilityType}/${d.state}`,
    12, h - 16,
  );
  ctx.restore();
}
