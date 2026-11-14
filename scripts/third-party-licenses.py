"""Include installed distribution license notices in the standalone bundle."""
import argparse
import json
from importlib import metadata
from pathlib import Path

parser = argparse.ArgumentParser()
parser.add_argument("--output", type=Path, required=True)
args = parser.parse_args()
sections = ["Folio third-party notices\n\nThe application is AGPL-3.0-only. Dependencies retain their respective licenses.\n"]
for distribution in sorted(metadata.distributions(), key=lambda item: item.metadata.get("Name", "").lower()):
    name = distribution.metadata.get("Name", "Unknown")
    if name.lower() in {"pip", "setuptools", "pytest", "pyinstaller", "pyinstaller-hooks-contrib"}:
        continue
    sections.append(f"\n{'=' * 72}\n{name} {distribution.version}\n")
    license_name = distribution.metadata.get("License-Expression") or distribution.metadata.get("License") or "See bundled notice below"
    sections.append(f"License: {license_name}\nProject: {distribution.metadata.get('Home-page', '')}\n")
    for file in distribution.files or []:
        if any(part.endswith((".dist-info", ".egg-info")) for part in file.parts) and any(part.lower().startswith(("license", "copying", "notice")) for part in file.parts):
            target = distribution.locate_file(file)
            if target.is_file():
                sections.append(f"\n--- {file.name} ---\n{target.read_text(encoding='utf-8', errors='replace')}\n")
project = Path(__file__).resolve().parents[1]
for name in ("react", "react-dom", "scheduler", "lucide-react"):
    package = project / "node_modules" / name
    info = json.loads((package / "package.json").read_text(encoding="utf-8"))
    sections.append(f"\n{'=' * 72}\n{name} {info['version']}\nLicense: {info.get('license', '')}\n")
    for file in package.iterdir():
        if file.is_file() and file.name.lower().startswith(("license", "copying", "notice")):
            sections.append(file.read_text(encoding="utf-8", errors="replace") + "\n")
args.output.parent.mkdir(parents=True, exist_ok=True)
args.output.write_text("".join(sections), encoding="utf-8")
