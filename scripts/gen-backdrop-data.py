#!/usr/bin/env python3
"""地区別遠景(AI 生成 WebP)を base64 テキスト資産へ変換する。

GitHub 連携がバイナリを運べないため、遠景は JPEG の base64 文字列として
src/render/backdropData.ts に埋め込む(アプリアイコンのビルド時生成と同じ回避策)。
遠景の焼き込み寸法(内部バッファ幅 427 前後)に見合う 512 幅まで縮小し、
JPEG q62 で再エンコードする。精錬区は素材が来たら SOURCES に足して再実行する。

使い方: python3 scripts/gen-backdrop-data.py [素材ディレクトリ]
"""
import base64
import io
import sys
from pathlib import Path

from PIL import Image

SRC_DIR = Path(sys.argv[1]) if len(sys.argv) > 1 else Path.home() / "workspace/imagine_media"
OUT = Path(__file__).resolve().parent.parent / "src/render/backdropData.ts"
WIDTH = 512

# 地区 ID → 素材ファイル名の断片(生成ファイル名は media-generation-<断片>-<uuid>.webp)
SOURCES = {
    "coldSteel": "strata-bg-coldsteel",
    "habitation": "strata-bg-habitation",
    "disposal": "strata-bg-disposal",
    "waterVoid": "strata-bg-watervoid-sample",
    "power": "strata-bg-power",
    "biomech": "strata-bg-biomech-sample",
    "foundry": "strata-bg-foundry",
}


def encode(path: Path) -> str:
    img = Image.open(path).convert("RGB")
    h = round(img.height * WIDTH / img.width)
    img = img.resize((WIDTH, h), Image.LANCZOS)
    buf = io.BytesIO()
    img.save(buf, "JPEG", quality=62, optimize=True)
    return base64.b64encode(buf.getvalue()).decode("ascii")


def main() -> None:
    lines = [
        "import type { BiomeId } from '../world/biomeCells';",
        "",
        "/**",
        " * 地区別遠景(AI 生成)の JPEG base64。scripts/gen-backdrop-data.py で生成する(手で編集しない)。",
        " * 精錬区は素材未生成のため不在(従来の手続きシルエットで表示する)。",
        " */",
        "export const BACKDROP_JPEG_BASE64: Partial<Record<BiomeId, string>> = {",
    ]
    total = 0
    for biome_id, fragment in SOURCES.items():
        matches = sorted(SRC_DIR.glob(f"media-generation-{fragment}-*.webp"))
        if not matches:
            raise SystemExit(f"素材が見つからない: {fragment} ({SRC_DIR})")
        b64 = encode(matches[0])
        total += len(b64)
        lines.append(f"  {biome_id}:")
        # 100 文字で折り返して結合(差分を読みやすく)
        chunks = [b64[i:i + 100] for i in range(0, len(b64), 100)]
        lines.append("    " + " +\n    ".join(f"'{c}'" for c in chunks) + ",")
        print(f"{biome_id}: {matches[0].name} -> base64 {len(b64)} chars")
    lines.append("};")
    lines.append("")
    OUT.write_text("\n".join(lines), encoding="utf-8")
    print(f"total base64: {total} chars -> {OUT}")


if __name__ == "__main__":
    main()
