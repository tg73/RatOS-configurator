#!/bin/bash
SCRIPT_DIR=$( cd -- "$( dirname -- "$(realpath -- "${BASH_SOURCE[0]}")" )" &> /dev/null && pwd )

# shellcheck source=./configuration/scripts/environment.sh
source "$SCRIPT_DIR"/environment.sh

report_status()
{
    echo -e "\n\n###### $1"
}

disable_modem_manager()
{
	report_status "Checking if ModemManager is enabled..."
	
	if ! sudo systemctl is-enabled ModemManager.service &> /dev/null; then
		report_status "Disabling ModemManager..."
		sudo systemctl disable ModemManager.service
	else
		report_status "ModemManager is already disabled.."
	fi
	report_status "Masking ModemManager to ensure it won't start in the future..."
	sudo systemctl mask ModemManager.service
}

update_beacon_fw()
{
	report_status "Updating beacon firmware..."
	if [ ! -d "$BEACON_DIR" ] || [ ! -e "$KLIPPER_DIR/klippy/extras/beacon.py" ]; then
		echo "beacon: beacon isn't installed, skipping..."
		return
	fi

	if [ ! -d "$KLIPPER_DIR" ] || [ ! -d "$KLIPPER_ENV" ]; then
		echo "beacon: klipper or klippy env doesn't exist"
		return
	fi

	if [ ! -f "$BEACON_DIR/update_firmware.py" ]; then
		echo "beacon: beacon firmware updater script doesn't exist, skipping..."
		return
	fi
	"$KLIPPER_ENV"/bin/python "$BEACON_DIR"/update_firmware.py update all --no-sudo
}

install_beacon()
{
    report_status "Installing beacon module..."

	if [ -d "$BEACON_DIR" ] || [ -e "$KLIPPER_DIR/klippy/extras/beacon.py" ]; then
		echo "beacon: beacon already installed, skipping..."
		return
	fi

	if [ ! -d "$KLIPPER_DIR" ] || [ ! -d "$KLIPPER_ENV" ]; then
		echo "beacon: klipper or klippy env doesn't exist"
		return
	fi

	git clone https://github.com/beacon3d/beacon_klipper.git "$BEACON_DIR"
	chown -R "${RATOS_USERNAME}:${RATOS_USERGROUP}" "$BEACON_DIR"

	# install beacon requirements to env
	echo "beacon: installing python requirements to env."
	"${KLIPPER_ENV}"/bin/pip install -r "${BEACON_DIR}"/requirements.txt

	# update link to beacon.py
	echo "beacon: registering beacon with the configurator."
	_register_klippy_extension "beacon" "$BEACON_DIR" "beacon.py"

}

_register_klippy_extension() {
	EXT_NAME=$1
    EXT_PATH=$2
    EXT_FILE=$3
	ERROR_IF_EXISTS=$4
	[[ "$ERROR_IF_EXISTS" == "false" ]] && ERROR_IF_EXISTS="" || ERROR_IF_EXISTS="-e "

    report_status "Registering klippy extension '$EXT_NAME' with the RatOS Configurator..."
    if [ ! -e "$EXT_PATH/$EXT_FILE" ]
    then
        echo "ERROR: The file you're trying to register does not exist"
        exit 1
    fi

    # shellcheck disable=SC2086
    if ! ratos extensions register klipper $ERROR_IF_EXISTS"$EXT_NAME" "$EXT_PATH"/"$EXT_FILE"
    then
        echo "ERROR: Failed to register $EXT_NAME. Is the RatOS configurator running?"
        exit 1
    fi
}

_register_klippy_kinematics_extension() {
	EXT_NAME=$1
    EXT_PATH=$2
    EXT_FILE=$3
	ERROR_IF_EXISTS=$4
	[[ "$ERROR_IF_EXISTS" == "false" ]] && ERROR_IF_EXISTS="" || ERROR_IF_EXISTS="-e "

    report_status "Registering klipper kinematics extension '$EXT_NAME' with the RatOS Configurator..."
    if [ ! -e "$EXT_PATH/$EXT_FILE" ]
    then
        echo "ERROR: The file you're trying to register does not exist"
        exit 1
    fi

    # shellcheck disable=SC2086
    if ! ratos extensions register klipper -k $ERROR_IF_EXISTS"$EXT_NAME" "$EXT_PATH"/"$EXT_FILE"
    then
        echo "ERROR: Failed to register $EXT_NAME. Is the RatOS configurator running?"
        exit 1
    fi
}

regenerate_config() {
    report_status "Regenerating RatOS configuration via RatOS Configurator..."

    ratos config regenerate
}

register_gcode_shell_command()
{
    EXT_NAME="gcode_shell_extension"
    EXT_PATH=$(realpath "$SCRIPT_DIR"/../klippy)
    EXT_FILE="gcode_shell_command.py"
    _register_klippy_extension $EXT_NAME "$EXT_PATH" $EXT_FILE
}

register_ratos_homing()
{
    EXT_NAME="ratos_homing_extension"
    EXT_PATH=$(realpath "$SCRIPT_DIR"/../klippy)
    EXT_FILE="ratos_homing.py"
	# Don't error if extension is already registered
    _register_klippy_extension $EXT_NAME "$EXT_PATH" $EXT_FILE "false"
}

register_resonance_generator()
{
    EXT_NAME="resonance_generator_extension"
    EXT_PATH=$(realpath "$SCRIPT_DIR"/../klippy)
    EXT_FILE="resonance_generator.py"
	# Don't error if extension is already registered
    _register_klippy_extension $EXT_NAME "$EXT_PATH" $EXT_FILE "false"
}

unregister_vaoc_led()
{
	if ratos extensions list | grep "vaoc_led" &>/dev/null; then
		report_status "Unregistering experimental vaoc_led extension..."
		ratos extensions unregister klipper vaoc_led
	fi
}

register_z_offset_probe()
{
    EXT_NAME="z_offset_probe_extension"
    EXT_PATH=$(realpath "$SCRIPT_DIR"/../klippy)
    EXT_FILE="z_offset_probe.py"
	# Don't error if extension is already registered
    _register_klippy_extension $EXT_NAME "$EXT_PATH" $EXT_FILE "false"
}

register_ratos_kinematics() {
	if ratos extensions list | grep "ratos-kinematics" &>/dev/null; then
		report_status "Unregistering old ratos-kinematics extension..."
		ratos extensions unregister klipper -k ratos_hybrid_corexy
	fi
	
	RATOS_USER_HOME=$(getent passwd "${RATOS_USERNAME}" | cut -d: -f6)
	if [ -e "${RATOS_USER_HOME}/config/RatOS/klippy/kinematics/ratos-kinematics" ]; then
		report_status "Removing old ratos-kinematics directory..."
		rm -rf "${RATOS_USER_HOME}/config/RatOS/klippy/kinematics/ratos-kinematics"
	fi
    EXT_NAME="ratos_hybrid_corexy"
    EXT_PATH=$(realpath "${SCRIPT_DIR}/../klippy/kinematics")
    EXT_FILE="ratos_hybrid_corexy.py"
    _register_klippy_kinematics_extension $EXT_NAME "$EXT_PATH" $EXT_FILE "false"
}

register_ratos()
{
    EXT_NAME="ratos_extension"
    EXT_PATH=$(realpath "$SCRIPT_DIR"/../klippy)
    EXT_FILE="ratos.py"
	# Don't error if extension is already registered
    _register_klippy_extension $EXT_NAME "$EXT_PATH" $EXT_FILE "false"
}



remove_old_postprocessor()
{
	if [ -L "${KLIPPER_DIR}/klippy/extras/ratos_post_processor.py" ]; then
		report_status "Removing legacy post-processor..."
		rm "${KLIPPER_DIR}/klippy/extras/ratos_post_processor.py"
		echo "Legacy post-processor removed!"
	fi
}

install_hooks()
{
    report_status "Verifying git hooks are installed..."
	# Klipper hook
	klipper_source="$SCRIPT_DIR/klipper-post-merge.sh"
	klipper_target="${KLIPPER_DIR}/.git/hooks/post-merge"
	if [[ ! -L "$klipper_target" ]] || [[ ! "$(readlink "$klipper_target")" = "$klipper_source" ]]
	then
		rm -f "$klipper_target"
		ln -s "$klipper_source" "$klipper_target"
		echo "Klipper git hook installed!"
	fi

	# Moonraker hook
	moonraker_source="$SCRIPT_DIR/moonraker-post-merge.sh"
	moonraker_target="${MOONRAKER_DIR}/.git/hooks/post-merge"
	if [[ ! -L "$moonraker_target" ]] || [[ ! "$(readlink "$moonraker_target")" = "$moonraker_source" ]]
	then
		rm -f "$moonraker_target"
		ln -s "$moonraker_source" "$moonraker_target"
		echo "Moonraker git hook installed!"
	fi

	# Beacon hook
	beacon_source="$SCRIPT_DIR/beacon-post-merge.sh"
	beacon_target="${BEACON_DIR}/.git/hooks/post-merge"
	if [[ ! -L "$beacon_target" ]] || [[ ! "$(readlink "$beacon_target")" = "$beacon_source" ]]
	then
		rm -f "$beacon_target"
		ln -s "$beacon_source" "$beacon_target"
		echo "Beacon git hook installed!"
	fi
	echo "Git hooks are correctly installed!"
}

ensure_service_permission()
{
	if [ ! -e "${RATOS_PRINTER_DATA_DIR}/moonraker.asvc" ]; then
		report_status "Fixing moonraker service permissions..."
		cat << EOF > "${RATOS_PRINTER_DATA_DIR}/moonraker.asvc"
klipper_mcu
webcamd
MoonCord
KlipperScreen
moonraker-telegram-bot
moonraker-obico
sonar
crowsnest
octoeverywhere
ratos-configurator
EOF

		echo "Moonraker service permissions restored!"
	fi
}

patch_klipperscreen_service_restarts()
{
	if grep "StartLimitIntervalSec=0" /etc/systemd/system/klipperscreen.service &>/dev/null; then
		report_status "Patching KlipperScreen service restarts..."
		# Fix restarts
		sudo sed -i 's/\RestartSec=1/\RestartSec=5/g' /etc/systemd/system/KlipperScreen.service
		sudo sed -i 's/\StartLimitIntervalSec=0/\StartLimitIntervalSec=100\nStartLimitBurst=4/g' /etc/systemd/system/KlipperScreen.service
		sudo systemctl daemon-reload
		echo "KlipperScreen service patched!"
	fi
}

ensure_sudo_command_whitelisting()
{
	sudo=""
	[ "$EUID" -ne 0 ] && sudo="sudo"
    report_status "Updating whitelisted commands"
	# Whitelist RatOS git hook scripts
	if [[ -e /etc/sudoers.d/030-ratos-githooks ]]
	then
		$sudo rm /etc/sudoers.d/030-ratos-githooks
	fi
	touch /tmp/030-ratos-githooks
	cat <<EOF > /tmp/030-ratos-githooks
${RATOS_USERNAME}  ALL=(ALL) NOPASSWD: ${RATOS_PRINTER_DATA_DIR}/config/RatOS/scripts/ratos-update.sh
${RATOS_USERNAME}  ALL=(ALL) NOPASSWD: ${RATOS_PRINTER_DATA_DIR}/config/RatOS/scripts/klipper-mcu-update.sh
${RATOS_USERNAME}  ALL=(ALL) NOPASSWD: ${RATOS_PRINTER_DATA_DIR}/config/RatOS/scripts/beacon-update.sh
${RATOS_USERNAME}  ALL=(ALL) NOPASSWD: ${RATOS_PRINTER_DATA_DIR}/config/RatOS/scripts/moonraker-update.sh
EOF

	$sudo chown root:root /tmp/030-ratos-githooks
	$sudo chmod 440 /tmp/030-ratos-githooks
	$sudo cp --preserve=mode /tmp/030-ratos-githooks /etc/sudoers.d/030-ratos-githooks

	echo "RatOS git hooks has successfully been whitelisted!"
}

verify_registered_extensions()
{
    report_status "Verifying registered Klipper extensions..."

    # Define expected extensions and their relative paths
    declare -A expected_extensions=(
        ["beacon"]="${BEACON_DIR}/beacon.py"
        ["gcode_shell_extension"]="${RATOS_PRINTER_DATA_DIR}/config/RatOS/klippy/gcode_shell_command.py"
        ["ratos_homing_extension"]="${RATOS_PRINTER_DATA_DIR}/config/RatOS/klippy/ratos_homing.py"
		["linear_movement_analysis"]="${RATOS_PRINTER_DATA_DIR}/klipper_linear_movement_analysis/linear_movement_analysis.py"
        ["z_offset_probe_extension"]="${RATOS_PRINTER_DATA_DIR}/config/RatOS/klippy/z_offset_probe.py"
        ["resonance_generator_extension"]="${RATOS_PRINTER_DATA_DIR}/config/RatOS/klippy/resonance_generator.py"
        ["ratos_extension"]="${RATOS_PRINTER_DATA_DIR}/config/RatOS/klippy/ratos.py"
    )

	declare -A kinematics_extensions=(
		["ratos_hybrid_corexy"]="${RATOS_PRINTER_DATA_DIR}/config/RatOS/klippy/kinematics/ratos_hybrid_corexy.py"
	)

    # Track found extensions
    declare -A found_extensions
    declare -A found_kinematics

    # Check registered extensions
    while IFS= read -r line; do
        # Skip empty lines and check headers
        [[ -z "$line" ]] && continue
        [[ "$line" == *"Registered Klipper Extensions:"* ]] && continue
        [[ "$line" == *"Registered Moonraker"* ]] && break

        # Extract extension name and filepath
        if [[ "$line" =~ [[:space:]]*([A-Za-z0-9_]+)[[:space:]]*-\>[[:space:]]*([^[:space:]].+)[[:space:]]*$ ]]; then
            ext_name="${BASH_REMATCH[1]}"
            filepath="${BASH_REMATCH[2]}"

            # Check if it's a kinematics extension
            if [[ -v kinematics_extensions["$ext_name"] ]]; then
                found_kinematics["$ext_name"]=1

                # Check if filepath matches expected path
                if [[ "$filepath" != "${kinematics_extensions[$ext_name]}" ]]; then
                    echo "WARNING: Kinematics extension $ext_name has unexpected filepath:"
                    echo "  Expected: ${kinematics_extensions[$ext_name]}"
                    echo "  Found: $filepath"
                    echo "Removing extension $ext_name..."
                    ratos extensions unregister klipper "$ext_name"
                    echo "Reregistering extension $ext_name..."
                    EXT_PATH="${kinematics_extensions[$ext_name]}"
                    ratos extensions register klipper -k "$ext_name" "$EXT_PATH" "$EXT_FILE"
                fi
                continue
            fi

            # Mark as found
            found_extensions["$ext_name"]=1

            # Check if extension is expected
            if [[ ! -v expected_extensions["$ext_name"] ]]; then
                echo "WARNING: Unexpected extension found: $ext_name. This may have been registered by a third party."
				echo "To remove the extension, run 'ratos extensions unregister klipper $ext_name'"
                continue
            fi

            # Check if filepath matches expected path
            if [[ "$filepath" != "${expected_extensions[$ext_name]}" ]]; then
                echo "WARNING: Extension $ext_name has unexpected filepath:"
                echo "  Expected: ${expected_extensions[$ext_name]}"
                echo "  Found: $filepath"
				echo "Removing extension $ext_name..."
				ratos extensions unregister klipper "$ext_name"
				echo "Reregistering extension $ext_name..."
				EXT_PATH="${expected_extensions[$ext_name]}"
				ratos extensions register klipper "$ext_name" "$EXT_PATH"
            fi

            # Check if file exists
            if [ ! -f "$filepath" ]; then
                echo "WARNING: Extension file not found: $filepath. If you keep seeing this message, please report it to RatOS maintainers."
				echo "Unregistering extension $ext_name..."
				ratos extensions unregister klipper "$ext_name"
            fi
        fi
    done < <(ratos extensions list --non-interactive -k)

    # Check for missing expected extensions
    for ext_name in "${!expected_extensions[@]}"; do
        if [[ ! -v found_extensions["$ext_name"] ]]; then
            echo "Expected extension not registered: $ext_name"
			echo "Registering extension $ext_name..."
			EXT_PATH="${expected_extensions[$ext_name]}"
			ratos extensions register klipper "$ext_name" "$EXT_PATH"
        else
			echo "Extension $ext_name is properly registered."
		fi
    done

    # Check for missing kinematics extensions
    for ext_name in "${!kinematics_extensions[@]}"; do
        if [[ ! -v found_kinematics["$ext_name"] ]]; then
            echo "Expected kinematics extension not registered: $ext_name"
			echo "Registering extension $ext_name..."
			EXT_PATH="${kinematics_extensions[$ext_name]}"
			ratos extensions register klipper -k "$ext_name" "$EXT_PATH"
		else
			echo "Kinematic extension $ext_name is properly registered."
		fi
    done
}

