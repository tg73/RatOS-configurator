#!/usr/bin/env bash

# This file is only here for backwards compatibility with the old location of the update script (run via githook).
# It will be removed in a future version.
SCRIPT_DIR=$( cd -- "$( dirname -- "${BASH_SOURCE[0]}" )" &> /dev/null && pwd )

exec "$SCRIPT_DIR/app/scripts/update.sh"
