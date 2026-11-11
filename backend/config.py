"""Load settings from a ``.env`` file next to the project (optional, no dependency).

Real environment variables always win. The file is ignored while tests run, so a developer's
local settings (an LLM endpoint, a data folder) can never change test behaviour.
"""
import os
import sys
from pathlib import Path

ENV_FILE = Path(__file__).resolve().parent.parent / '.env'


def load_env(path=ENV_FILE):
    if 'pytest' in sys.modules or not path.is_file():
        return []
    loaded = []
    for raw in path.read_text(encoding='utf-8-sig').splitlines():
        line = raw.strip()
        if not line or line.startswith('#') or '=' not in line:
            continue
        key, value = line.split('=', 1)
        key, value = key.strip(), value.strip().strip('"').strip("'")
        if key and value and key not in os.environ:
            os.environ[key] = value
            loaded.append(key)
    return loaded
