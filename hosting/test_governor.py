import importlib.util
from pathlib import Path

import pytest

spec = importlib.util.spec_from_file_location('folio_pressure_governor', Path(__file__).with_name('pressure-governor.py'))
governor = importlib.util.module_from_spec(spec)
spec.loader.exec_module(governor)


@pytest.mark.parametrize('cpu,ram_mib,previous,expected', [
    (10, 4096, '50%', 'infinity'),
    (85, 4096, 'infinity', '50%'),
    (100, 4096, 'infinity', '50%'),
    (10, 2047, 'infinity', '25%'),
    (100, 2047, '50%', '25%'),
    (75, 4096, '50%', '50%'),
    (70, 4096, '50%', '50%'),
    (69.9, 2500, '50%', 'infinity'),
    (10, 2499, '25%', '25%'),
    (10, 2048, 'infinity', 'infinity'),
])
def test_pressure_thresholds_and_restore_hysteresis(cpu, ram_mib, previous, expected):
    assert governor.quota_for(cpu, ram_mib * 1024**2, previous) == expected
