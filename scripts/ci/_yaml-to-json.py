#!/usr/bin/env python3
"""Convert a YAML file to JSON on stdout. Used by secret-class-inventory-check.ts."""
import json
import sys

import yaml

with open(sys.argv[1]) as f:
    data = yaml.safe_load(f)
print(json.dumps(data))
