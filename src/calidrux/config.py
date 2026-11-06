"""Application configuration."""

from __future__ import annotations

import json
import os
from pathlib import Path

from pydantic import BaseModel, Field


def _default_data_dir() -> Path:
    override = os.environ.get("CALIDRUX_DATA_DIR")
    if override:
        return Path(override)
    if os.name == "nt":
        base = Path(os.environ.get("APPDATA", Path.home()))
    else:
        base = Path.home() / ".calidrux"
    return base / "Calidrux"


class AbcSettings(BaseModel):
    threshold_a: float = Field(default=0.80, ge=0.0, le=1.0)
    threshold_b: float = Field(default=0.95, ge=0.0, le=1.0)


class SlottingWeights(BaseModel):
    abc_distance: float = 1.0
    pick_frequency: float = 0.5
    weight_level: float = 0.3
    relocation: float = 0.2


class AppSettings(BaseModel):
    user_name: str = "operator"
    expiry_alert_days: list[int] = Field(default_factory=lambda: [30, 60, 90])
    abc: AbcSettings = Field(default_factory=AbcSettings)
    slotting: SlottingWeights = Field(default_factory=SlottingWeights)
    dispatch_x: float = 0.0
    dispatch_y: float = 0.0


class Config:
    def __init__(self) -> None:
        self.data_dir = _default_data_dir()
        self.data_dir.mkdir(parents=True, exist_ok=True)
        self.db_path = self.data_dir / "calidrux.db"
        self.settings_path = self.data_dir / "settings.json"
        self.settings = self._load_settings()

    def _load_settings(self) -> AppSettings:
        if self.settings_path.exists():
            data = json.loads(self.settings_path.read_text(encoding="utf-8"))
            return AppSettings.model_validate(data)
        return AppSettings()

    def save_settings(self) -> None:
        self.settings_path.write_text(
            self.settings.model_dump_json(indent=2),
            encoding="utf-8",
        )


config = Config()
