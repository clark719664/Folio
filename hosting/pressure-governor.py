"""Adjust only Folio's CPU ceiling under host pressure; never change other services."""
import logging
import subprocess
import time
from pathlib import Path

UNIT = 'folio-converter.service'


def snapshot():
    values = [int(value) for value in Path('/proc/stat').read_text().splitlines()[0].split()[1:9]]
    idle = values[3] + values[4]
    available = next(int(line.split()[1]) * 1024 for line in Path('/proc/meminfo').read_text().splitlines() if line.startswith('MemAvailable:'))
    return sum(values), idle, available


def quota_for(cpu, available, previous):
    if available < 2 * 1024**3:
        return '25%'
    if cpu >= 85:
        return '50%'
    if cpu < 70 and available >= 2500 * 1024**2:
        return 'infinity'
    return previous


def main():
    logging.basicConfig(level=logging.INFO, format='%(message)s')
    previous = snapshot()
    quota = None
    while True:
        time.sleep(2)
        try:
            current = snapshot()
            total = current[0] - previous[0]
            cpu = 100 * (1 - (current[1] - previous[1]) / total) if total > 0 else 100
            target = quota_for(cpu, current[2], quota or 'infinity')
            previous = current
            if target != quota:
                setting = '' if target == 'infinity' else target
                subprocess.run(['/usr/bin/systemctl', 'set-property', '--runtime', UNIT, f'CPUQuota={setting}'], check=True, timeout=5, capture_output=True)
                logging.info('Folio CPU ceiling %s (host CPU %.0f%%, available RAM %.0f MiB)', target, cpu, current[2] / 1024**2)
                quota = target
        except Exception:
            logging.exception('Could not update Folio resource ceiling')


if __name__ == '__main__':
    main()
