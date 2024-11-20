#!/bin/bash

# create ~/.ratos.env if file does not exist using sane defaults on a ratos pi image.
# performed outside of a function so that other scripts sourcing this in will run this by default
if [ ! -f ~/.ratos.env ]; then
	echo "No .ratos.env file found in $HOME, determining default values..."
	if [ "$(id -u)" -eq 0 ]; then
		echo "Running as root, defaulting to pi as RATOS_USER and RATOS_USERGROUP..."
		RATOS_USER="pi";
	else
		echo "Running as non-root user, defaulting to $USER as RATOS_USER and RATOS_USERGROUP..."
		RATOS_USER=$USER;
	fi
	HOME_DIR="/home/$RATOS_USER";
	echo "Creating ~/.ratos.env file with default values..."

	cat <<EOF > ~/.ratos.env
RATOS_USERNAME="${RATOS_USER}"
RATOS_USERGROUP="${RATOS_USER}"
RATOS_PRINTER_DATA_DIR="${HOME_DIR}/printer_data"
MOONRAKER_DIR="${HOME_DIR}/moonraker"
KLIPPER_DIR="${HOME_DIR}/klipper"
KLIPPER_ENV="${HOME_DIR}/klippy-env"
BEACON_DIR="${HOME_DIR}/beacon"
EOF
fi

if [ -f ~/.ratos.env ] ; then
	echo "Loading RatOS environment data from $(realpath ~/.ratos.env)"
	# shellcheck disable=SC1090
	set -a && source ~/.ratos.env && set +a
else
	echo "Fatal Error: Unable to load RatOS environment data, exiting..." >&2
	exit 1
fi
