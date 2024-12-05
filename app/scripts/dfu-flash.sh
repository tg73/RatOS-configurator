#!/bin/bash
if [ "$EUID" -ne 0 ]
  then echo "ERROR: Please run as root"
  exit
fi

SCRIPT_DIR=$( cd -- "$( dirname -- "${BASH_SOURCE[0]}" )" &> /dev/null && pwd )
# shellcheck source=./src/scripts/common.sh
source "$SCRIPT_DIR/common.sh"

MCU=$1
if [ "$MCU" == "" ]; then
	echo "ERROR: Please specify a device to flash"
	exit
fi
pushd "${KLIPPER_DIR}" || exit
service klipper stop
echo "Flashing DFU device"
make flash FLASH_DEVICE=0483:df11
chown "${RATOS_USERNAME}":"${RATOS_USERGROUP}" -R "${KLIPPER_DIR}"
sleep 5
if [ -h "$MCU" ]; then
    echo "Flashing Successful!"
else
    echo "Flashing failed :("
    service klipper start
    popd || exit
    exit 1
fi
service klipper start
popd || exit
